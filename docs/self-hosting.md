# Self-hosting through Cloudflare Tunnel

The local Aspire graph and generated Compose bundle are separate from a live deployment. No server, DNS record, or tunnel has been changed. The selected hostname is `detour.bmstack.net`. Server access, credentials, and the tunnel route are configured separately.

## Traffic path

Browser and ChatGPT → Cloudflare HTTPS → existing cloudflared connector → web gateway → API → PostgreSQL.

The selected hostname for this installation is `detour.bmstack.net`; the intended MCP URL is `https://detour.bmstack.net/mcp`. This records the deployment target, not a verified live deployment. Server access and Google OAuth configuration are still required.

Use one hostname. The web gateway serves static files and forwards `/api`, `/auth`, `/connect`, `/signin-google`, `/.well-known`, and `/mcp` to the API. A tunnel route maps the public hostname to the local service; see [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/setup/). The supplied override binds web to `127.0.0.1:8080` for a connector running on the same server. A connector running in a container needs the matching private Docker network/service address instead of its own localhost.

The application owns authentication. Do not place an interactive Cloudflare Access challenge in front of MCP/discovery/token routes: ChatGPT must be able to reach the OAuth endpoints and then use its issued bearer token. This does not require making trip data anonymous.

## Prepare the bundle

1. Run `aspire publish --non-interactive -o artifacts/compose` from the repository root.
2. Build/publish the API and generated web images for the server's architecture. Set `API_IMAGE`, `WEB_IMAGE`, `API_PORT` and `POSTGRES_PASSWORD` in a private deployment env file. The generated image placeholders are not already published images.
3. Apply `deploy/compose.production.yaml` after `artifacts/compose/docker-compose.yaml`. Docker Compose 2.24.4 or newer supports the override tags used to remove public API/dashboard ports and bind web to loopback. See [Compose merge rules](https://docs.docker.com/reference/compose-file/merge/).
4. Configure the authentication environment variables named in the override. Use a Google OAuth web client whose authorized callback is `https://YOUR_HOST/signin-google`. Follow `authentication.md` for the implemented OAuth client and key configuration.
5. Supply persistent signing/encryption PFX files named `signing.pfx` and `encryption.pfx`. Set absolute `AUTH_CERTIFICATES_DIR` and `AUTH_KEYS_DIR` paths on the server. The API container user must be able to read certificates and write cookie-protection keys. Keep both directories and the database in backups. Do not regenerate signing material on every restart.
6. Choose an unused private subnet for `APP_NETWORK_SUBNET`, its `APP_NETWORK_GATEWAY`, and a fixed `WEB_PROXY_IP` in that subnet. For example, only after checking for conflicts: `172.30.50.0/24`, `172.30.50.1`, and `172.30.50.254`. The API trusts only that web container IP. It is not `127.0.0.1` across containers. The override disables Aspire's automatic forwarding on the API, then enables it on the loopback-published gateway so it restores cloudflared's external HTTPS scheme before YARP forwards to the API. Keep this network private to the app and its gateway. Confirm the tunnel supplies `X-Forwarded-Proto: https` and that OAuth issuer/callback URLs remain the canonical external HTTPS URL through both hops.

Required deployment values include `PUBLIC_URL` (e.g. `https://detour.bmstack.net/`), `PUBLIC_HOST`, `OWNER_EMAIL`, Google client credentials, ChatGPT client ID and exact callback URI, PFX passwords and persistent directories. The Google client and the ChatGPT client are different OAuth registrations. Keep the private env file outside version control and avoid printing rendered Compose configuration containing secrets.

From the repository root, validate the merged model without displaying secret values:

```sh
docker compose --env-file /private/path/tripadvisor.env -f artifacts/compose/docker-compose.yaml -f deploy/compose.production.yaml config --quiet
```

The production seed is intentionally not auto-loaded for every new user. Transfer the initial trip to the permitted owner through the supported authenticated workflow; never expose a shared development owner publicly.

## Deployment verification

Before setting the tunnel route, start the configured bundle on the target and check its logs/health. Verify that PostgreSQL and the API have no public host bindings. Then route the chosen hostname to the web gateway.

Verify Google sign-in, sign-out, and rejected users; a trip edit surviving restart; OAuth discovery; ChatGPT authorization and a read/write round trip to the same user's trip. Confirm requests without credentials cannot read trip data. A valid Compose model alone is not proof of a working Google or ChatGPT connection.

Rollback by removing/disabling only the newly added hostname route and stopping this application's bundle. Preserve PostgreSQL data and key directories. Do not remove volumes as part of routine rollback.

## GitHub Actions deployment

`Deploy Detour` is manually triggered from Actions on `main`. It runs the reusable `Verify Detour` workflow first (backend tests using isolated PostgreSQL schemas, frontend tests/build, and deployment-script tests), then enters the GitHub `Production` environment. Pushes and pull requests run verification only; they never deploy.

Like Cantaro, deployment uses Tailscale and SSH. Aspire generates Compose and the web Dockerfile on the runner. The .NET SDK builds the API container and Docker builds the web container with explicit commit tags, avoiding preview-version differences between Aspire build tags and deployment tags. The pipeline transfers only the Compose files, application images tagged with the commit SHA, the apply script, and three image/port variables. Aspire's generated environment/state files are not transferred or uploaded. No registry account is required: Docker images are loaded over SSH on the target.

Create the `Production` GitHub environment and configure:

| Type | Name | Purpose |
| --- | --- | --- |
| Secret | `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client used by the CI node |
| Secret | `TS_OAUTH_SECRET` | Matching OAuth secret; authorize the `tag:ci` node to reach the server |
| Secret | `SSH_HOST` | Server's Tailscale hostname or IPv4 address |
| Secret | `SSH_USER` | Deployment user with Docker access |
| Secret | `SSH_KNOWN_HOSTS` | Verified known_hosts entry for that exact host; obtain through a trusted connection |
| Secret, optional | `SSH_PRIVATE_KEY` | SSH key when not using Tailscale SSH authorization |
| Variable | `DEPLOY_ROOT` | Existing absolute server directory, e.g. `/srv/detour` |

The workflow uses verified host keys rather than trusting a fresh `ssh-keyscan` result during deployment. Restrict the environment to `main`; optionally add required reviewers. No existing Cantaro secrets or server configuration are copied or changed.

Prepare the Linux amd64 server once:

1. Install Docker Engine, Compose v2.24.4 or newer, Bash, Python 3, curl, and util-linux (`flock`). Connect it to the tailnet and authorize the CI deployment user. The user needs write access to `DEPLOY_ROOT` and access to Docker.
2. Put [the environment template](../deploy/.env.example) at `DEPLOY_ROOT/production.env`, replace all placeholders, and set permissions to `600`. Check that port 8080 and the selected private subnet are unused. This is the private configuration consumed directly on the server.
3. Provision the persistent PFX files and cookie-key directory described above. They must be accessible to the API container user; do not generate new keys per release. The intended Google callback is `https://detour.bmstack.net/signin-google`.
4. Trigger `Deploy Detour` from `main`. It loads the versioned images, backs up an existing trip database before updating containers, applies the production override, and checks the gateway's `/health` endpoint. On the first deployment there is no database to back up.
5. Complete the tunnel route and the Google/ChatGPT checks above. A successful container health check does not prove the external OAuth flow.

The Compose project is `detour`, with a stable production data volume derived from `detour-postgres-data`. Development keeps its existing volume naming. Before adopting this pipeline for an already-running manually deployed instance, inspect its volume name and migrate/attach that data deliberately; never assume a different name points to the same database.

Releases live under `DEPLOY_ROOT/releases/<commit-sha>`. `current` advances only after successful health checks; `previous` records the prior successful release. Database backups stay private under `DEPLOY_ROOT/backups`. Arrange off-host backups of the database, PFX files, cookie-protection keys, and production configuration, and test restores. The workflow does not delete old images, releases, backups, or volumes.

A failed deployment does not automatically restore a database or run `down -v`. The previous pointer remains available for investigation. For a rollback, inspect migration compatibility first, then reapply the chosen prior release with its script and the same production environment; restoring a database is a separate deliberate operation. Treat initial server setup and the first real deployment as unverified until exercised on your server.
