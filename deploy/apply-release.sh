#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'
umask 077

failure_message() {
    printf '%s\n' 'Deployment failed. The existing release pointer and database were not rolled back automatically.' >&2
}

fail() {
    printf 'Error: %s\n' "$1" >&2
    failure_message
    exit 1
}

on_unexpected_error() {
    local status=$?
    failure_message
    exit "$status"
}

trap on_unexpected_error ERR

if [[ $# -ne 2 ]]; then
    fail 'usage: apply-release.sh DEPLOY_ROOT RELEASE_ID'
fi

deploy_root_argument=$1
release_id=$2

[[ "$deploy_root_argument" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
    fail 'DEPLOY_ROOT must be an absolute Linux path containing only letters, numbers, dot, underscore, slash, and hyphen'
[[ "$release_id" =~ ^[0-9a-f]{40}$ ]] ||
    fail 'RELEASE_ID must be a full 40-character lowercase Git SHA'

for command_name in docker curl python3 realpath flock stat id mktemp; do
    command -v "$command_name" >/dev/null 2>&1 || fail "required command is unavailable: $command_name"
done

[[ -d "$deploy_root_argument" ]] || fail 'DEPLOY_ROOT does not exist'
deploy_root=$(realpath -e -- "$deploy_root_argument")
[[ "$deploy_root" != / ]] || fail 'DEPLOY_ROOT cannot be the filesystem root'
[[ "$deploy_root" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail 'resolved DEPLOY_ROOT is not a safe path'

# The lock belongs to this application root, so unrelated Compose projects are never touched.
exec 9>"$deploy_root/.deploy.lock"
flock -n 9 || fail 'another Detour deployment is already running'

production_env="$deploy_root/production.env"
release_dir="$deploy_root/releases/$release_id"
images_env="$release_dir/images.env"

[[ -f "$production_env" && ! -L "$production_env" ]] ||
    fail 'production.env must be an existing regular file, not a symlink'
[[ "$(stat -c '%u' -- "$production_env")" == "$(id -u)" ]] ||
    fail 'production.env must be owned by the deployment user'
[[ "$(stat -c '%a' -- "$production_env")" == 600 ]] ||
    fail 'production.env must already have mode 0600'

[[ -d "$release_dir" && ! -L "$release_dir" ]] || fail 'release directory is missing or is a symlink'
resolved_release_dir=$(realpath -e -- "$release_dir")
[[ "$resolved_release_dir" == "$release_dir" ]] || fail 'release directory must stay inside DEPLOY_ROOT/releases'

required_release_files=(docker-compose.yaml compose.production.yaml images.env images.tar)
for required_file in "${required_release_files[@]}"; do
    required_path="$release_dir/$required_file"
    [[ -f "$required_path" && ! -L "$required_path" ]] ||
        fail "release file is missing or is a symlink: $required_file"
done

# images.env is metadata, not executable shell input. Keep its accepted surface deliberately tiny.
declare -A image_values=()
while IFS= read -r image_line || [[ -n "$image_line" ]]; do
    [[ "$image_line" != *$'\r'* ]] || fail 'images.env must use Unix line endings'
    [[ "$image_line" =~ ^[[:space:]]*$ || "$image_line" =~ ^[[:space:]]*# ]] && continue
    [[ "$image_line" =~ ^(API_IMAGE|WEB_IMAGE|API_PORT)=([^[:space:]]+)$ ]] ||
        fail 'images.env may contain only API_IMAGE, WEB_IMAGE, and API_PORT assignments'

    image_key=${BASH_REMATCH[1]}
    image_value=${BASH_REMATCH[2]}
    [[ -z "${image_values[$image_key]+present}" ]] || fail "images.env contains duplicate $image_key"
    image_values[$image_key]=$image_value
done < "$images_env"

[[ "${image_values[API_IMAGE]-}" == "detour-api:$release_id" ]] ||
    fail 'API_IMAGE must be tagged detour-api:RELEASE_ID'
[[ "${image_values[WEB_IMAGE]-}" == "detour-web:$release_id" ]] ||
    fail 'WEB_IMAGE must be tagged detour-web:RELEASE_ID'
[[ "${image_values[API_PORT]-}" =~ ^[0-9]+$ ]] || fail 'API_PORT must be numeric'
api_port_number=$((10#${image_values[API_PORT]}))
(( api_port_number >= 1 && api_port_number <= 65535 )) || fail 'API_PORT must be between 1 and 65535'

current_path="$deploy_root/current"
previous_path="$deploy_root/previous"
old_release_id=

if [[ -e "$current_path" || -L "$current_path" ]]; then
    [[ -L "$current_path" ]] || fail 'current must be a symlink when it exists'
    resolved_current=$(realpath -e -- "$current_path") || fail 'current points to a missing release'
    [[ "$resolved_current" =~ ^"$deploy_root"/releases/([0-9a-f]{40})$ && -d "$resolved_current" ]] ||
        fail 'current must point to a release inside DEPLOY_ROOT/releases'
    old_release_id=${BASH_REMATCH[1]}
fi

if [[ -e "$previous_path" || -L "$previous_path" ]]; then
    [[ -L "$previous_path" ]] || fail 'previous must be a symlink when it exists'
fi

compose=(
    docker compose
    -p detour
    --env-file "$production_env"
    --env-file "$images_env"
    -f "$release_dir/docker-compose.yaml"
    -f "$release_dir/compose.production.yaml"
)

# --quiet validates interpolation and the merged model without rendering secrets.
"${compose[@]}" config --quiet

# The rendered JSON can contain secrets. Pipe it directly to Python and emit only the validated host.
if ! compose_metadata=$("${compose[@]}" config --format json | python3 -c '
import json
import re
import sys

try:
    model = json.load(sys.stdin)
    services = model.get("services", {})
    required = {"postgres", "api", "web", "compose-dashboard"}
    if set(services) != required:
        raise ValueError("unexpected services")
    environment = services.get("api", {}).get("environment", {})
    host = environment.get("AllowedHosts")
    if not isinstance(host, str) or not re.fullmatch(
        r"(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", host
    ):
        raise ValueError("invalid public host")
    web_environment = services.get("web", {}).get("environment", {})
    if (
        web_environment.get("REVERSEPROXY__ROUTES__health__MATCH__PATH") != "/health"
        or web_environment.get("REVERSEPROXY__ROUTES__health__CLUSTERID") != "api"
    ):
        raise ValueError("missing health route")
    postgres_mounts = services.get("postgres", {}).get("volumes", [])
    volume_sources = [
        mount.get("source")
        for mount in postgres_mounts
        if isinstance(mount, dict)
        and mount.get("type") == "volume"
        and mount.get("target") == "/var/lib/postgresql"
    ]
    if len(volume_sources) != 1 or not isinstance(volume_sources[0], str):
        raise ValueError("unexpected postgres volume")
    volume_source = volume_sources[0]
    volume_definition = model.get("volumes", {}).get(volume_source, {})
    volume_name = volume_definition.get("name", f"detour_{volume_source}")
    if not isinstance(volume_name, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", volume_name):
        raise ValueError("invalid postgres volume name")
except (json.JSONDecodeError, TypeError, ValueError, AttributeError):
    print("Compose JSON does not contain the expected services, health route, host, and database volume", file=sys.stderr)
    raise SystemExit(1)

print(host)
print(volume_name)
'); then
    fail 'could not safely read deployment metadata from the merged Compose model'
fi
public_host=${compose_metadata%%$'\n'*}
postgres_volume=${compose_metadata#*$'\n'}
[[ "$postgres_volume" != "$compose_metadata" && "$postgres_volume" != *$'\n'* ]] ||
    fail 'merged Compose metadata was malformed'

printf 'Loading release images for %s...\n' "$release_id"
docker load --input "$release_dir/images.tar" >/dev/null
docker image inspect "${image_values[API_IMAGE]}" "${image_values[WEB_IMAGE]}" >/dev/null

# Only the two public third-party images are pulled. Application images came from images.tar.
"${compose[@]}" pull postgres compose-dashboard

postgres_container=$("${compose[@]}" ps --all --quiet postgres)
if [[ -n "$postgres_container" ]]; then
    backup_dir="$deploy_root/backups"
    if [[ -e "$backup_dir" && ! -d "$backup_dir" ]]; then
        fail 'backups exists but is not a directory'
    fi
    if [[ ! -e "$backup_dir" ]]; then
        mkdir -m 700 -- "$backup_dir"
    fi
    [[ ! -L "$backup_dir" ]] || fail 'backups must not be a symlink'
    [[ "$(realpath -e -- "$backup_dir")" == "$backup_dir" ]] || fail 'backups must stay inside DEPLOY_ROOT'
    [[ "$(stat -c '%a' -- "$backup_dir")" =~ ^[0-7]00$ ]] ||
        fail 'backups directory must not grant access to group or other users'

    backup_timestamp=$(date -u +%Y%m%dT%H%M%SZ)
    backup_path=$(mktemp "$backup_dir/postgres-$backup_timestamp-$release_id.XXXXXX.dump")
    printf 'Backing up the existing PostgreSQL database to %s...\n' "$backup_path"
    if ! "${compose[@]}" exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -Fc tripdb' > "$backup_path"; then
        rm -f -- "$backup_path"
        fail 'PostgreSQL backup failed; the release was not started'
    fi
else
    if docker volume inspect "$postgres_volume" >/dev/null 2>&1; then
        fail 'the PostgreSQL volume exists without its container; refusing to skip the backup'
    fi
    [[ -z "$old_release_id" ]] ||
        fail 'current points to an earlier release but its PostgreSQL container is missing'
    printf '%s\n' 'No existing PostgreSQL container was found; treating this as the first deployment.'
fi

"${compose[@]}" up --detach --wait --wait-timeout 180

published_web_address=$("${compose[@]}" port web 5000)
if [[ "$published_web_address" =~ ^127\.0\.0\.1:([0-9]+)$ ]]; then
    published_web_port=${BASH_REMATCH[1]}
    health_url="http://$published_web_address/health"
elif [[ "$published_web_address" =~ ^\[::1\]:([0-9]+)$ ]]; then
    published_web_port=${BASH_REMATCH[1]}
    health_url="http://$published_web_address/health"
else
    fail 'web port 5000 is not published on a loopback address'
fi
published_web_port_number=$((10#$published_web_port))
(( published_web_port_number >= 1 && published_web_port_number <= 65535 )) ||
    fail 'web port 5000 has an invalid published port'

health_ok=false
for (( health_attempt = 1; health_attempt <= 30; health_attempt++ )); do
    if curl --fail --silent --show-error --max-time 10 --header "Host: $public_host" "$health_url" |
        python3 -c '
import json
import sys

try:
    response = json.load(sys.stdin)
except (json.JSONDecodeError, TypeError):
    raise SystemExit(1)
raise SystemExit(0 if isinstance(response, dict) and response.get("status") == "ok" else 1)
'; then
        health_ok=true
        break
    fi
    sleep 2
done
[[ "$health_ok" == true ]] || fail 'web gateway /health did not return HTTP 200'

current_tmp="$deploy_root/.current.$$.tmp"
previous_tmp="$deploy_root/.previous.$$.tmp"
cleanup_pointer_temps() {
    rm -f -- "$current_tmp" "$previous_tmp"
}
trap cleanup_pointer_temps EXIT

if [[ -n "$old_release_id" && "$old_release_id" != "$release_id" ]]; then
    ln -s "releases/$old_release_id" "$previous_tmp"
    mv -Tf -- "$previous_tmp" "$previous_path"
fi

ln -s "releases/$release_id" "$current_tmp"
mv -Tf -- "$current_tmp" "$current_path"

trap - ERR
printf 'Release %s is healthy and is now current.\n' "$release_id"
