# Self-hosting through Cloudflare Tunnel

The local Aspire graph and generated Compose bundle are separate from a live deployment. No server, DNS record, or tunnel has been changed. The user owns `patrickbm.com` and `bmstack.net`; choose a subdomain once the server target is confirmed. Examples below use `trips.patrickbm.com` as a proposed hostname, not an existing deployment.

## Traffic path

Browser and ChatGPT → Cloudflare HTTPS → existing cloudflared connector → web gateway → API → PostgreSQL.

Use one hostname. The web gateway serves static files and forwards `/api`, `/auth`, `/connect`, `/signin-google`, `/.well-known`, and `/mcp` to the API. A tunnel route maps the public hostname to the local service; see [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/setup/). The supplied override binds web to `127.0.0.1:8080` for a connector running on the same server. A connector running in a container needs the matching private Docker network/service address instead of its own localhost.

The application owns authentication. Do not place an interactive Cloudflare Access challenge in front of MCP/discovery/token routes: ChatGPT must be able to reach the OAuth endpoints and then use its issued bearer token. This does not require making trip data anonymous.

## Prepare the bundle

1. Run `aspire publish --non-interactive -o artifacts/compose` from the repository root.
2. Build/publish the API and generated web images for the server's architecture. Set `API_IMAGE`, `WEB_IMAGE`, `API_PORT` and `POSTGRES_PASSWORD` in a private deployment env file. The generated image placeholders are not already published images.
3. Apply `deploy/compose.production.yaml` after `artifacts/compose/docker-compose.yaml`. Docker Compose 2.24.4 or newer supports the override tags used to remove public API/dashboard ports and bind web to loopback. See [Compose merge rules](https://docs.docker.com/reference/compose-file/merge/).
4. Configure the authentication environment variables named in the override. Use a Google OAuth web client whose authorized callback is `https://YOUR_HOST/signin-google`. Follow `authentication.md` for the implemented OAuth client and key configuration.
5. Supply persistent signing/encryption PFX files named `signing.pfx` and `encryption.pfx`. Set absolute `AUTH_CERTIFICATES_DIR` and `AUTH_KEYS_DIR` paths on the server. The API container user must be able to read certificates and write cookie-protection keys. Keep both directories and the database in backups. Do not regenerate signing material on every restart.
6. Choose an unused private subnet for `APP_NETWORK_SUBNET`, its `APP_NETWORK_GATEWAY`, and a fixed `WEB_PROXY_IP` in that subnet. For example, only after checking for conflicts: `172.30.50.0/24`, `172.30.50.1`, and `172.30.50.254`. The API trusts only that web container IP. It is not `127.0.0.1` across containers. The override disables Aspire's automatic forwarding on the API, then enables it on the loopback-published gateway so it restores cloudflared's external HTTPS scheme before YARP forwards to the API. Keep this network private to the app and its gateway. Confirm the tunnel supplies `X-Forwarded-Proto: https` and that OAuth issuer/callback URLs remain the canonical external HTTPS URL through both hops.

Required deployment values include `PUBLIC_URL` (e.g. `https://trips.patrickbm.com/`), `PUBLIC_HOST`, `OWNER_EMAIL`, Google client credentials, ChatGPT client ID and exact callback URI, PFX passwords and persistent directories. The Google client and the ChatGPT client are different OAuth registrations. Keep the private env file outside version control and avoid printing rendered Compose configuration containing secrets.

From the repository root, validate the merged model without displaying secret values:

```sh
docker compose --env-file /private/path/tripadvisor.env -f artifacts/compose/docker-compose.yaml -f deploy/compose.production.yaml config --quiet
```

The production seed is intentionally not auto-loaded for every new user. Transfer the initial trip to the permitted owner through the supported authenticated workflow; never expose a shared development owner publicly.

## Deployment verification

Before setting the tunnel route, start the configured bundle on the target and check its logs/health. Verify that PostgreSQL and the API have no public host bindings. Then route the chosen hostname to the web gateway.

Verify Google sign-in, sign-out, and rejected users; a trip edit surviving restart; OAuth discovery; ChatGPT authorization and a read/write round trip to the same user's trip. Confirm requests without credentials cannot read trip data. A valid Compose model alone is not proof of a working Google or ChatGPT connection.

Rollback by removing/disabling only the newly added hostname route and stopping this application's bundle. Preserve PostgreSQL data and key directories. Do not remove volumes as part of routine rollback.
