using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Http.Extensions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using ModelContextProtocol.Server;
using OpenIddict.Abstractions;
using OpenIddict.Server.AspNetCore;
using OpenIddict.Validation.AspNetCore;
using Detour.Api;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<OwnerAccessor>();
builder.Services.AddScoped<TripService>();
builder.Services.AddScoped<TripItemEditor>();
builder.Services.AddAntiforgery(options => options.HeaderName = "X-CSRF-TOKEN");

var connectionString = builder.Configuration.GetConnectionString("tripdb")
    ?? builder.Configuration.GetConnectionString("trip")
    ?? builder.Configuration.GetConnectionString("Trip");
if (!string.IsNullOrWhiteSpace(connectionString))
    builder.Services.AddDbContext<TripDbContext>(options => options.UseNpgsql(connectionString));
else if (builder.Configuration.GetValue<bool>("TripAdvisor:UseInMemory"))
    builder.Services.AddDbContext<TripDbContext>(options => options.UseInMemoryDatabase("tripadvisor-dev"));
else
    throw new InvalidOperationException("A PostgreSQL connection string is required. Set TripAdvisor:UseInMemory=true only for explicit local/test use.");

var issuer = builder.Configuration["Auth:Issuer"];
issuer ??= builder.Configuration["Auth:PublicUrl"];
var allowLocalDev = builder.Configuration.GetValue<bool>("Auth:AllowLocalDev");
var secured = !allowLocalDev;
var googleClientId = builder.Configuration["Auth:Google:ClientId"];
var googleClientSecret = builder.Configuration["Auth:Google:ClientSecret"];
var oauthScope = builder.Configuration["Auth:OAuth:Scope"] ?? "tripadvisor_api";
if (!builder.Environment.IsDevelopment())
{
    if (!Uri.TryCreate(issuer, UriKind.Absolute, out var configuredIssuer))
        throw new InvalidOperationException("Production OAuth requires Auth:PublicUrl (or Auth:Issuer) as the canonical HTTPS issuer URL.");
    if (configuredIssuer.Scheme != Uri.UriSchemeHttps)
        throw new InvalidOperationException("Production OAuth issuer must use HTTPS.");
}

var dataProtectionPath = builder.Configuration["DataProtection:KeysPath"];
if (!string.IsNullOrWhiteSpace(dataProtectionPath))
{
    builder.Services.AddDataProtection()
        .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionPath))
        .SetApplicationName("TripAdvisor");
}

var trustedProxyAddresses = builder.Configuration.GetSection("Auth:TrustedProxies").Get<string[]>() ?? [];
if (trustedProxyAddresses.Length > 0)
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
        options.ForwardLimit = 1;
        foreach (var address in trustedProxyAddresses)
            if (System.Net.IPAddress.TryParse(address, out var ip)) options.KnownProxies.Add(ip);
    });
}

builder.Services.AddIdentityCore<ApplicationUser>(options =>
    options.User.RequireUniqueEmail = true)
    .AddSignInManager()
    .AddEntityFrameworkStores<TripDbContext>()
    .AddDefaultTokenProviders();
builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = IdentityConstants.ApplicationScheme;
    options.DefaultSignInScheme = IdentityConstants.ExternalScheme;
    options.DefaultChallengeScheme = IdentityConstants.ApplicationScheme;
}).AddIdentityCookies();
if (!string.IsNullOrWhiteSpace(googleClientId) && !string.IsNullOrWhiteSpace(googleClientSecret))
    builder.Services.AddAuthentication().AddGoogle(GoogleDefaults.AuthenticationScheme, options =>
    {
        options.ClientId = googleClientId;
        options.ClientSecret = googleClientSecret;
        options.SignInScheme = IdentityConstants.ExternalScheme;
        options.SaveTokens = false;
        options.ClaimActions.MapJsonKey("email_verified", "verified_email", ClaimValueTypes.Boolean);
    });

