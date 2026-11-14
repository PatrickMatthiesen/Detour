using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Detour.Api;

namespace Detour.Api.Tests;

public sealed class ApiRateLimitsTests
{
    [Fact]
    public async Task OAuth_limit_is_global_returns_429_without_auth_challenge_and_owner_limit_is_partitioned()
    {
        await using var app = CreateApp(ownerBurst: 1, oauthBurst: 1);
        await app.StartAsync();
        using var client = app.GetTestClient();

        using var oauthFirst = await client.PostAsync("/connect/token", null);
        using var oauthSecond = await client.PostAsync("/connect/authorize", null);
        Assert.Equal(HttpStatusCode.BadRequest, oauthFirst.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, oauthSecond.StatusCode);
        Assert.False(oauthSecond.Headers.Contains("WWW-Authenticate"));

        using var ownerFirst = await client.GetAsync("/api/trip");
        using var ownerLimited = await client.GetAsync("/api/trip");
        using var otherOwner = await client.GetAsync("/api/trip?owner=other");
        Assert.Equal(HttpStatusCode.OK, ownerFirst.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, ownerLimited.StatusCode);
        Assert.Equal(HttpStatusCode.OK, otherOwner.StatusCode);
    }

    [Fact]
    public async Task Owner_concurrency_limit_rejects_overlapping_expensive_requests_but_does_not_limit_mcp_event_streams()
    {
        var expensiveGate = new RequestGate(1);
        var streamGate = new RequestGate(2);
        await using var app = CreateApp(ownerBurst: 20, oauthBurst: 20, concurrency: 1, expensiveGate, streamGate);
        await app.StartAsync();
        using var client = app.GetTestClient();

        var first = client.PostAsync("/api/places/slow", null);
        try
        {
            await expensiveGate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            using var rejected = await client.PostAsync("/api/places/slow", null);
            Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
            Assert.False(rejected.Headers.Contains("WWW-Authenticate"));
        }
        finally
        {
            expensiveGate.Release.TrySetResult();
        }
        using var completed = await first;
        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);

        var streamOne = client.GetAsync("/mcp");
        var streamTwo = client.GetAsync("/mcp");
        try
        {
            await streamGate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        }
        finally
        {
            streamGate.Release.TrySetResult();
        }
        var streams = await Task.WhenAll(streamOne, streamTwo);
        Assert.All(streams, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        foreach (var response in streams) response.Dispose();
    }

    [Fact]
    public async Task Calendar_owner_budget_is_shared_across_methods_and_partitioned_by_owner()
    {
        await using var app = CreateCalendarApp(ownerBurst: 2, oauthBurst: 20);
        await app.StartAsync();
        using var client = app.GetTestClient();

        using var status = await client.GetAsync("/api/calendar?owner=owner-a");
        using var sync = await client.PostAsync("/api/calendar/sync?owner=owner-a", null);
        using var limitedDisconnect = await client.DeleteAsync("/api/calendar?owner=owner-a");
        using var otherOwner = await client.GetAsync("/api/calendar?owner=owner-b");

        Assert.Equal(HttpStatusCode.OK, status.StatusCode);
        Assert.Contains("owner=owner-a;authenticated=True;ownerBurst=2;ownerPerMinute=100",
            GetLimiterDiagnostics(status));
        Assert.Equal(HttpStatusCode.OK, sync.StatusCode);
        Assert.True(limitedDisconnect.StatusCode == HttpStatusCode.TooManyRequests,
            GetLimiterDiagnostics(status, sync, limitedDisconnect, otherOwner));
        Assert.False(limitedDisconnect.Headers.Contains("WWW-Authenticate"));
        Assert.Equal(HttpStatusCode.OK, otherOwner.StatusCode);
    }

