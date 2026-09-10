# Authentication and ChatGPT MCP access

The API has one owner boundary. Browser sessions use ASP.NET Core Identity with Google as the external sign in provider. The Google callback accepts only addresses in `Auth:AllowedEmails`; there is no public registration endpoint. The owner subject is used as the key for the trip aggregate, so a second account cannot read or modify the first account's trip.

The MCP endpoint uses the same owner identity through an OpenIddict access token. The server supports authorization code + PKCE and refresh tokens for the configured public ChatGPT client. The protected-resource metadata is available at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`; the MCP endpoint is `/mcp`.

## Local development

`appsettings.Development.json` explicitly sets `Auth:AllowLocalDev=true`. This is accepted only when the request peer is loopback and the Host header is `localhost` or a loopback IP. The API does not trust forwarded headers for this bypass, so a remote browser reaching a local Vite proxy cannot become the local owner accidentally. Set it to `false` when testing the real login flow.

## Production settings

Set these values as secrets or deployment configuration. Environment variable names use `__` in place of `:`.

```json
{
  "ConnectionStrings": { "tripdb": "Host=...;Database=...;Username=...;Password=..." },
  "Auth": {
    "AllowLocalDev": false,
    "PublicUrl": "https://trips.example.com",
    "AllowedEmails": [ "owner@example.com" ],
    "Google": {
      "ClientId": "...apps.googleusercontent.com",
      "ClientSecret": "..."
    },
    "OAuth": {
      "ClientId": "chatgpt-tripadvisor",
      "Scope": "tripadvisor_api",
      "RedirectUris": [ "https://chat.openai.com/aip/<configured-callback>" ]
    },
    "KeysPath": "/var/lib/detour/keys/oauth"
  },
  "DataProtection": { "KeysPath": "/var/lib/detour/keys" }
}
```

`Auth:PublicUrl` is the canonical HTTPS issuer and must match the externally visible API origin. The supplied deployment exposes HTTP only on localhost for the host's Cloudflare Tunnel and enables forwarded headers there. For a different proxy setup, configure `Auth:TrustedProxies` with the immediate proxy IPs and disable the broad `ASPNETCORE_FORWARDEDHEADERS_ENABLED` switch. Do not expose an ingress that trusts forwarded headers directly to untrusted clients.

## Automatic OAuth keys

Production requires `Auth:KeysPath` on persistent writable storage. Detour generates separate RSA signing and encryption credentials on first startup, writes them atomically, and reuses them after restarts/deployments. These credentials protect OAuth tokens, not HTTPS traffic. No PFX files or certificate passwords need to be supplied.

Certificates last one year. A background check every six hours renews them when fewer than 30 days remain; startup also checks, including after a long shutdown. OpenIddict receives the renewed keys without restarting the process. Previous keys are retained so existing access and refresh tokens can still be processed; retaining a key does not extend a token's lifetime. Old keys are intentionally not automatically deleted (approximately one pair per year).

The key directory is private (0700 on Linux) and key files are owner-only (0600). Key material is not password-encrypted on disk: protect and back up this directory as a secret, together with the database and cookie-protection keys. Deleting it disconnects existing OAuth clients. An invalid key file fails startup instead of silently generating replacement credentials. A rotation write failure stops the application instead of letting it run indefinitely with expiring credentials.

This file-backed manager supports one API process per key directory and holds an exclusive ownership lock. Multiple replicas need coordinated key storage/rotation and are not supported by this deployment. The API container user must have write access to the persistent directory. Development continues using OpenIddict's development credentials.

The application registers the ChatGPT public client only when both `Auth:OAuth:ClientId` and at least one absolute `Auth:OAuth:RedirectUris` value are supplied. It logs a setup warning and does not pretend the integration is configured when either is missing. Redirect URIs must exactly match the client settings in the ChatGPT connector.

## Database startup

Startup applies the checked-in EF migration, which creates the aggregate, Identity, and OpenIddict tables without dropping data. If it finds the old pre-Identity `Trips` table without migration history, it renames that table and its known EF key/index names inside the migration transaction, creates the versioned schema, and copies every row back. The legacy table is retained as `__TripAdvisorLegacyTrips` for rollback review. Take a normal database backup before upgrades; this path is intentionally not a destructive reset.

After the first Google login, set `TripAdvisor:SeedOwnerId` to that user's Identity ID if the initial Japan seed should be loaded for the authenticated owner. Development local bypass seeds the explicit `local-dev` owner automatically.

The product and .NET projects are now named Detour. Existing `TripAdvisor:*` configuration keys, OAuth identifiers, data-protection application name and legacy migration table names are retained for compatibility. Renaming the product does not require replacing persisted keys, database storage or existing client configuration.
