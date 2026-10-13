using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Identity;

namespace Detour.Api;

public static class DetourCalendarExtensions
{
    private const string OwnerProperty = "detour-calendar-owner";

    public static IServiceCollection AddDetourCalendar(this IServiceCollection services, IConfiguration configuration)
    {
        var calendarOptions = new DetourCalendarOptions
        {
            ClientId = configuration["Auth:Google:ClientId"],
            ClientSecret = configuration["Auth:Google:ClientSecret"]
        };
        services.AddSingleton(calendarOptions);
        services.AddSingleton<CalendarOwnerLock>();
        services.AddScoped<DetourCalendarService>();
        services.AddScoped<IGoogleCalendarClient, GoogleCalendarClient>();
        services.AddHttpClient("google-calendar", client => client.Timeout = TimeSpan.FromSeconds(30))
            .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false });
        services.AddHostedService<GoogleCalendarSyncWorker>();

        if (!calendarOptions.Configured) return services;
        services.AddAuthentication()
            .AddCookie(DetourCalendarOptions.TemporaryCookieScheme, cookie =>
            {
                cookie.Cookie.Name = "Detour.Calendar.OAuth";
                cookie.Cookie.HttpOnly = true;
                cookie.Cookie.SameSite = SameSiteMode.Lax;
                cookie.ExpireTimeSpan = TimeSpan.FromMinutes(5);
            })
            .AddGoogle(DetourCalendarOptions.AuthenticationScheme, google =>
            {
                google.ClientId = calendarOptions.ClientId!;
                google.ClientSecret = calendarOptions.ClientSecret!;
                google.SignInScheme = DetourCalendarOptions.TemporaryCookieScheme;
                google.CallbackPath = "/signin-google-calendar";
                google.AccessType = "offline";
                google.SaveTokens = false;
                google.Scope.Add(DetourCalendarOptions.Scope);
                google.Events.OnCreatingTicket = async context =>
                {
                    if (!context.Properties.Items.TryGetValue(OwnerProperty, out var ownerId) || string.IsNullOrWhiteSpace(ownerId))
                        throw new UnauthorizedAccessException();
                    var local = await context.HttpContext.AuthenticateAsync(IdentityConstants.ApplicationScheme);
                    var currentOwner = local.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                    if (!local.Succeeded || !string.Equals(ownerId, currentOwner, StringComparison.Ordinal))
                        throw new UnauthorizedAccessException();
                    var googleSubject = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier)
                        ?? context.Principal?.FindFirstValue("sub")
                        ?? throw new CalendarReauthorizationException("Google did not identify the connected account.");
                    var tokenResponse = context.TokenResponse.Response;
                    var scopes = tokenResponse is not null && tokenResponse.RootElement.TryGetProperty("scope", out var scope)
                        ? scope.GetString() ?? ""
                        : "";
                    await context.HttpContext.RequestServices.GetRequiredService<DetourCalendarService>()
                        .CompleteAuthorizationAsync(
                            ownerId,
                            googleSubject,
                            context.RefreshToken ?? "",
                            context.AccessToken ?? "",
                            scopes,
                            context.HttpContext.RequestAborted);
                };
                google.Events.OnTicketReceived = context =>
                {
                    context.HandleResponse();
                    context.Response.Redirect("/plan?calendar=connected");
                    return Task.CompletedTask;
                };
                google.Events.OnRemoteFailure = context =>
                {
                    context.HandleResponse();
                    context.Response.Redirect("/plan?calendar=failed");
                    return Task.CompletedTask;
                };
            });
        return services;
    }

    public static void MapDetourCalendar(this WebApplication app)
    {
        var status = app.MapGet("/api/calendar", async (OwnerAccessor owner, DetourCalendarService calendar, CancellationToken ct) =>
            Results.Ok(await calendar.GetStatusAsync(owner.OwnerId, ct)));
        var connect = app.MapPost("/api/calendar/connect", (DetourCalendarOptions options) =>
            options.Configured
                ? Results.Ok(new { url = "/auth/calendar/connect" })
                : Results.Problem("Google Calendar is not configured.", statusCode: StatusCodes.Status503ServiceUnavailable));
        var begin = app.MapGet("/auth/calendar/connect", (OwnerAccessor owner, DetourCalendarOptions options) =>
        {
            if (!options.Configured)
                return Results.Problem("Google Calendar is not configured.", statusCode: StatusCodes.Status503ServiceUnavailable);
            var properties = CreateChallengeProperties(owner.OwnerId);
            return Results.Challenge(properties, [DetourCalendarOptions.AuthenticationScheme]);
        });
        var sync = app.MapPost("/api/calendar/sync", async (OwnerAccessor owner, DetourCalendarService calendar, CancellationToken ct) =>
            Results.Ok(await calendar.RequestSyncAsync(owner.OwnerId, ct)));
        var disconnect = app.MapDelete("/api/calendar", async (OwnerAccessor owner, DetourCalendarService calendar, CancellationToken ct) =>
        {
            await calendar.DisconnectAsync(owner.OwnerId, ct);
            return Results.Ok(await calendar.GetStatusAsync(owner.OwnerId, ct));
        });
        // Google handles callbacks before endpoint execution. The mapped fallback
        // supplies rate-limit metadata to the middleware that runs before authentication.
        app.Map("/signin-google-calendar", (HttpContext context) =>
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return context.Response.WriteAsJsonAsync(new { error = "invalid_calendar_callback" });
        }).RequireRateLimiting(ApiRateLimits.OAuthRequestPolicy);

        if (!app.Configuration.GetValue<bool>("Auth:AllowLocalDev")) status.RequireAuthorization("calendar-browser");
        connect.RequireAuthorization("calendar-browser");
        begin.RequireAuthorization("calendar-browser");
        sync.RequireAuthorization("calendar-browser");
        disconnect.RequireAuthorization("calendar-browser");
        connect.RequireRateLimiting(ApiRateLimits.OwnerConcurrencyPolicy);
        sync.RequireRateLimiting(ApiRateLimits.OwnerConcurrencyPolicy);
        disconnect.RequireRateLimiting(ApiRateLimits.OwnerConcurrencyPolicy);
        begin.RequireRateLimiting(ApiRateLimits.OAuthRequestPolicy);
    }

    internal static GoogleChallengeProperties CreateChallengeProperties(string ownerId)
    {
        var properties = new GoogleChallengeProperties
        {
            RedirectUri = "/plan?calendar=connected",
            AccessType = "offline",
            Prompt = "consent"
        };
        properties.Items[OwnerProperty] = ownerId;
        return properties;
    }
}