    [Fact]
    public async Task Calendar_expensive_operations_reject_overlap_per_owner()
    {
        var gate = new RequestGate(1);
        await using var app = CreateCalendarApp(ownerBurst: 20, oauthBurst: 20, concurrency: 1, syncGate: gate);
        await app.StartAsync();
        using var client = app.GetTestClient();

        var firstSync = client.PostAsync("/api/calendar/sync?owner=owner-a", null);
        try
        {
            await gate.Entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            using var rejectedDisconnect = await client.DeleteAsync("/api/calendar?owner=owner-a");
            using var otherOwner = await client.DeleteAsync("/api/calendar?owner=owner-b");
            Assert.Equal(HttpStatusCode.TooManyRequests, rejectedDisconnect.StatusCode);
            Assert.False(rejectedDisconnect.Headers.Contains("WWW-Authenticate"));
            Assert.Equal(HttpStatusCode.OK, otherOwner.StatusCode);
        }
        finally
        {
            gate.Release.TrySetResult();
        }

        using var completed = await firstSync;
        Assert.Equal(HttpStatusCode.OK, completed.StatusCode);
    }

    [Fact]
    public async Task Calendar_authorization_and_callback_methods_share_oauth_budget_before_callback_handler()
    {
        await using var app = CreateCalendarApp(ownerBurst: 20, oauthBurst: 2);
        await app.StartAsync();
        using var client = app.GetTestClient();

        using var authorization = await client.GetAsync("/auth/calendar/connect");
        using var callbackGet = await client.GetAsync("/signin-google-calendar");
        using var callbackPost = await client.PostAsync("/signin-google-calendar", null);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, authorization.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, callbackGet.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, callbackPost.StatusCode);
        Assert.False(callbackPost.Headers.Contains("WWW-Authenticate"));
    }

    private static WebApplication CreateApp(int ownerBurst, int oauthBurst, int concurrency = 2, RequestGate? expensiveGate = null, RequestGate? streamGate = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
        builder.WebHost.UseTestServer();
        builder.Configuration["ApiRateLimits:OwnerRequestsPerMinute"] = "100";
        builder.Configuration["ApiRateLimits:OwnerBurst"] = ownerBurst.ToString();
        builder.Configuration["ApiRateLimits:OAuthRequestsPerMinute"] = "100";
        builder.Configuration["ApiRateLimits:OAuthBurst"] = oauthBurst.ToString();
        builder.Configuration["ApiRateLimits:OwnerConcurrentExpensiveRequests"] = concurrency.ToString();
        ApiRateLimits.Add(builder.Services, builder.Configuration);
        var app = builder.Build();
        app.UseWhen(ApiRateLimits.IsOAuthRequest, branch => branch.UseRateLimiter());
        app.Use(async (context, next) =>
        {
            if (context.Request.Path.Equals("/connect/token", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                return;
            }
            var owner = context.Request.Query["owner"].FirstOrDefault() ?? "owner-a";
            context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", owner)], "test"));
            await next();
        });
        app.UseWhen(context => !ApiRateLimits.IsOAuthRequest(context), branch => branch.UseRateLimiter());
        app.MapPost("/connect/{**path}", () => Results.Ok()).RequireRateLimiting(ApiRateLimits.OAuthRequestPolicy);
        app.MapGet("/api/trip", () => Results.Ok());
        if (expensiveGate is not null)
            app.MapPost("/api/places/slow", async (CancellationToken ct) =>
            {
                expensiveGate.Enter();
                await expensiveGate.Release.Task.WaitAsync(ct);
                return Results.Ok();
            }).RequireRateLimiting(ApiRateLimits.OwnerConcurrencyPolicy);
        if (streamGate is not null)
            app.MapGet("/mcp", async (CancellationToken ct) =>
            {
                streamGate.Enter();
                await streamGate.Release.Task.WaitAsync(ct);
                return Results.Ok();
            }).RequireRateLimiting(ApiRateLimits.OwnerConcurrencyPolicy);
        return app;
    }

    private static WebApplication CreateCalendarApp(int ownerBurst, int oauthBurst, int concurrency = 2, RequestGate? syncGate = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
        builder.WebHost.UseTestServer();
        builder.Configuration["ApiRateLimits:OwnerRequestsPerMinute"] = "100";
        builder.Configuration["ApiRateLimits:OwnerBurst"] = ownerBurst.ToString();
        builder.Configuration["ApiRateLimits:OAuthRequestsPerMinute"] = "100";
        builder.Configuration["ApiRateLimits:OAuthBurst"] = oauthBurst.ToString();
        builder.Configuration["ApiRateLimits:OwnerConcurrentExpensiveRequests"] = concurrency.ToString();
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddAuthentication();
        builder.Services.AddAuthorization(options => options.AddPolicy("calendar-browser", policy => policy.RequireAuthenticatedUser()));
        builder.Services.AddScoped<OwnerAccessor>();
        builder.Services.AddDbContext<TripDbContext>(options => options.UseInMemoryDatabase("calendar-rate-limits-" + Guid.NewGuid()));
        builder.Services.AddDataProtection();
        builder.Services.AddSingleton(new DetourCalendarOptions());
        builder.Services.AddSingleton<CalendarOwnerLock>();
        builder.Services.AddSingleton<IGoogleCalendarClient, EmptyGoogleCalendarClient>();
        builder.Services.AddScoped<DetourCalendarService>();
        ApiRateLimits.Add(builder.Services, builder.Configuration);

        var app = builder.Build();
        app.UseWhen(ApiRateLimits.IsOAuthRequest, branch => branch.UseRateLimiter());
        app.Use(async (context, next) =>
        {
            var owner = context.Request.Query["owner"].FirstOrDefault() ?? "owner-a";
            context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", owner)], "test"));
            if (context.Request.Path.Equals("/signin-google-calendar", StringComparison.OrdinalIgnoreCase))
            {
                context.Response.StatusCode = StatusCodes.Status204NoContent;
                return;
            }
            await next();
        });
        app.Use(async (context, next) =>
        {
            context.Response.OnStarting(() =>
            {
                var settings = context.RequestServices.GetRequiredService<IOptionsMonitor<ApiRateLimitSettings>>().CurrentValue;
                var limiter = context.RequestServices.GetRequiredService<IOptions<RateLimiterOptions>>().Value.GlobalLimiter;
                var statistics = limiter?.GetStatistics(context);
                var owner = context.User.FindFirst("sub")?.Value ?? "<missing>";
                context.Response.Headers["X-Test-Rate-Limiter"] =
                    $"owner={owner};authenticated={context.User.Identity?.IsAuthenticated};" +
                    $"ownerBurst={settings.OwnerBurst};ownerPerMinute={settings.OwnerRequestsPerMinute};" +
                    $"available={(statistics is null ? "null" : statistics.CurrentAvailablePermits.ToString())};" +
                    $"successful={statistics?.TotalSuccessfulLeases.ToString() ?? "null"};" +
                    $"failed={statistics?.TotalFailedLeases.ToString() ?? "null"}";
                return Task.CompletedTask;
            });
            await next();
        });
        app.UseWhen(context => !ApiRateLimits.IsOAuthRequest(context), branch => branch.UseRateLimiter());
        if (syncGate is not null)
            app.Use(async (context, next) =>
            {
                if (context.Request.Path.Equals("/api/calendar/sync", StringComparison.OrdinalIgnoreCase)
                    && HttpMethods.IsPost(context.Request.Method))
                {
                    syncGate.Enter();
                    await syncGate.Release.Task.WaitAsync(context.RequestAborted);
                }
                await next();
            });
        app.UseAuthentication();
        app.UseAuthorization();
        app.MapDetourCalendar();
        return app;
    }

    private static string GetLimiterDiagnostics(params HttpResponseMessage[] responses)
        => string.Join(" | ", responses.Select(response =>
            $"{response.RequestMessage?.Method} {response.RequestMessage?.RequestUri?.PathAndQuery}: " +
            $"status={(int)response.StatusCode}; " +
            (response.Headers.TryGetValues("X-Test-Rate-Limiter", out var values)
                ? string.Join("; ", values)
                : "rate-limiter diagnostics header was missing.")));

    private sealed class EmptyGoogleCalendarClient : IGoogleCalendarClient
    {
        public Task<string> RefreshAccessTokenAsync(string refreshToken, CancellationToken cancellationToken) => Task.FromResult("");
        public Task<string> CreateCalendarAsync(string accessToken, CancellationToken cancellationToken) => Task.FromResult("");
        public Task UpsertEventAsync(string accessToken, string calendarId, string eventId, System.Text.Json.Nodes.JsonObject body, CancellationToken cancellationToken, bool tracked = false) => Task.CompletedTask;
        public Task DeleteEventAsync(string accessToken, string calendarId, string eventId, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private sealed class RequestGate(int expectedEntries)
    {
        private int entries;
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public void Enter()
        {
            if (Interlocked.Increment(ref entries) >= expectedEntries)
                Entered.TrySetResult();
        }
    }
}
