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

Aspire starts PostgreSQL, Garage object storage and a one-shot bucket provisioner before the API and Vite web app. Both databases and photos use persistent volumes. If present, the first development run seeds `data/japan-2026.seed.json`. Personal trip data and source exports are kept out of Git. Add places manually or through MCP, or use `scripts/prepare-japan-seed.py` with your own exports to prepare a local seed.

The dashboard URL, including its login token, is printed by `aspire start`. Use the web endpoint shown in the dashboard for the planner. Stop the graph when finished:

```powershell
aspire stop --non-interactive
```

## Compose publication

The AppHost includes Aspire's Docker Compose environment. Generate a reviewable Compose bundle without deploying it:

```powershell
aspire publish --non-interactive -o artifacts/compose
```

This writes Compose artifacts and parameter placeholders under `artifacts/compose`. AppHost packages the React build into the API container for production. Do not commit generated environment files or private source data. See [self-hosting](docs/self-hosting.md) for the single-hostname Cloudflare Tunnel setup.

## ChatGPT MCP connection

The API exposes MCP at `/mcp` using the official C# MCP SDK. It shares owner-scoped persistence and validation with the HTTP API. ASP.NET Core Identity with Google sign-in handles browser sessions; OpenIddict supplies OAuth authorization for ChatGPT. The optional local-development owner is restricted to explicitly enabled local development.

To configure the plugin in ChatGPT:

1. Create a new plugin with **Server URL** `https://detour.patrickbm.com/mcp` and **Authentication** `OAuth`.
2. Open **Advanced OAuth settings**. Choose **User-Defined OAuth Client**, enter client ID `detour-chatgpt`, leave the client secret empty, and select token endpoint auth method `none`.
3. Check the discovered **Auth URL** is `https://detour.patrickbm.com/connect/authorize`, **Token URL** is `https://detour.patrickbm.com/connect/token`, and **Resource** is `https://detour.patrickbm.com/mcp`. Leave Registration URL empty; DCR/CIMD are not used.
4. Select default scopes `openid`, `email`, `offline_access`, `profile`, and `tripadvisor_api`.
5. Copy the displayed **Callback URL** (currently `https://chatgpt.com/connector_platform_oauth_redirect`) into Detour's `Auth__OAuth__RedirectUris__0` configuration. The server's `Auth__OAuth__ClientId` must match `detour-chatgpt`.
6. Accept the custom MCP server warning, click **Create**, and complete Google sign-in with an allowed owner account.
7. In **Settings → Plugins → Detour**, confirm the connection is present. If Actions is empty, click **Refresh**; the catalog should include `get_trip`, `search_places`, and seven trip edit actions. Place photo import and removal are part of `edit_place`.
8. Start a new chat, type `@Detour`, select this plugin, and ask it to read the trip overview. If it is missing from the picker, reload ChatGPT. If an older development plugin is also installed, select the new Detour connection.

The resource is the complete `/mcp` URL; `tripadvisor_api` is the permission scope. See [authentication](docs/authentication.md) for deployment credentials, OAuth discovery, and troubleshooting.

See the [agent tool guide](docs/mcp-tools.md) for focused edits, partial-update semantics, paging, and conflict recovery.

## Deployment

GitHub Actions runs verification on pushes and pull requests. The manual **Deploy Detour** workflow builds through Aspire and deploys through Tailscale/SSH after verification, using the `Production` environment. See [self-hosting and workflow setup](docs/self-hosting.md). Deployment secrets come from the GitHub Production environment; persistent authentication certificates and keys stay on the server.

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

Map markers for cities are explicitly approximate. Dashed area rings are illustrative planning regions, not city boundaries, and expand to enclose every resolved place in their city group. They keep an approximate default size when a group has no resolved coordinates, while places without coordinates remain in the list. Travel estimates are editable.

The working app opens at `/` (Places), `/plan` (daily planning and whole-trip calendar), and `/preparation` (checklist and packing). Plan includes city-route, journey and booking editors, compact place details and a full-size photo viewer. Prepare supports task due dates and in-app reminders, plus category- and bag-filtered packing. The approved design preview remains at `/4`; numbered routes are experiments.

Place photos live in a private Garage bucket, not in this repository or the frontend deployment. Each place can have one photo with its source, author, caption and license. The API authenticates photo requests; it does not expose Garage credentials or public object URLs. Neighbourhood and illustrative photos are labelled, and unavailable photos show a placeholder.

The [Garage integration](https://www.nuget.org/packages/Subjective.Aspire.Hosting.Garage/) restores from NuGet.org through the normal Aspire build. The provisioner image is pinned by digest.

See [photo imports and migration](docs/photos.md) for agent tools and importing existing pictures.