builder.Services.AddOpenIddict()
    .AddCore(options => options.UseEntityFrameworkCore().UseDbContext<TripDbContext>())
    .AddServer(options =>
    {
        options.SetAuthorizationEndpointUris("/connect/authorize").SetTokenEndpointUris("/connect/token");
        options.AllowAuthorizationCodeFlow().AllowRefreshTokenFlow().RequireProofKeyForCodeExchange();
        options.AcceptAnonymousClients();
        options.RegisterScopes(OpenIddictConstants.Scopes.OpenId, OpenIddictConstants.Scopes.Profile, OpenIddictConstants.Scopes.Email, OpenIddictConstants.Scopes.OfflineAccess, oauthScope);
        options.SetAccessTokenLifetime(TimeSpan.FromHours(1));
        if (!string.IsNullOrWhiteSpace(issuer)) options.SetIssuer(new Uri(issuer));
        if (builder.Environment.IsDevelopment())
        {
            options.AddDevelopmentEncryptionCertificate().AddDevelopmentSigningCertificate();
        }
        var aspNetCore = options.UseAspNetCore().EnableAuthorizationEndpointPassthrough().EnableTokenEndpointPassthrough();
        if (builder.Environment.IsDevelopment()) aspNetCore.DisableTransportSecurityRequirement();
    })
    .AddValidation(options =>
    {
        options.UseAspNetCore();
        options.UseLocalServer();
        options.AddAudiences(oauthScope);
    });

if (!builder.Environment.IsDevelopment())
{
    var keyDirectory = builder.Configuration["Auth:KeysPath"]
        ?? throw new InvalidOperationException("Production requires Auth:KeysPath pointing to persistent writable storage.");
    builder.Services.AddManagedOAuthKeys(keyDirectory);
}

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("trip-data", policy => policy
        .AddAuthenticationSchemes(IdentityConstants.ApplicationScheme, OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme)
        .RequireAuthenticatedUser()
        .RequireAssertion(context =>
            context.User.Identity?.AuthenticationType == IdentityConstants.ApplicationScheme ||
            context.User.FindAll(OpenIddictConstants.Claims.Scope)
                .SelectMany(claim => claim.Value.Split(' ', StringSplitOptions.RemoveEmptyEntries))
                .Contains(oauthScope, StringComparer.Ordinal)));
});

builder.Services.AddMcpServer().WithHttpTransport(options => options.Stateless = false).WithTools<TripMcpTools>();
builder.Services.AddScoped<OpenIddictInitializer>();
var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();
if (trustedProxyAddresses.Length > 0)
    app.UseForwardedHeaders();
