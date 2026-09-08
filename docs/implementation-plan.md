# Japan planner implementation

## Approved interface direction

Use the `/4` explorer approved on 9 September 2026 as the baseline. See [design-direction.md](design-direction.md) for the accepted layout, interactions, colour caveat and preview-to-production boundary.

## Product scope

Personal travel planning, designed so another person can self-host it later. The server is the source of truth. ChatGPT uses an MCP connection to research and write data; there is no built-in model or link-processing inbox. Manual editing remains available throughout the app. Notion/Gmail ingestion happens through the user's ChatGPT connectors, not separate application integrations.

Initial trip: solo Japan, 30 September–25 October 2026. Haneda arrival is 2 October 00:05 Japan time according to the supplied export; departure is 25 October 01:25 Japan time. Preserve the first hotel's 1 October check-in as an overnight-arrival booking, and the final day's airport transfer without inventing an extra hotel night.

## Essential behavior

- Saved places remain separate from trip selections and scheduled activities. Unselecting never deletes the library entry.
- City/area interest highlights nearby saved opportunities. It does not silently allocate nights or select surrounding places.
- Repeated stays in one city and visits outside the overnight base are supported.
- Date-only planning blocks and exact instants remain distinct. Hotel nights are based on booking check-in/check-out, not sightseeing blocks.
- Travel and visit durations are editable estimates. Unknown location and duration remain unknown.
- Fixed bookings remain visible when plans conflict; edits must not silently alter commitments.
- Tasks have completion and optional due dates. Initial reminders are in-app, not background push/email promises.
- Packing has category, quantity, packed state, optional bag and notes. Buying an item and packing it are separate actions.
- Original sources and research uncertainty survive imports and edits.
- Authenticated HTTP and MCP use the same validation and persistence. Concurrent edits must not overwrite newer data silently.

## Initial implementation lanes

1. Backend: persistence, HTTP contract, MCP tools, validation, focused tests.
2. Frontend: responsive library/map, itinerary, bookings, preparation and packing with working manual controls.
3. Aspire: PostgreSQL/API/web resource wiring, runnable deployment configuration and instructions.
4. Integration: sanitized real-data seed, round-trip and browser verification, reconcile contracts and document remaining setup.

## Real data

The supplied exports have 89 named places (plus one placeholder) and 30 itinerary records. They are input to a one-time development preparation script, not a public import feature. Seed data must remove confirmation references and other private booking metadata. Keep source CSVs outside the repository. Existing source statuses such as Planned do not establish a precise schedule or a confirmed purchase by themselves.

## Authentication and hosting decision

Use ASP.NET Core Identity with Google external login for the browser. OpenIddict supplies the authorization-code/PKCE OAuth server needed by the ChatGPT MCP client, with the same local user identity as the browser. Google credentials, the permitted initial user, persistent signing material, and the final public hostname are deployment configuration. The user owns patrickbm.com and bmstack.net and intends to use an existing server through Cloudflare Tunnel. Do not publish a development bypass or replace existing server configuration without inspecting the actual target.

## Deferred features

Purchasing, Gmail/Notion APIs, autonomous extraction, exact public-transit routing, collaborative editing, full offline synchronization, outbound reminders, and public plugin-directory publication. ChatGPT connection requires reachable MCP transport and configured authentication; local startup alone is not proof of a connected plugin.

## Validation

Build all projects; run focused backend/frontend tests; start through Aspire and wait for resources; exercise persistent CRUD and conflict responses; inspect desktop and mobile UI once, fix functional findings together, then confirm. Validate MCP discovery and tool calls separately from any actual ChatGPT connection, and report which was achieved.
