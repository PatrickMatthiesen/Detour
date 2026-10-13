# Google Calendar sync

Detour can copy scheduled trip records to a separate Google calendar named `Detour trips`. The connection is optional. Detour never writes to the Google account's primary calendar and never imports or changes personal events.

## Google Cloud setup

Use the same Google OAuth client configured under `Auth:Google`. In the Google Cloud project:

1. Enable the Google Calendar API.
2. Add `https://www.googleapis.com/auth/calendar.app.created` to the OAuth consent screen.
3. Add `<public Detour origin>/signin-google-calendar` as an authorized redirect URI. Keep the existing `/signin-google` URI used for Detour sign-in.
4. If the consent screen is in testing mode, add each Detour owner as a test user.

No additional client ID or secret is required. Calendar connection requests offline access and explicit consent so Google returns a refresh token. Detour encrypts that refresh token with ASP.NET Core Data Protection. Production must keep `DataProtection:KeysPath` on persistent, private storage. Losing those keys requires reconnecting Google Calendar.

## Behavior

The Plan page starts the connection. Google consent creates a secondary calendar owned by the connected account. Detour then syncs saved activities, stays, bookings, travel legs, and trip arrival or departure anchors. Saved place ideas are not calendar events.

The worker reads the persisted trip JSON and checks for newer trip versions every 15 seconds, so sync continues after the browser closes. A manual retry queues another attempt. Transient Google errors use a short HTTP retry followed by a database-backed retry delay. An expired or revoked grant stops retries and asks the user to reconnect.

Event IDs come from a stable hash of the Detour record key. Detour tracks the events it manages and deletes only tracked events that disappear from the projection. It never lists, imports, or deletes unrelated Google events.

Disconnecting deletes the local encrypted credential and event tracking. The remote `Detour trips` calendar remains in Google Calendar. A later connection creates a new Detour calendar.

Google can create a calendar and lose the HTTP response before Detour receives its ID. Detour records each creation attempt before calling Google. If the result is uncertain, it does not issue another create request. The status reports an error and requires disconnecting before reconnecting. This avoids automatic duplicate creation, though the uncertain calendar may remain in the Google account.

A definite rate-limit rejection (HTTP 429) leaves creation available for retry. Network failures, server failures, and unreadable success responses keep the creation guard because Google may already have created the calendar. Reconnecting after an uncertain outcome preserves an actionable error and the Disconnect control.

The per-owner synchronization lock is process-local. The current self-hosted deployment runs one API process, which matches this design. Multiple API replicas would require a distributed lock before enabling calendar sync.

## API

Calendar API requests share the per-owner request budget. Connection changes and sync retries also use the owner concurrency limit. Calendar authorization and callback requests use the OAuth request limit before authentication.

All calendar routes use the browser's Detour session. Bearer tokens cannot connect, retry, or disconnect the integration. Cookie-authenticated mutations also require the normal `X-CSRF-TOKEN` header.

- `GET /api/calendar` returns configuration, connection, last-sync, and error state.
- `POST /api/calendar/connect` returns `{ "url": "/auth/calendar/connect" }`. Navigate the browser to that URL to start Google consent.
- `POST /api/calendar/sync` queues a retry.
- `DELETE /api/calendar` disconnects Detour and returns the disconnected status. It leaves the Google calendar intact.

The OAuth callback path is `/signin-google-calendar`. Detour binds its protected OAuth state to the signed-in local owner and verifies that the same browser session is present at callback time. Reconnecting with a different Google account is rejected until the existing connection is disconnected.