using (var initializationScope = app.Services.CreateScope())
{
    var db = initializationScope.ServiceProvider.GetRequiredService<TripDbContext>();
    // Migrations include the aggregate, Identity and OpenIddict tables. This
    // is additive and keeps the schema versioned once the app is deployed.
    await db.Database.MigrateAsync();
    await initializationScope.ServiceProvider.GetRequiredService<OpenIddictInitializer>().InitializeAsync();
}
app.Use(async (context, next) =>
{
    try { await next(); }
    catch (UnauthorizedAccessException)
    {
        if (!context.Response.HasStarted)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { error = "unauthorized" });
        }
    }
});
var seedPath = builder.Configuration["TripAdvisor:SeedPath"];
if (app.Environment.IsDevelopment() && !string.IsNullOrWhiteSpace(seedPath))
{
    using var scope = app.Services.CreateScope();
    var seedOwner = builder.Configuration["TripAdvisor:SeedOwnerId"];
    if (!string.IsNullOrWhiteSpace(seedOwner) || allowLocalDev)
        await scope.ServiceProvider.GetRequiredService<TripService>().SeedAsync(seedPath, seedOwner ?? "local-dev");
}
app.UseAuthentication();
app.UseAuthorization();
// Validate cookie-authenticated mutations explicitly for compatibility with
// the .NET 10 preview's minimal endpoint metadata surface.
app.Use(async (context, next) =>
{
    var mutation = HttpMethods.IsPost(context.Request.Method) || HttpMethods.IsPut(context.Request.Method) || HttpMethods.IsDelete(context.Request.Method) || HttpMethods.IsPatch(context.Request.Method);
    var cookieMutation = mutation && (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments("/auth/logout"));
    if (secured && cookieMutation && context.User.Identity?.IsAuthenticated == true && context.User.Identity.AuthenticationType != OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme)
    {
        try { await context.RequestServices.GetRequiredService<IAntiforgery>().ValidateRequestAsync(context); }
        catch (AntiforgeryValidationException)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(new { error = "csrf_validation_failed" });
            return;
        }
    }
    await next();
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
var getTrip = app.MapGet("/api/trip", async (TripService service, CancellationToken ct) => Results.Ok(await service.GetSnapshotAsync(ct)));
var putTrip = app.MapPut("/api/trip", async (TripSnapshot request, TripService service, CancellationToken ct) =>
{
    var result = await service.ReplaceAsync(request, request.Version, ct);
    return result switch
    {
        ReplaceResult.Success success => Results.Ok(success.Snapshot),
        ReplaceResult.Conflict conflict => Results.Conflict(conflict.Snapshot),
        ReplaceResult.Invalid => Results.BadRequest(new { error = "invalid_trip" }),
        _ => Results.BadRequest(new { error = "invalid_trip" })
    };
});
if (secured) { getTrip.RequireAuthorization("trip-data"); putTrip.RequireAuthorization("trip-data"); }
app.MapGet("/.well-known/oauth-protected-resource", (HttpRequest request) =>
{
    var resource = $"{request.Scheme}://{request.Host}/mcp";
    return Results.Ok(new { resource, authorization_servers = string.IsNullOrWhiteSpace(issuer) ? Array.Empty<string>() : new[] { issuer } });
});
app.MapGet("/.well-known/oauth-protected-resource/mcp", (HttpRequest request) => Results.Ok(new { resource = $"{request.Scheme}://{request.Host}/mcp", authorization_servers = string.IsNullOrWhiteSpace(issuer) ? Array.Empty<string>() : new[] { issuer! } }));
app.MapGet("/auth/login", (HttpRequest request) =>
{
    if (string.IsNullOrWhiteSpace(googleClientId) || string.IsNullOrWhiteSpace(googleClientSecret))
        return Results.Problem("Google OAuth is not configured. Set Auth:Google:ClientId and Auth:Google:ClientSecret.", statusCode: StatusCodes.Status503ServiceUnavailable);
    var returnUrl = SafeReturnUrl(request.Query["returnUrl"].ToString()) ?? "/";
    var properties = new AuthenticationProperties { RedirectUri = $"/auth/callback?returnUrl={Uri.EscapeDataString(returnUrl)}" };
    return Results.Challenge(properties, [GoogleDefaults.AuthenticationScheme]);
});
app.MapGet("/auth/callback", async (HttpContext context, SignInManager<ApplicationUser> signInManager, UserManager<ApplicationUser> userManager, HttpRequest request) =>
{
    var info = await signInManager.GetExternalLoginInfoAsync();
    if (info is null) return Results.Problem("The Google login response was not available.", statusCode: StatusCodes.Status401Unauthorized);
    var email = info.Principal.FindFirstValue(ClaimTypes.Email);
    var verified = info.Principal.FindFirst("email_verified")?.Value
        ?? info.Principal.FindFirst("urn:google:verified")?.Value;
    if (!string.Equals(verified, "true", StringComparison.OrdinalIgnoreCase))
        return Results.Problem("Google did not verify this email address.", statusCode: StatusCodes.Status403Forbidden);
    var allowed = builder.Configuration.GetSection("Auth:AllowedEmails").Get<string[]>() ?? [];
    if (string.IsNullOrWhiteSpace(email) || allowed.Length == 0 || !allowed.Contains(email, StringComparer.OrdinalIgnoreCase))
        return Results.Problem("This account is not allowed to use the private trip planner.", statusCode: StatusCodes.Status403Forbidden);
    var user = await userManager.FindByLoginAsync(info.LoginProvider, info.ProviderKey) ?? await userManager.FindByEmailAsync(email);
    if (user is null)
    {
        user = new ApplicationUser { UserName = email, Email = email, EmailConfirmed = true };
        var created = await userManager.CreateAsync(user);
        if (!created.Succeeded) return Results.Problem(string.Join("; ", created.Errors.Select(x => x.Description)), statusCode: StatusCodes.Status500InternalServerError);
    }
    if ((await userManager.FindByLoginAsync(info.LoginProvider, info.ProviderKey)) is null)
        await userManager.AddLoginAsync(user, info);
    await signInManager.SignInAsync(user, isPersistent: true);
    return Results.LocalRedirect(SafeReturnUrl(request.Query["returnUrl"].ToString()) ?? "/");
});
app.MapGet("/auth/me", (ClaimsPrincipal user) => Results.Ok(new
{
    authenticated = user.Identity?.IsAuthenticated == true,
    userId = user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue(OpenIddictConstants.Claims.Subject),
    email = user.FindFirstValue(ClaimTypes.Email),
    googleConfigured = !string.IsNullOrWhiteSpace(googleClientId) && !string.IsNullOrWhiteSpace(googleClientSecret),
    localDevelopment = allowLocalDev
}));
app.MapGet("/auth/csrf", (HttpContext context, IAntiforgery antiforgery) =>
{
    var tokens = antiforgery.GetAndStoreTokens(context);
    return Results.Ok(new { token = tokens.RequestToken });
});
var logout = app.MapPost("/auth/logout", async (SignInManager<ApplicationUser> signInManager) => { await signInManager.SignOutAsync(); return Results.NoContent(); });
if (secured) logout.RequireAuthorization("trip-data");

app.MapGet("/connect/authorize", async (HttpContext context, UserManager<ApplicationUser> users) =>
{
    var request = Microsoft.AspNetCore.OpenIddictServerAspNetCoreHelpers.GetOpenIddictServerRequest(context) ?? throw new InvalidOperationException("OpenIddict authorization request is missing.");
    var result = await context.AuthenticateAsync(IdentityConstants.ApplicationScheme);
    if (!result.Succeeded)
    {
        if (string.IsNullOrWhiteSpace(googleClientId) || string.IsNullOrWhiteSpace(googleClientSecret))
            return Results.Problem("Google OAuth is not configured. Set Auth:Google:ClientId and Auth:Google:ClientSecret.", statusCode: StatusCodes.Status503ServiceUnavailable);
        var authorizationPath = context.Request.PathBase + context.Request.Path + context.Request.QueryString;
        return Results.Redirect($"/auth/login?returnUrl={Uri.EscapeDataString(authorizationPath)}");
    }
    var user = await users.GetUserAsync(result.Principal!);
    if (user is null) return Results.Unauthorized();
    var identity = new ClaimsIdentity(TokenValidationParameters.DefaultAuthenticationType, OpenIddictConstants.Claims.Name, OpenIddictConstants.Claims.Role);
    identity.AddClaim(new Claim(OpenIddictConstants.Claims.Subject, user.Id));
    identity.AddClaim(new Claim(OpenIddictConstants.Claims.Name, user.UserName ?? user.Email ?? user.Id));
    if (!string.IsNullOrWhiteSpace(user.Email)) identity.AddClaim(new Claim(OpenIddictConstants.Claims.Email, user.Email));
    identity.SetScopes(request.GetScopes());
    identity.SetResources(oauthScope);
    foreach (var claim in identity.Claims)
        claim.SetDestinations(OpenIddictConstants.Destinations.AccessToken, OpenIddictConstants.Destinations.IdentityToken);
    return Results.SignIn(new ClaimsPrincipal(identity), properties: null, OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
});
app.MapPost("/connect/token", async (HttpContext context) =>
{
    var result = await context.AuthenticateAsync(OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
    if (!result.Succeeded || result.Principal is null) return Results.BadRequest(new { error = "invalid_grant" });
    return Results.SignIn(result.Principal, properties: null, OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
});
var mcp = app.MapMcp("/mcp");
if (secured) mcp.RequireAuthorization("trip-data");
// Known React routes only: missing API/auth/MCP endpoints must remain 404s.
foreach (var route in new[] { "/", "/plan", "/itinerary", "/preparation", "/{preview:int}" })
    app.MapFallbackToFile(route, "index.html");
app.Run();
static string? SafeReturnUrl(string? value)
    => !string.IsNullOrWhiteSpace(value) && value.StartsWith('/') && !value.StartsWith("//") ? value : null;
public partial class Program { }
