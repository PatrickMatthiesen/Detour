using System.Net;
using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
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
