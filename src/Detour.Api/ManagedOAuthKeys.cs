using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using OpenIddict.Server;
using OpenIddict.Validation;

namespace Detour.Api;

public static class ManagedOAuthKeys
{
    public static IServiceCollection AddManagedOAuthKeys(this IServiceCollection services, string directory)
    {
        services.AddSingleton(_ => new OAuthKeyRing(directory));
        services.AddOptions<OpenIddictServerOptions>().Configure<OAuthKeyRing>((options, ring) =>
        {
            foreach (var pair in ring.Keys)
            {
                options.SigningCredentials.Add(new SigningCredentials(new X509SecurityKey(pair.Signing), SecurityAlgorithms.RsaSha256));
                options.EncryptionCredentials.Add(new EncryptingCredentials(new X509SecurityKey(pair.Encryption),
                    SecurityAlgorithms.RsaOAEP, SecurityAlgorithms.Aes256CbcHmacSha512));
            }
            options.TokenValidationParameters.IssuerSigningKeyResolver = (_, _, _, _) =>
                ring.Keys.Select(pair => new X509SecurityKey(pair.Signing));
            options.TokenValidationParameters.TokenDecryptionKeyResolver = (_, _, _, _) =>
                ring.Keys.Select(pair => new X509SecurityKey(pair.Encryption));
        });
        // Resolve from the live ring even for a request holding pre-rotation options.
        services.AddOptions<OpenIddictValidationOptions>().Configure<OAuthKeyRing>((options, ring) =>
        {
            options.TokenValidationParameters.IssuerSigningKeyResolver = (_, _, _, _) =>
                ring.Keys.Select(pair => new X509SecurityKey(pair.Signing));
            options.TokenValidationParameters.TokenDecryptionKeyResolver = (_, _, _, _) =>
                ring.Keys.Select(pair => new X509SecurityKey(pair.Encryption));
        });
        services.AddSingleton<OAuthKeyRotation>();
        services.AddHostedService(provider => provider.GetRequiredService<OAuthKeyRotation>());
        return services;
    }
}

public sealed class OAuthKeyRotation(OAuthKeyRing ring,
    IOptionsMonitorCache<OpenIddictServerOptions> serverCache,
    IOptionsMonitorCache<OpenIddictValidationOptions> validationCache,
    ILogger<OAuthKeyRotation> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(6));
        while (await timer.WaitForNextTickAsync(stoppingToken))
            RotateIfNeeded();
    }

    public bool RotateIfNeeded()
    {
        // An unreadable/unwritable ring is an operational failure. Let the host
        // stop rather than silently running until authentication keys expire.
        if (!ring.Refresh()) return false;
        serverCache.TryRemove(Options.DefaultName);
        validationCache.TryRemove(Options.DefaultName);
        logger.LogInformation("OAuth credentials renewed; previous keys retained for existing tokens.");
        return true;
    }
}
