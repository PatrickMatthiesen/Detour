using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Detour.Api;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using OpenIddict.Server;
using OpenIddict.Validation;

namespace Detour.Api.Tests;

public sealed class OAuthKeyRingTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "detour-keys-" + Guid.NewGuid().ToString("N"));
    private readonly TestClock clock = new(DateTimeOffset.UtcNow);

    [Fact]
    public void Restart_reuses_keys_and_rotation_preserves_old_crypto()
    {
        string thumbprint;
        byte[] signature, ciphertext;
        var message = Encoding.UTF8.GetBytes("existing OAuth token");
        using (var ring = new OAuthKeyRing(directory, clock))
        {
            var pair = Assert.Single(ring.Keys);
            thumbprint = pair.Signing.Thumbprint;
            using var signing = pair.Signing.GetRSAPrivateKey();
            using var encryption = pair.Encryption.GetRSAPublicKey();
            signature = signing!.SignData(message, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            ciphertext = encryption!.Encrypt(message, RSAEncryptionPadding.OaepSHA1);
            Assert.False(ring.Refresh());
        }
        using (var ring = new OAuthKeyRing(directory, clock))
        {
            Assert.Equal(thumbprint, Assert.Single(ring.Keys).Signing.Thumbprint);
            clock.Now += TimeSpan.FromDays(340);
            Assert.True(ring.Refresh());
            Assert.Equal(2, ring.Keys.Count);
            using var signing = ring.Keys[0].Signing.GetRSAPublicKey();
            using var encryption = ring.Keys[0].Encryption.GetRSAPrivateKey();
            Assert.True(signing!.VerifyData(message, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
            Assert.Equal(message, encryption!.Decrypt(ciphertext, RSAEncryptionPadding.OaepSHA1));
        }
        using var restarted = new OAuthKeyRing(directory, clock);
        Assert.Equal(2, restarted.Keys.Count);
        Assert.False(restarted.Refresh());
    }

    [Fact]
    public void Corrupt_ring_is_not_replaced_and_second_owner_is_rejected()
    {
        using (var ring = new OAuthKeyRing(directory, clock))
            Assert.Throws<IOException>(() => new OAuthKeyRing(directory, clock));
        var path = Path.Combine(directory, "oauth-keys.json");
        File.WriteAllText(path, "corrupt");
        Assert.ThrowsAny<Exception>(() => new OAuthKeyRing(directory, clock));
        Assert.Equal("corrupt", File.ReadAllText(path));
    }

    [Fact]
    public void Failed_rotation_does_not_activate_unpersisted_keys()
    {
        using var ring = new OAuthKeyRing(directory, clock);
        var original = Assert.Single(ring.Keys).Signing.Thumbprint;
        var path = Path.Combine(directory, "oauth-keys.json");
        var backup = path + ".backup";
        File.Move(path, backup);
        Directory.CreateDirectory(path); // Force the atomic replacement to fail.
        clock.Now += TimeSpan.FromDays(340);
        try
        {
            var failure = Record.Exception(() => ring.Refresh());
            Assert.True(failure is IOException or UnauthorizedAccessException);
            Assert.Equal(original, Assert.Single(ring.Keys).Signing.Thumbprint);
        }
        finally
        {
            Directory.Delete(path);
            File.Move(backup, path);
        }
        Assert.True(ring.Refresh());
    }

    [Fact]
    public void Expired_ring_gets_new_keys_on_startup()
    {
        using (var ring = new OAuthKeyRing(directory, clock)) { }
        clock.Now += TimeSpan.FromDays(400);
        using var renewed = new OAuthKeyRing(directory, clock);
        Assert.Equal(2, renewed.Keys.Count);
        Assert.True(renewed.Keys[1].Signing.NotAfter.ToUniversalTime() > clock.Now.UtcDateTime);
        if (!OperatingSystem.IsWindows())
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite,
                File.GetUnixFileMode(Path.Combine(directory, "oauth-keys.json")));
    }

    [Fact]
    public async Task Cached_validation_accepts_new_tokens_and_new_options_accept_old_tokens()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<TimeProvider>(clock);
        services.AddOpenIddict().AddCore(options => options.UseEntityFrameworkCore().UseDbContext<TripDbContext>()).AddServer(options =>
        {
            options.SetTokenEndpointUris("/connect/token");
            options.AllowClientCredentialsFlow();
        }).AddValidation(options => options.UseLocalServer());
        services.AddManagedOAuthKeys(directory);
        // Use the test clock for rotation without waiting a year.
        services.AddSingleton(_ => new OAuthKeyRing(directory, clock));
        using var provider = services.BuildServiceProvider();
        var server = provider.GetRequiredService<IOptionsMonitor<OpenIddictServerOptions>>();
        var validator = provider.GetRequiredService<IOptionsMonitor<OpenIddictValidationOptions>>();
        var oldOptions = server.CurrentValue;
        var cachedValidation = validator.CurrentValue;
        var handler = new JsonWebTokenHandler();
        string Token(OpenIddictServerOptions options) => handler.CreateToken(new SecurityTokenDescriptor
        {
            Claims = new Dictionary<string, object> { ["sub"] = "test-owner" },
            SigningCredentials = options.SigningCredentials[0],
            EncryptingCredentials = options.EncryptionCredentials[0]
        });
        var oldToken = Token(oldOptions);
        clock.Now += TimeSpan.FromDays(340);
        Assert.True(provider.GetRequiredService<OAuthKeyRotation>().RotateIfNeeded());
        var currentOptions = server.CurrentValue;
        Assert.Equal(2, currentOptions.SigningCredentials.Count);
        var latest = provider.GetRequiredService<OAuthKeyRing>().Keys[^1];
        Assert.Equal(latest.Signing.Thumbprint, ((X509SecurityKey)currentOptions.SigningCredentials[0].Key).Certificate.Thumbprint);
        var newToken = Token(currentOptions);
        async Task Validate(string token, TokenValidationParameters original)
        {
            var parameters = original.Clone();
            parameters.ValidateIssuer = false;
            parameters.ValidateAudience = false;
            parameters.ValidateLifetime = true;
            var result = await handler.ValidateTokenAsync(token, parameters);
            Assert.True(result.IsValid, result.Exception?.ToString());
        }
        await Validate(newToken, cachedValidation.TokenValidationParameters);
        await Validate(oldToken, validator.CurrentValue.TokenValidationParameters);
        await Validate(oldToken, currentOptions.TokenValidationParameters);
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true); }
    private sealed class TestClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
