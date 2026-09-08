# Detour

Detour is a personal Japan trip planner. The server owns the trip data; ChatGPT is the research and data-entry partner through the authenticated MCP endpoint.

## Run locally

Prerequisites:

- .NET SDK 10 or later
- Aspire CLI 13.6 or later
- Docker Desktop running
- Bun for frontend dependencies, builds, and tests
- Node.js/npm (currently used by Aspire to launch the Vite development server)

Start the full development graph from the repository root:

```powershell
aspire start --non-interactive
aspire describe --format Json --non-interactive
```

Aspire starts PostgreSQL with a persistent data volume (`postgres`) and the `tripdb` database, then starts the API and Vite web app. If present, the first development run seeds `data/japan-2026.seed.json`. Personal trip data and source exports are kept out of Git. Add places manually or through MCP, or use `scripts/prepare-japan-seed.py` with your own exports to prepare a local seed.

The dashboard URL, including its login token, is printed by `aspire start`. Use the web endpoint shown in the dashboard for the planner. Stop the graph when finished:

```powershell
aspire stop --non-interactive
```

## Compose publication

The AppHost includes Aspire's Docker Compose environment. Generate a reviewable Compose bundle without deploying it:

```powershell
aspire publish --non-interactive -o artifacts/compose
```

This writes `docker-compose.yaml`, a placeholder `.env`, and the generated frontend Dockerfile under `artifacts/compose`. Configure image names, registry credentials, and deployment secrets through the target environment before running a deployment. Do not commit the generated `.env` or private source data. See [self-hosting](docs/self-hosting.md) and the production override in `deploy/compose.production.yaml` for the single-hostname Cloudflare Tunnel layout.

## ChatGPT MCP connection

The API exposes MCP at `/mcp` using the official C# MCP SDK. It shares owner-scoped persistence and validation with the HTTP API. ASP.NET Core Identity with Google sign-in handles browser sessions; OpenIddict supplies OAuth authorization for ChatGPT. The optional local-development owner is restricted to explicitly enabled local development. See [authentication](docs/authentication.md) for credentials, client registration, and key configuration. Google sign-in and a live ChatGPT connection require configuration and end-to-end verification on the chosen hostname.

## Tests

```powershell
dotnet test tests/Detour.Api.Tests/Detour.Api.Tests.csproj
Push-Location web
bun run test
bun run build
Pop-Location
```

## Current data and behavior

The development seed is personal local data and is not included in the public repository. Place selection does not schedule an activity. City stays allocate time; confirmed hotel booking dates determine accommodation coverage. Unknown durations remain visible in daily capacity calculations. Packing and preparation tasks are editable manually and through the trip tools. Reminders are shown in the app; no push/email delivery runs in the background.

Map markers for cities are explicitly approximate. Places without resolved coordinates remain in the list. Dashed area rings are illustrative planning regions, not city boundaries. Travel estimates are editable.

The working app opens at `/` (Places) and `/plan`. The approved design preview remains at `/4`; numbered routes are experiments. City-stay editing and preparation still use the earlier interface.

Photo sources, authors and licenses are listed in [photo credits](web/public/design-photos/ATTRIBUTION.md).
