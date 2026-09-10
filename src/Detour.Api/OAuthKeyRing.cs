using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;

namespace Detour.Api;

/// <summary>Persistent OAuth credentials for a single application instance.</summary>
public sealed class OAuthKeyRing : IDisposable
{
    public static readonly TimeSpan RenewalWindow = TimeSpan.FromDays(30);
    private readonly string file;
    private readonly TimeProvider clock;
    private readonly FileStream lease;
    private readonly object sync = new();
    private readonly List<KeyPair> pairs = [];

    public OAuthKeyRing(string directory, TimeProvider? clock = null)
    {
        this.clock = clock ?? TimeProvider.System;
        directory = Path.GetFullPath(directory);
        Directory.CreateDirectory(directory);
        if (!OperatingSystem.IsWindows())
            File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        file = Path.Combine(directory, "oauth-keys.json");
        // Do not allow two independent rotation loops to write the same ring.
        lease = OpenPrivateFile(Path.Combine(directory, "owner.lock"), FileMode.OpenOrCreate);
        try
        {
            if (File.Exists(file))
            {
                if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(file, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                var stored = JsonSerializer.Deserialize<List<StoredPair>>(File.ReadAllBytes(file))
                    ?? throw new InvalidDataException("The OAuth key ring is empty or invalid.");
                if (stored.Count == 0) throw new InvalidDataException("The OAuth key ring contains no keys.");
                foreach (var pair in stored)
                {
                    var signing = Load(pair.Signing);
                    try { pairs.Add(new(signing, Load(pair.Encryption))); }
                    catch { signing.Dispose(); throw; }
                }
            }
            Refresh();
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    public IReadOnlyList<KeyPair> Keys { get { lock (sync) return pairs.ToArray(); } }

    public bool Refresh()
    {
        lock (sync)
        {
            var now = clock.GetUtcNow();
            if (pairs.Count > 0 && pairs.Any(pair =>
                pair.Signing.NotBefore.ToUniversalTime() <= now.UtcDateTime &&
                pair.Encryption.NotBefore.ToUniversalTime() <= now.UtcDateTime &&
                pair.Signing.NotAfter.ToUniversalTime() > now.Add(RenewalWindow).UtcDateTime &&
                pair.Encryption.NotAfter.ToUniversalTime() > now.Add(RenewalWindow).UtcDateTime)) return false;

            var signing = Create("signing", X509KeyUsageFlags.DigitalSignature, now);
            KeyPair pair;
            try { pair = new(signing, Create("encryption", X509KeyUsageFlags.KeyEncipherment, now)); }
            catch { signing.Dispose(); throw; }
            var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                // Publish to disk before making the new credentials available to requests.
                var stored = pairs.Append(pair).Select(key => new StoredPair(
                    Convert.ToBase64String(key.Signing.Export(X509ContentType.Pfx)),
                    Convert.ToBase64String(key.Encryption.Export(X509ContentType.Pfx)))).ToArray();
                using (var stream = OpenPrivateFile(temporary, FileMode.CreateNew))
                {
                    JsonSerializer.Serialize(stream, stored);
                    stream.Flush(flushToDisk: true);
                }
                File.Move(temporary, file, overwrite: true);
                pairs.Add(pair);
                return true;
            }
            catch
            {
                pair.Signing.Dispose();
                pair.Encryption.Dispose();
                throw;
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }
    }

    private static FileStream OpenPrivateFile(string path, FileMode mode)
    {
        var options = new FileStreamOptions { Mode = mode, Access = FileAccess.ReadWrite, Share = FileShare.None };
        if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        return new FileStream(path, options);
    }

    private static X509Certificate2 Load(string value)
    {
        var certificate = X509CertificateLoader.LoadPkcs12(Convert.FromBase64String(value), null,
            X509KeyStorageFlags.EphemeralKeySet | X509KeyStorageFlags.Exportable);
        using var rsa = certificate.GetRSAPrivateKey();
        if (!certificate.HasPrivateKey || rsa is null || rsa.KeySize < 3072)
        {
            certificate.Dispose();
            throw new InvalidDataException("The OAuth key ring contains an invalid private key.");
        }
        return certificate;
    }

    private static X509Certificate2 Create(string purpose, X509KeyUsageFlags usage, DateTimeOffset now)
    {
        using var rsa = RSA.Create(3072);
        var request = new CertificateRequest($"CN=Detour OAuth {purpose}", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509KeyUsageExtension(usage, critical: true));
        using var certificate = request.CreateSelfSigned(now.AddMinutes(-5), now.AddDays(365));
        return Load(Convert.ToBase64String(certificate.Export(X509ContentType.Pfx)));
    }

    public void Dispose()
    {
        foreach (var pair in pairs) { pair.Signing.Dispose(); pair.Encryption.Dispose(); }
        lease.Dispose();
    }

    public sealed record KeyPair(X509Certificate2 Signing, X509Certificate2 Encryption);
    private sealed record StoredPair(string Signing, string Encryption);
}
