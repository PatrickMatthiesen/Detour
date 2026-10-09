using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace Detour.Api;

public static class ForwardedProxyConfiguration
{
    public static void Configure(ForwardedHeadersOptions options, IEnumerable<string> trustedProxyAddresses)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(trustedProxyAddresses);

        var trustedProxies = trustedProxyAddresses.Select(address =>
        {
            if (!IPAddress.TryParse(address, out var ipAddress))
                throw new InvalidOperationException($"Auth:TrustedProxies contains an invalid IP address: '{address}'.");

            return ipAddress;
        }).Distinct().ToArray();

        if (trustedProxies.Length == 0)
            throw new InvalidOperationException("Auth:TrustedProxies must contain at least one valid IP address when forwarded headers are enabled.");

        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.ForwardLimit = 1;
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
        foreach (var trustedProxy in trustedProxies)
            options.KnownProxies.Add(trustedProxy);
    }
}
