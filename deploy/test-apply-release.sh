#!/usr/bin/env bash

set -Eeuo pipefail
IFS=$'\n\t'

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
apply_script="$script_dir/apply-release.sh"
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT

new_release=0123456789abcdef0123456789abcdef01234567
old_release=abcdef0123456789abcdef0123456789abcdef01

docker() {
    local IFS=' '
    local arguments=" $* "
    printf 'docker %s\n' "$*" >> "$MOCK_LOG"

    case "$arguments" in
        *' config --quiet '*) return 0 ;;
        *' config --format json '*)
            printf '%s\n' '{"services":{"postgres":{"volumes":[{"type":"volume","source":"detour-postgres-data","target":"/var/lib/postgresql"}]},"api":{"environment":{"AllowedHosts":"detour.example.test","SigningPassword":"supersecret"}},"web":{"environment":{"REVERSEPROXY__ROUTES__health__MATCH__PATH":"/health","REVERSEPROXY__ROUTES__health__CLUSTERID":"api"}},"compose-dashboard":{}},"volumes":{"detour-postgres-data":{"name":"detour-postgres-data"}}}'
            return 0
            ;;
        *' load --input '*) return 0 ;;
        *' image inspect '*) return 0 ;;
        *' pull postgres compose-dashboard '*) return 0 ;;
        *' ps --all --quiet postgres '*)
            if [[ "$MOCK_SCENARIO" != first && "$MOCK_SCENARIO" != orphan-volume ]]; then
                printf '%s\n' existing-postgres
            fi
            return 0
            ;;
        *' exec -T postgres sh -c '*)
            printf '%s\n' fake-postgres-custom-backup
            [[ "$MOCK_SCENARIO" != backup-failure ]]
            ;;
        *' up --detach --wait --wait-timeout 180 '*) return 0 ;;
        *' port web 5000 '*)
            printf '%s\n' '127.0.0.1:18080'
            return 0
            ;;
        *' volume inspect detour-postgres-data '*)
            [[ "$MOCK_SCENARIO" == orphan-volume ]]
            ;;
        *)
            printf 'Unexpected docker invocation: %s\n' "$*" >&2
            return 97
            ;;
    esac
}

curl() {
    local IFS=' '
    printf 'curl %s\n' "$*" >> "$MOCK_LOG"
    if [[ "$MOCK_SCENARIO" == health-failure ]]; then
        return 22
    fi
    printf '%s\n' '{"status":"ok"}'
}

sleep() {
    :
}

export -f docker curl sleep

make_fixture() {
    local name=$1
    local with_current=${2:-yes}
    local root="$test_root/$name"
    local release="$root/releases/$new_release"

    mkdir -p "$release"
    printf '%s\n' 'PUBLIC_HOST=detour.example.test' 'SIGNING_PASSWORD=supersecret' > "$root/production.env"
    chmod 600 "$root/production.env"
    printf '%s\n' 'services: {}' > "$release/docker-compose.yaml"
    printf '%s\n' 'services: {}' > "$release/compose.production.yaml"
    printf 'API_IMAGE=detour-api:%s\nWEB_IMAGE=detour-web:%s\nAPI_PORT=8080\n' \
        "$new_release" "$new_release" > "$release/images.env"
    printf '%s\n' fake-image-archive > "$release/images.tar"

    if [[ "$with_current" == yes ]]; then
        mkdir -p "$root/releases/$old_release"
        ln -s "releases/$old_release" "$root/current"
    fi

    printf '%s' "$root"
}

run_apply() {
    local root=$1
    local scenario=$2
    MOCK_LOG="$root/mock.log"
    MOCK_SCENARIO=$scenario
    export MOCK_LOG MOCK_SCENARIO

    set +e
    run_output=$(bash "$apply_script" "$root" "$new_release" 2>&1)
    run_status=$?
    set -e
}

assert_equals() {
    local expected=$1
    local actual=$2
    local message=$3
    if [[ "$actual" != "$expected" ]]; then
        printf 'not ok - %s (expected %q, got %q)\n' "$message" "$expected" "$actual" >&2
        exit 1
    fi
}

assert_contains() {
    local haystack=$1
    local needle=$2
    local message=$3
    if [[ "$haystack" != *"$needle"* ]]; then
        printf 'not ok - %s (missing %q)\n' "$message" "$needle" >&2
        exit 1
    fi
}

assert_file_absent() {
    local path=$1
    local message=$2
    if [[ -e "$path" || -L "$path" ]]; then
        printf 'not ok - %s (%s exists)\n' "$message" "$path" >&2
        exit 1
    fi
}

