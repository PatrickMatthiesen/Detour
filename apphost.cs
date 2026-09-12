#:package Aspire.Hosting.JavaScript@13.6.0-preview.1.26455.1
#:package Aspire.Hosting.PostgreSQL@13.6.0-preview.1.26455.1
#:package Aspire.Hosting.Docker@13.6.0-preview.1.26455.1
#:package Subjective.Aspire.Hosting.Garage@0.1.0-preview.6
#:sdk Aspire.AppHost.Sdk@13.6.0-preview.1.26421.15
#:property AspireUseCliBundle=true
#:property NoWarn=ASPIRECSHARPAPPS001


var builder = DistributedApplication.CreateBuilder(args);

// Compose is used by `aspire publish`/`aspire deploy`; local development still runs
// the project and database resources directly through the AppHost.
var compose = builder.AddDockerComposeEnvironment("compose")
    .WithDashboard(false)
    .ConfigureComposeFile(file => file.Name = "detour");

var postgres = builder.AddPostgres("postgres")
    .WithDataVolume(builder.ExecutionContext.IsPublishMode ? "detour-postgres-data" : null);

var tripDb = postgres.AddDatabase("tripdb");

var garage = builder.AddGarage("garage")
    .WithDataVolume(builder.ExecutionContext.IsPublishMode ? "detour-garage-data" : null);
garage.Resource.Provisioner.WithImageSHA256("5bb92ac5c7ac39065333a087b0c0761bce8a05f2a5bffb93f87dce90b416f2d9");
var photos = garage.AddBucket("photos", "detour-place-photos");

var api = builder.AddCSharpApp("api", "src/Detour.Api")
    .WithReference(tripDb)
    .WithReference(photos)
    .WaitForCompletion(garage.Resource.Provisioner)
    .WaitFor(tripDb)
    .WithExternalHttpEndpoints();

// Keep the optional key visible in the dashboard. The API treats an empty value
// as unconfigured, so direct-coordinate links work without a Google API key.
var googleMapsApiKey = builder.AddParameter("GoogleMapsApiKey",
        () => builder.Configuration["Parameters:GoogleMapsApiKey"] ?? "", secret: true)
    .WithDescription("Optional Places API (New) key for resolving name-only Google Maps links. Leave empty to disable lookup.");
api.WithEnvironment("GoogleMaps__ApiKey", googleMapsApiKey);

// The real-data seed is a local development convenience. It is deliberately not
// copied into deployment artifacts, where this workstation path would be invalid.
if (builder.ExecutionContext.IsRunMode)
    api.WithEnvironment("TripAdvisor__SeedPath", Path.GetFullPath("data/japan-2026.seed.json"));

var web = builder.AddViteApp("web", "web")
    .WithReference(api)
    .WithEnvironment("BROWSER", "none")
    .WaitFor(api);

api.PublishWithContainerFiles(web, "/app/wwwroot");

if (builder.ExecutionContext.IsPublishMode)
{
    foreach (var endpoint in api.Resource.Annotations
        .OfType<Aspire.Hosting.ApplicationModel.EndpointAnnotation>()
        .Where(endpoint => endpoint.Name != "http").ToArray())
        api.Resource.Annotations.Remove(endpoint);

    var publicUrl = builder.Configuration["Detour:PublicUrl"] ?? "https://detour.patrickbm.com";
    api.WithEndpoint("http", endpoint =>
        {
            endpoint.Port = 48327;
            endpoint.TargetPort = 8080;
        })
        .WithEnvironment("ASPNETCORE_ENVIRONMENT", "Production")
        // Cloudflared runs on another VM on the trusted local network.
        .WithEnvironment("ASPNETCORE_FORWARDEDHEADERS_ENABLED", "true")
        .WithEnvironment("Auth__AllowLocalDev", "false")
        .WithEnvironment("Auth__PublicUrl", publicUrl)
        .WithEnvironment("AllowedHosts", new Uri(publicUrl).Host)
        .WithEnvironment("Auth__Google__ClientId", builder.AddParameter("GoogleClientId", secret: true))
        .WithEnvironment("Auth__Google__ClientSecret", builder.AddParameter("GoogleClientSecret", secret: true))
        .WithEnvironment("Auth__AllowedEmails__0", builder.AddParameter("OwnerEmail", secret: true))
        .WithEnvironment("Auth__OAuth__ClientId", builder.AddParameter("ChatGptClientId"))
        .WithEnvironment("Auth__OAuth__RedirectUris__0", builder.AddParameter("ChatGptRedirectUri"))
        .WithEnvironment("Auth__KeysPath", "/var/lib/detour/keys/oauth")
        .WithEnvironment("DataProtection__KeysPath", "/var/lib/detour/keys")
        .PublishAsDockerComposeService((_, service) =>
        {
            service.Restart = "unless-stopped";
            // Keep the explicit host port; omit Aspire's random-port mapping.
            service.Ports.RemoveAll(port => !port.Contains(':'));
            // These paths belong to the target Docker host, not the CI runner.
            service.Volumes.Add(new()
            {
                Name = "detour-keys",
                Type = "bind",
                Source = builder.Configuration["Detour:KeysDirectory"] ?? "/srv/detour/keys",
                Target = "/var/lib/detour/keys"
            });
        });
    postgres.PublishAsDockerComposeService((_, service) => service.Restart = "unless-stopped");
    garage.PublishAsDockerComposeService((_, service) => service.Restart = "unless-stopped");
}

builder.Build().Run();
