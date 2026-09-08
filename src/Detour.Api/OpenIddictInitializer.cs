using OpenIddict.Abstractions;

namespace Detour.Api;

/// <summary>Registers the single configured ChatGPT public client without inventing credentials.</summary>
public sealed class OpenIddictInitializer(
    IOpenIddictApplicationManager applications,
    IOpenIddictScopeManager scopes,
    IConfiguration configuration,
    ILogger<OpenIddictInitializer> logger)
{
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        var scope = configuration["Auth:OAuth:Scope"] ?? "tripadvisor_api";
        if (await scopes.FindByNameAsync(scope, cancellationToken) is null)
        {
            var scopeDescriptor = new OpenIddictScopeDescriptor
            {
                Name = scope,
                DisplayName = "Detour data",
            };
            scopeDescriptor.Resources.Add(scope);
            await scopes.CreateAsync(scopeDescriptor, cancellationToken);
        }

        var clientId = configuration["Auth:OAuth:ClientId"];
        var redirects = configuration.GetSection("Auth:OAuth:RedirectUris").Get<string[]>() ?? [];
        if (string.IsNullOrWhiteSpace(clientId) || redirects.Length == 0)
        {
            logger.LogWarning("ChatGPT OAuth client is not registered. Set Auth:OAuth:ClientId and Auth:OAuth:RedirectUris before connecting ChatGPT.");
            return;
        }

        var descriptor = new OpenIddictApplicationDescriptor
        {
            ClientId = clientId,
            DisplayName = "ChatGPT",
            ClientType = OpenIddictConstants.ClientTypes.Public,
            ConsentType = OpenIddictConstants.ConsentTypes.Explicit
        };
        foreach (var redirect in redirects)
        {
            if (!Uri.TryCreate(redirect, UriKind.Absolute, out var uri) ||
                (uri.Scheme != Uri.UriSchemeHttps &&
                 !(uri.Scheme == Uri.UriSchemeHttp && IsLoopbackHost(uri.Host))) ||
                uri.Fragment.Length > 0)
                throw new InvalidOperationException($"Auth:OAuth:RedirectUris contains an invalid absolute URI: '{redirect}'.");
            descriptor.RedirectUris.Add(uri);
        }
        descriptor.Permissions.UnionWith([
            OpenIddictConstants.Permissions.Endpoints.Authorization,
            OpenIddictConstants.Permissions.Endpoints.Token,
            OpenIddictConstants.Permissions.GrantTypes.AuthorizationCode,
            OpenIddictConstants.Permissions.GrantTypes.RefreshToken,
            OpenIddictConstants.Permissions.ResponseTypes.Code,
            OpenIddictConstants.Permissions.Prefixes.Scope + OpenIddictConstants.Scopes.OpenId,
            OpenIddictConstants.Permissions.Prefixes.Scope + OpenIddictConstants.Scopes.Profile,
            OpenIddictConstants.Permissions.Prefixes.Scope + OpenIddictConstants.Scopes.Email,
            OpenIddictConstants.Permissions.Prefixes.Scope + scope,
            OpenIddictConstants.Permissions.Prefixes.Scope + OpenIddictConstants.Scopes.OfflineAccess
        ]);
        descriptor.Requirements.Add(OpenIddictConstants.Requirements.Features.ProofKeyForCodeExchange);
        var existing = await applications.FindByClientIdAsync(clientId, cancellationToken);
        if (existing is null)
        {
            await applications.CreateAsync(descriptor, cancellationToken);
            logger.LogInformation("Registered ChatGPT OAuth client {ClientId} with {RedirectCount} redirect URI(s).", clientId, descriptor.RedirectUris.Count);
        }
        else
        {
            await applications.UpdateAsync(existing, descriptor, cancellationToken);
            logger.LogInformation("Reconciled ChatGPT OAuth client {ClientId} with {RedirectCount} redirect URI(s).", clientId, descriptor.RedirectUris.Count);
        }
    }

    private static bool IsLoopbackHost(string host)
        => host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
           (System.Net.IPAddress.TryParse(host, out var address) && System.Net.IPAddress.IsLoopback(address));
}
