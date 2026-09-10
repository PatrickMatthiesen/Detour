# Self-hosting Detour

Development runs Vite, the API, and PostgreSQL through Aspire. Production uses `api.PublishWithContainerFiles(web, "/app/wwwroot")`: the API container serves the built React app as well as API, login, and MCP endpoints. There is no separate frontend gateway or Compose override.

Traffic: browser/ChatGPT → Cloudflare HTTPS → cloudflared on the proxy VM → Docker VM port `48327` → Detour API → PostgreSQL. Docker publishes `48327:8080` on all host interfaces. The API accepts forwarded HTTPS headers from the trusted local network; network access is managed by the firewall. The database has no published host port, and the production Aspire dashboard is disabled.

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

| Variables | Value |
| --- | --- |
| `CHATGPT_CLIENT_ID` | Registered ChatGPT OAuth client ID |
| `CHATGPT_REDIRECT_URI` | Exact callback supplied by ChatGPT |
| `PUBLIC_URL` | Defaults to `https://detour.patrickbm.com` |
| `AUTH_KEYS_DIR` | Server directory, default `/srv/detour/keys` |

## Server setup

1. Provide Docker/Compose and curl, join the tailnet, and authorize the CI node to SSH as the deployment user, as for Cantaro. Host port 48327 must be free.
2. Create the persistent keys directory (default `/srv/detour/keys`) and grant the API container user write access. Detour generates and renews OAuth credentials there automatically and also persists browser cookie keys. No certificates or passwords need to be copied or configured. See [authentication](authentication.md). This bind-mount path refers to the server, not the GitHub runner.
3. Configure Google's callback as `https://detour.patrickbm.com/signin-google`.
4. Run **Deploy Detour** from Actions, then point the hostname's Cloudflare Tunnel route to `http://<docker-vm-lan-ip>:48327` from the proxy VM. Do not put an interactive Cloudflare Access challenge in front of OAuth/MCP routes.
5. Verify Google login, rejected users, OAuth discovery, and a ChatGPT read/write round trip. The workflow checks local HTTP health; external OAuth still needs this first-deployment check.

Production uses Compose project `detour` and persistent PostgreSQL storage derived from `detour-postgres-data`. Keep backups of the database and authentication keys. Do not delete volumes during updates. Production does not import the private development seed automatically.

Deployment has not yet been exercised on the target server. Server credentials, the writable keys directory, and the tunnel route are configured when ready to deploy.
