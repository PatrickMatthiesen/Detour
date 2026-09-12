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
| `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`, `GARAGE_SECRET_ACCESS_KEY` | Three independent random 64-character hex secrets; retain across deployments |
| `GARAGE_ACCESS_KEY_ID` | Stable S3 key ID: `GK` followed by 24 random hexadecimal characters |
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

Production uses Compose project `detour` and persistent volumes derived from `detour-postgres-data` and `detour-garage-data`. Keep backups of the database, Garage volume and authentication keys. Do not delete volumes during updates. Production does not import the private development seed or legacy photo backup automatically. See [photo migration](photos.md).

Garage's S3/admin/RPC ports are internal to the Compose network. The API receives the bucket connection string; the separate one-shot provisioner receives admin credentials and creates the bucket before the API starts. The workflow downloads the checksum-pinned hosting integration and uses a digest-pinned provisioner image. Configure the four Garage secrets once before the first photo-enabled deployment; the workflow fails early if they are missing instead of generating new credentials on each CI run.

After deploying the photo-enabled version, verify an authenticated image import and reload before migrating the remaining legacy photos. Keep the local backup until the production migration is confirmed.
