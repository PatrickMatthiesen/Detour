# Self-hosting Detour

Development runs Vite, the API, and PostgreSQL through Aspire. Production uses `api.PublishWithContainerFiles(web, "/app/wwwroot")`: the API container serves the built React app as well as API, login, and MCP endpoints. There is no separate frontend gateway or Compose override.

Traffic: browser/ChatGPT → Cloudflare HTTPS → cloudflared on the server → Detour API at `127.0.0.1:8080` → PostgreSQL. The database has no published host port, and the production Aspire dashboard is disabled. The API accepts forwarded HTTPS headers on this loopback-only ingress; keep the Docker network private. Do not expose that HTTP port publicly.

## GitHub Actions

The manual **Deploy Detour** workflow runs from `main`, verifies the backend and frontend, connects over Tailscale, selects an SSH Docker context, and runs `aspire deploy --environment Production`. This follows Cantaro's deployment pattern. Aspire builds and deploys the application; no custom image packaging or release scripts are involved. Pushes and pull requests only run CI.

Configure the GitHub **Production** environment:

| Secrets | Purpose |
| --- | --- |
| `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` | Tailscale CI credentials, authorized for `tag:ci` |
| `SSH_HOST`, `SSH_USER` | Tailscale SSH target with Docker access |
| `POSTGRES_PASSWORD` | Persistent database password; retain across deployments |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google web OAuth client |
| `OWNER_EMAIL` | Allowed Google account |
| `SIGNING_CERTIFICATE_PASSWORD`, `ENCRYPTION_CERTIFICATE_PASSWORD` | Passwords for the server's persistent PFX files |

| Variables | Value |
| --- | --- |
| `CHATGPT_CLIENT_ID` | Registered ChatGPT OAuth client ID |
| `CHATGPT_REDIRECT_URI` | Exact callback supplied by ChatGPT |
| `PUBLIC_URL` | Defaults to `https://detour.bmstack.net` |
| `AUTH_CERTIFICATES_DIR` | Server directory, default `/srv/detour/certificates` |
| `AUTH_KEYS_DIR` | Server directory, default `/srv/detour/keys` |

## Server setup

1. Provide Docker/Compose and curl, join the tailnet, and authorize the CI node to SSH as the deployment user, as for Cantaro. Port 8080 must be free.
2. Place persistent `signing.pfx` and `encryption.pfx` in the certificates directory. Create the cookie-key directory. The API container user must be able to read the certificates and write cookie keys. See [authentication](authentication.md). These bind-mount paths refer to the server, not the GitHub runner.
3. Configure Google's callback as `https://detour.bmstack.net/signin-google`.
4. Run **Deploy Detour** from Actions, then point the hostname's Cloudflare Tunnel route to `http://127.0.0.1:8080` on the same server. Do not put an interactive Cloudflare Access challenge in front of OAuth/MCP routes.
5. Verify Google login, rejected users, OAuth discovery, and a ChatGPT read/write round trip. The workflow checks local HTTP health; external OAuth still needs this first-deployment check.

Production uses Compose project `detour` and persistent PostgreSQL storage derived from `detour-postgres-data`. Keep backups of the database and authentication keys. Do not delete volumes during updates. Production does not import the private development seed automatically.

Deployment has not yet been exercised on the target server. Server credentials, certificate provisioning, and the tunnel route are configured when ready to deploy.
