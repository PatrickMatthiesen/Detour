using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace Detour.Api;

public sealed class ApiRateLimitSettings
{
    public int OAuthRequestsPerMinute { get; set; } = 600;
    public int OAuthBurst { get; set; } = 600;
    public int OwnerRequestsPerMinute { get; set; } = 240;
    public int OwnerBurst { get; set; } = 120;
    public int OwnerConcurrentExpensiveRequests { get; set; } = 2;
}

public static class ApiRateLimits
{
    public const string OAuthRequestPolicy = "oauth-request";
    public const string OwnerConcurrencyPolicy = "owner-expensive-request";

    public static void Add(IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<ApiRateLimitSettings>(configuration.GetSection("ApiRateLimits"));
        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
            {
                if (IsOwnerApiRequest(context))
                {
                    if (context.User.Identity?.IsAuthenticated != true)
                        return RateLimitPartition.GetNoLimiter("unauthenticated");
                    var settings = context.RequestServices.GetRequiredService<IOptionsMonitor<ApiRateLimitSettings>>().CurrentValue;
                    return RateLimitPartition.GetTokenBucketLimiter("owner:" + GetOwnerId(context), _ => CreateBucket(
                        settings.OwnerRequestsPerMinute, settings.OwnerBurst));
                }

                return RateLimitPartition.GetNoLimiter("unlimited");
            });

            options.AddPolicy(OAuthRequestPolicy, context =>
            {
                var settings = context.RequestServices.GetRequiredService<IOptionsMonitor<ApiRateLimitSettings>>().CurrentValue;
                return RateLimitPartition.GetTokenBucketLimiter("oauth-global", _ => CreateBucket(
                    settings.OAuthRequestsPerMinute, settings.OAuthBurst));
            });

            options.AddPolicy(OwnerConcurrencyPolicy, context =>
            {
                if (context.Request.Path.StartsWithSegments("/mcp", StringComparison.OrdinalIgnoreCase)
                    && HttpMethods.IsGet(context.Request.Method))
                    return RateLimitPartition.GetNoLimiter("mcp-event-stream");

                var settings = context.RequestServices.GetRequiredService<IOptionsMonitor<ApiRateLimitSettings>>().CurrentValue;
                return RateLimitPartition.GetConcurrencyLimiter(GetOwnerId(context), _ => new ConcurrencyLimiterOptions
                {
                    PermitLimit = Math.Max(1, settings.OwnerConcurrentExpensiveRequests),
                    QueueLimit = 0,
                    QueueProcessingOrder = QueueProcessingOrder.OldestFirst
                });
            });
        });
    }

    public static bool IsOAuthRequest(HttpContext context)
    {
        var path = context.Request.Path;
        return path.Equals("/auth/login", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/auth/callback", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/signin-google", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/connect/authorize", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/connect/token", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsOwnerApiRequest(HttpContext context)
    {
        var path = context.Request.Path;
        return path.Equals("/api/trip", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/api/places", StringComparison.OrdinalIgnoreCase)
            || path.StartsWithSegments("/mcp", StringComparison.OrdinalIgnoreCase);
    }

    private static string GetOwnerId(HttpContext context)
        => context.User.FindFirstValue("sub")
            ?? context.User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? "missing-owner";

    private static TokenBucketRateLimiterOptions CreateBucket(int requestsPerMinute, int burst)
        => new()
        {
            TokenLimit = Math.Max(1, burst),
            TokensPerPeriod = Math.Max(1, requestsPerMinute),
            ReplenishmentPeriod = TimeSpan.FromMinutes(1),
            AutoReplenishment = true,
            QueueLimit = 0,
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst
        };
}
