# Authentication and ChatGPT MCP access

The API has one owner boundary. Browser sessions use ASP.NET Core Identity with Google as the external sign in provider. The Google callback accepts only addresses in `Auth:AllowedEmails`; there is no public registration endpoint. The owner subject is used as the key for the trip aggregate, so a second account cannot read or modify the first account's trip.

The MCP endpoint uses the same owner identity through an OpenIddict access token. The server supports authorization code + PKCE and refresh tokens for the configured public ChatGPT client. The protected-resource metadata is available at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`; the MCP endpoint is `/mcp`. The canonical OAuth resource is the complete MCP URL, for example `https://detour.patrickbm.com/mcp`. The `tripadvisor_api` value is an OAuth scope and must not be used as the resource or audience.

## Configure the ChatGPT connector

The production connector uses a public OAuth client. ChatGPT supplies the callback URL and uses PKCE, so Detour does not use a client secret.

In ChatGPT, create a new plugin/connector and enter:

| Setting | Value |
| --- | --- |
| Server URL | `https://detour.patrickbm.com/mcp` |
| Authentication | `OAuth` |
| Client registration | `User-Defined OAuth Client` |
| Authorization endpoint | `https://detour.patrickbm.com/connect/authorize` |
| Token endpoint | `https://detour.patrickbm.com/connect/token` |
| Resource | `https://detour.patrickbm.com/mcp` |
| Default scopes | `openid email offline_access profile tripadvisor_api` |
| Callback URL | Copy the exact value shown by ChatGPT (currently `https://chatgpt.com/connector_platform_oauth_redirect`) |
| Client ID | `detour-chatgpt` |
| OAuth Client Secret | Leave empty |
| Token endpoint auth method | `none` |

ChatGPT displays the callback URL with a **Click to copy** control. Copy that value instead of relying on a manually typed callback; ChatGPT can change the callback host or path. Accept ChatGPT's custom MCP server warning and create the connector. When prompted to authorize, complete Google sign-in with an address in `Auth:AllowedEmails`. After the callback returns to ChatGPT, start a conversation and ask it to read a trip section to verify that the connector can make an authenticated MCP call.

The server advertises the resource as `<Auth:PublicUrl>/mcp` through protected-resource metadata. Keep this URL, the ChatGPT Server URL, and the `resource` parameter identical, including the `/mcp` path. The OAuth scope remains `tripadvisor_api`; it identifies the permission granted to the MCP tools.

## Local development

`appsettings.Development.json` explicitly sets `Auth:AllowLocalDev=true`. This is accepted only when the request peer is loopback and the Host header is `localhost` or a loopback IP. The API does not trust forwarded headers for this bypass, so a remote browser reaching a local Vite proxy cannot become the local owner accidentally. Set it to `false` when testing the real login flow.

For local OAuth testing from ChatGPT or another remote client, set `Auth:AllowLocalDev=false` and set `Auth:PublicUrl` to the actual reachable HTTPS origin, such as a public tunnel URL. Keep the same origin in the ChatGPT Server URL, authorization and token endpoints, resource, and protected-resource metadata. If no public URL is configured, development metadata falls back to a localhost resource that a remote ChatGPT client cannot reach.

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
      "ClientId": "detour-chatgpt",
      "Scope": "tripadvisor_api",
      "RedirectUris": [ "https://chatgpt.com/connector_platform_oauth_redirect" ]
    },
    "KeysPath": "/var/lib/detour/keys/oauth"
  },
  "DataProtection": { "KeysPath": "/var/lib/detour/keys" }
}
```

`Auth:PublicUrl` is the canonical HTTPS issuer and must match the externally visible API origin. For the supplied deployment it is `https://detour.patrickbm.com`, making the MCP resource `https://detour.patrickbm.com/mcp`. The supplied deployment publishes HTTP on host port 48327 for Cloudflare Tunnel running on another VM. It enables forwarded headers and assumes a trusted local network, with access managed by the firewall. Deployments requiring a proxy allowlist can configure `Auth:TrustedProxies` and disable `ASPNETCORE_FORWARDEDHEADERS_ENABLED`.

## Automatic OAuth keys

Production requires `Auth:KeysPath` on persistent writable storage. Detour generates separate RSA signing and encryption credentials on first startup, writes them atomically, and reuses them after restarts/deployments. These credentials protect OAuth tokens, not HTTPS traffic. No PFX files or certificate passwords need to be supplied.

Certificates last one year. A background check every six hours renews them when fewer than 30 days remain; startup also checks, including after a long shutdown. OpenIddict receives the renewed keys without restarting the process. Previous keys are retained so existing access and refresh tokens can still be processed; retaining a key does not extend a token's lifetime. Old keys are intentionally not automatically deleted (approximately one pair per year).

The key directory is private (0700 on Linux) and key files are owner-only (0600). Key material is not password-encrypted on disk: protect and back up this directory as a secret, together with the database and cookie-protection keys. Deleting it disconnects existing OAuth clients. An invalid key file fails startup instead of silently generating replacement credentials. A rotation write failure stops the application instead of letting it run indefinitely with expiring credentials.

This file-backed manager supports one API process per key directory and holds an exclusive ownership lock. Multiple replicas need coordinated key storage/rotation and are not supported by this deployment. The API container user must have write access to the persistent directory. Development continues using OpenIddict's development credentials.

The application registers the ChatGPT public client only when both `Auth:OAuth:ClientId` and at least one absolute `Auth:OAuth:RedirectUris` value are supplied. It logs a setup warning and does not pretend the integration is configured when either is missing. For the connector settings above, set environment variables `Auth__OAuth__ClientId=detour-chatgpt` and `Auth__OAuth__RedirectUris__0=https://chatgpt.com/connector_platform_oauth_redirect` (replace the callback with the exact value copied from ChatGPT). Redirect URIs must exactly match the client settings in the ChatGPT connector. If ChatGPT reports `invalid_target`, check that the MCP URL and the resource metadata use the complete `/mcp` URL and that `tripadvisor_api` is configured as the scope.

## Database startup

Startup applies the checked-in EF migration, which creates the aggregate, Identity, and OpenIddict tables without dropping data. If it finds the old pre-Identity `Trips` table without migration history, it renames that table and its known EF key/index names inside the migration transaction, creates the versioned schema, and copies every row back. The legacy table is retained as `__TripAdvisorLegacyTrips` for rollback review. Take a normal database backup before upgrades; this path is intentionally not a destructive reset.

After the first Google login, set `TripAdvisor:SeedOwnerId` to that user's Identity ID if the initial Japan seed should be loaded for the authenticated owner. Development local bypass seeds the explicit `local-dev` owner automatically.

The product and .NET projects are now named Detour. Existing `TripAdvisor:*` configuration keys, OAuth identifiers, data-protection application name and legacy migration table names are retained for compatibility. Renaming the product does not require replacing persisted keys, database storage or existing client configuration.
