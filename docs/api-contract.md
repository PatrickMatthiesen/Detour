# Frontend API contract

The frontend treats the backend as authoritative and uses `GET /api/trip` for the initial trip snapshot. Mutations can use `PUT /api/trip` with the complete snapshot and an optimistic version; the client also supports resource endpoints when they are added.

The expected snapshot shape is:

```json
{
  "version": 1,
  "trip": { "id": "japan-2026", "name": "Japan 2026", "startDate": "2026-09-30", "endDate": "2026-10-25", "timeZone":"Asia/Tokyo", "arrival": {"airport":"HND","date":"2026-10-02","localDateTime":"2026-10-02T00:05:00+09:00"}, "departure": {"airport":"HND","date":"2026-10-25","localDateTime":"2026-10-25T01:25:00+09:00"} },
  "places": [{"id":"place-1","name":"Ginza Itoya","city":"Tokyo","area":"Ginza","category":"Culture, Shopping","description":"...","notes":"...","sourceUrl":"https://...","googleMapsUrl":"https://...","durationMinutes":90,"priority":"nice","status":"candidate","latitude":null,"longitude":null,"selected":false}],
  "stays": [{"id":"stay-1","city":"Tokyo","name":"...","checkIn":"2026-10-01","checkOut":"2026-10-03","status":"planned","bookingId":null}],
  "travelLegs": [{"id":"leg-1","from":"Tokyo","to":"Kyoto","date":"2026-10-08","durationMinutes":140,"mode":"train","estimated":true}],
  "activities": [{"id":"activity-1","placeId":"place-1","title":null,"date":"2026-10-03","startTime":null,"durationMinutes":90,"status":"planned"}],
  "bookings": [{"id":"booking-1","kind":"hotel","title":"...","status":"confirmed","confirmationCode":"...","url":"...","date":"2026-10-01","start":"2026-10-01T08:00:00+09:00","end":"2026-10-02T11:00:00+09:00","checkIn":"2026-10-01","checkOut":"2026-10-02","location":"...","notes":"..."}],
  "tasks": [{"id":"task-1","title":"Check passport expiry","dueDate":"2026-09-15","completed":false,"scope":"trip","reminderAt":null}],
  "packingItems": [{"id":"pack-1","name":"Passport","category":"Documents","quantity":1,"packed":false,"bag":"Personal item","notes":""}]
}
```

Fields may be absent or null. The client preserves unknown coordinates and only plots exact markers when both latitude and longitude exist. Dates are ISO calendar dates in the trip timezone. A successful PUT returns the saved snapshot, including its incremented `version`; a conflict should return `409` with the current snapshot.

The plugin-facing API can later expose the same application operations: search places, create/update place, select place, read trip, create booking, and update task/packing status. Keep those operations behind the same domain service as HTTP mutations.

Backend implementation notes:

- The complete snapshot is persisted as one JSON document in PostgreSQL, keyed by authenticated owner, with a numeric optimistic-concurrency `version`. Every PUT replaces the snapshot and must send the version it read. The server returns `409` and the current snapshot on a stale version.
- `trip.arrival` and `trip.departure` may additionally contain `localDateTime` (an ISO offset timestamp) and `raw`, while `date` remains available for date-only imports. Booking `start`/`end` retain offsets, and accommodation bookings may carry explicit `checkIn`/`checkOut`. Hotel nights are explicit `stays.checkIn` inclusive and `checkOut` exclusive; timeline dates do not imply nights.
- `places` is the reusable candidate library. `selected` and `status` describe trip intent; scheduling is represented independently by `activities`. A place's source URL is retained for provenance.
- `tasks` and `packingItems` are first-class trip records. A task can have a `reminderAt`; reminders are currently stored for the UI to display. `packingItems` supports quantity and optional bag assignment.
- Streamable HTTP MCP is exposed at `/mcp` using the official `ModelContextProtocol.AspNetCore` SDK. Tools are owner-scoped and use the same service/concurrency checks. Development falls back to `local-dev` only for loopback requests. Production uses the configured OpenIddict authorization-code + PKCE server and the same authenticated owner for bearer MCP calls.
- Browser login is `GET /auth/login`, session inspection is `GET /auth/me`, CSRF token retrieval is `GET /auth/csrf`, and logout is `POST /auth/logout`. Cookie-authenticated mutations must send the CSRF token in `X-CSRF-TOKEN`.
