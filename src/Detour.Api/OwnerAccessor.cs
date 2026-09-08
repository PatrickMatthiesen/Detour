using System.Security.Claims;

namespace Detour.Api;

public sealed class OwnerAccessor(IHttpContextAccessor httpContextAccessor, IConfiguration configuration)
{
    public string OwnerId
    {
        get
        {
            var context = httpContextAccessor.HttpContext;
            var subject = context?.User.FindFirstValue("sub") ?? context?.User.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!string.IsNullOrWhiteSpace(subject)) return subject;
            // The API is commonly reached through Vite's local proxy, so the
            // socket peer alone is insufficient: a remote browser would also
            // appear as loopback. Require both a loopback peer and a loopback
            // Host header. We intentionally do not trust forwarded headers.
            var loopbackPeer = context?.Connection.RemoteIpAddress is { } peer && System.Net.IPAddress.IsLoopback(peer);
            if (configuration.GetValue<bool>("Auth:AllowLocalDev") && loopbackPeer && context is not null && IsLoopbackHost(context.Request.Host.Host)) return "local-dev";
            throw new UnauthorizedAccessException("An authenticated owner is required.");
        }
    }

    private static bool IsLoopbackHost(string host)
        => host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || (System.Net.IPAddress.TryParse(host, out var address) && System.Net.IPAddress.IsLoopback(address));
}
