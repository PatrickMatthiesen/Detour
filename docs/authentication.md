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
    "TrustedProxies": [ "${WEB_PROXY_IP}" ],
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
    "SigningCertificate": { "Path": "/run/secrets/signing.pfx", "Password": "..." },
    "EncryptionCertificate": { "Path": "/run/secrets/encryption.pfx", "Password": "..." }
  },
  "DataProtection": { "KeysPath": "/var/lib/tripadvisor/keys" }
}
```

`Auth:PublicUrl` is the canonical HTTPS issuer and must match the externally visible API origin. Configure the reverse proxy to preserve that host and scheme using the normal ASP.NET forwarded-header setup. Keep the signing and encryption certificates stable across restarts and replicas; development certificates are intentionally disabled in production. Persist Data Protection keys so Identity cookies remain valid after a restart.

`Auth:TrustedProxies` is an explicit list of immediate proxy IP addresses. The API accepts one forwarded host/scheme hop only from those addresses. With the production Compose overlay, set it to the fixed private address assigned to the web/YARP gateway (`WEB_PROXY_IP`); the API does not trust arbitrary client supplied forwarded headers.
Disable the framework's broad `ASPNETCORE_FORWARDEDHEADERS_ENABLED` switch when using this allowlist; otherwise it can install a wider forwarded-header trust policy before the application policy runs. Set `Auth:TrustedProxies` to the actual web container address in container networking rather than assuming loopback.

The application registers the ChatGPT public client only when both `Auth:OAuth:ClientId` and at least one absolute `Auth:OAuth:RedirectUris` value are supplied. It logs a setup warning and does not pretend the integration is configured when either is missing. Redirect URIs must exactly match the client settings in the ChatGPT connector.

## Database startup

Startup applies the checked-in EF migration, which creates the aggregate, Identity, and OpenIddict tables without dropping data. If it finds the old pre-Identity `Trips` table without migration history, it renames that table and its known EF key/index names inside the migration transaction, creates the versioned schema, and copies every row back. The legacy table is retained as `__TripAdvisorLegacyTrips` for rollback review. Take a normal database backup before upgrades; this path is intentionally not a destructive reset.

After the first Google login, set `TripAdvisor:SeedOwnerId` to that user's Identity ID if the initial Japan seed should be loaded for the authenticated owner. Development local bypass seeds the explicit `local-dev` owner automatically.

The product and .NET projects are now named Detour. Existing `TripAdvisor:*` configuration keys, OAuth identifiers, data-protection application name and legacy migration table names are retained for compatibility. Renaming the product does not require replacing persisted keys, database storage or existing client configuration.