test_existing_deployment_success() {
    local root
    local backup_line
    local up_line
    local backup_file
    root=$(make_fixture existing-success)
    run_apply "$root" success

    assert_equals 0 "$run_status" 'existing deployment succeeds'
    assert_equals "releases/$new_release" "$(readlink "$root/current")" 'current points to the healthy release'
    assert_equals "releases/$old_release" "$(readlink "$root/previous")" 'previous retains the old release'

    backup_file=$(find "$root/backups" -maxdepth 1 -type f -name '*.dump' -print -quit)
    [[ -n "$backup_file" ]] || { printf '%s\n' 'not ok - backup file was not created' >&2; exit 1; }
    assert_equals 600 "$(stat -c '%a' "$backup_file")" 'backup is private'

    backup_line=$(grep -n ' exec -T postgres ' "$root/mock.log" | cut -d: -f1)
    up_line=$(grep -n ' up --detach --wait --wait-timeout 180' "$root/mock.log" | cut -d: -f1)
    (( backup_line < up_line )) || { printf '%s\n' 'not ok - backup did not happen before up' >&2; exit 1; }
    grep -q ' pull postgres compose-dashboard$' "$root/mock.log" || { printf '%s\n' 'not ok - expected public image pull was not made' >&2; exit 1; }
    ! grep -Eq ' pull .*\b(api|web)\b' "$root/mock.log" || { printf '%s\n' 'not ok - application images were pulled' >&2; exit 1; }
    grep -q 'curl .*--header Host: detour.example.test http://127.0.0.1:18080/health' "$root/mock.log" ||
        { printf '%s\n' 'not ok - health request did not use loopback and PUBLIC_HOST' >&2; exit 1; }
    [[ "$run_output" != *supersecret* ]] || { printf '%s\n' 'not ok - rendered Compose secret leaked to output' >&2; exit 1; }

    printf '%s\n' 'ok - backup precedes a successful update and pointers are retained'
}

test_backup_failure_aborts() {
    local root
    root=$(make_fixture backup-failure)
    run_apply "$root" backup-failure

    [[ "$run_status" -ne 0 ]] || { printf '%s\n' 'not ok - backup failure unexpectedly succeeded' >&2; exit 1; }
    assert_equals "releases/$old_release" "$(readlink "$root/current")" 'backup failure preserves current'
    assert_file_absent "$root/previous" 'backup failure does not update previous'
    ! grep -q ' up --detach ' "$root/mock.log" || { printf '%s\n' 'not ok - release started after backup failure' >&2; exit 1; }
    [[ -z "$(find "$root/backups" -maxdepth 1 -type f -name '*.dump' -print -quit)" ]] ||
        { printf '%s\n' 'not ok - partial backup was retained' >&2; exit 1; }
    assert_contains "$run_output" 'not rolled back automatically' 'backup failure explains rollback policy'

    printf '%s\n' 'ok - backup failure aborts before compose up'
}

test_first_deployment_skips_backup() {
    local root
    root=$(make_fixture first-deployment no)
    run_apply "$root" first

    assert_equals 0 "$run_status" 'first deployment succeeds'
    assert_equals "releases/$new_release" "$(readlink "$root/current")" 'first deployment sets current'
    assert_file_absent "$root/previous" 'first deployment has no previous release'
    ! grep -q ' exec -T postgres ' "$root/mock.log" || { printf '%s\n' 'not ok - first deployment attempted a backup' >&2; exit 1; }
    grep -q ' up --detach --wait --wait-timeout 180' "$root/mock.log" || { printf '%s\n' 'not ok - first deployment did not start' >&2; exit 1; }

    printf '%s\n' 'ok - first deployment is distinguished from an existing database'
}

test_pointer_updates_only_after_health() {
    local root
    root=$(make_fixture health-failure)
    run_apply "$root" health-failure

    [[ "$run_status" -ne 0 ]] || { printf '%s\n' 'not ok - unhealthy deployment unexpectedly succeeded' >&2; exit 1; }
    assert_equals "releases/$old_release" "$(readlink "$root/current")" 'health failure preserves current'
    assert_file_absent "$root/previous" 'health failure does not update previous'
    grep -q ' up --detach --wait --wait-timeout 180' "$root/mock.log" || { printf '%s\n' 'not ok - health failure did not exercise compose up' >&2; exit 1; }
    assert_contains "$run_output" 'not rolled back automatically' 'health failure explains rollback policy'

    printf '%s\n' 'ok - pointers update only after the health check succeeds'
}

test_rerun_keeps_previous_pointer() {
    local root
    root=$(make_fixture rerun)
    rm "$root/current"
    ln -s "releases/$new_release" "$root/current"
    ln -s "releases/$old_release" "$root/previous"
    run_apply "$root" success

    assert_equals 0 "$run_status" 'same-release rerun succeeds'
    assert_equals "releases/$new_release" "$(readlink "$root/current")" 'rerun keeps current release'
    assert_equals "releases/$old_release" "$(readlink "$root/previous")" 'rerun preserves the rollback release'

    printf '%s\n' 'ok - rerunning the current release preserves previous'
}

test_orphan_volume_aborts() {
    local root
    root=$(make_fixture orphan-volume no)
    run_apply "$root" orphan-volume

    [[ "$run_status" -ne 0 ]] || { printf '%s\n' 'not ok - orphaned database volume unexpectedly deployed' >&2; exit 1; }
    assert_file_absent "$root/current" 'orphaned volume does not set current'
    ! grep -q ' up --detach ' "$root/mock.log" || { printf '%s\n' 'not ok - orphaned volume proceeded to compose up' >&2; exit 1; }
    assert_contains "$run_output" 'volume exists without its container' 'orphaned volume reports the backup risk'

    printf '%s\n' 'ok - an existing database volume cannot be mistaken for first deployment'
}

test_existing_deployment_success
test_backup_failure_aborts
test_first_deployment_skips_backup
test_pointer_updates_only_after_health
test_rerun_keeps_previous_pointer
test_orphan_volume_aborts
printf '%s\n' 'All apply-release tests passed.'
