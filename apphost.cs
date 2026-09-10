#:package Aspire.Hosting.JavaScript@13.6.0-preview.1.26455.1
#:package Aspire.Hosting.PostgreSQL@13.6.0-preview.1.26455.1
#:package Aspire.Hosting.Docker@13.6.0-preview.1.26455.1
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

var api = builder.AddCSharpApp("api", "src/Detour.Api")
    .WithReference(tripDb)
    .WaitFor(tripDb)
    .WithExternalHttpEndpoints();

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

    var publicUrl = builder.Configuration["Detour:PublicUrl"] ?? "https://detour.bmstack.net";
    api.WithEndpoint("http", endpoint =>
        {
            endpoint.Port = 8080;
            endpoint.TargetPort = 8080;
        })
        .WithEnvironment("ASPNETCORE_ENVIRONMENT", "Production")
        // The only published port is loopback-bound for the host's cloudflared.
        .WithEnvironment("ASPNETCORE_FORWARDEDHEADERS_ENABLED", "true")
        .WithEnvironment("Auth__AllowLocalDev", "false")
        .WithEnvironment("Auth__PublicUrl", publicUrl)
        .WithEnvironment("AllowedHosts", new Uri(publicUrl).Host)
        .WithEnvironment("Auth__Google__ClientId", builder.AddParameter("GoogleClientId", secret: true))
        .WithEnvironment("Auth__Google__ClientSecret", builder.AddParameter("GoogleClientSecret", secret: true))
        .WithEnvironment("Auth__AllowedEmails__0", builder.AddParameter("OwnerEmail", secret: true))
        .WithEnvironment("Auth__OAuth__ClientId", builder.AddParameter("ChatGptClientId"))
        .WithEnvironment("Auth__OAuth__RedirectUris__0", builder.AddParameter("ChatGptRedirectUri"))
        .WithEnvironment("Auth__SigningCertificate__Path", "/run/detour-certificates/signing.pfx")
        .WithEnvironment("Auth__SigningCertificate__Password", builder.AddParameter("SigningCertificatePassword", secret: true))
        .WithEnvironment("Auth__EncryptionCertificate__Path", "/run/detour-certificates/encryption.pfx")
        .WithEnvironment("Auth__EncryptionCertificate__Password", builder.AddParameter("EncryptionCertificatePassword", secret: true))
        .WithEnvironment("DataProtection__KeysPath", "/var/lib/detour/keys")
        .PublishAsDockerComposeService((_, service) =>
        {
            service.Restart = "unless-stopped";
            // Compose's host-IP binding is not represented by EndpointAnnotation.
            service.Ports.Clear();
            service.Ports.Add("127.0.0.1:8080:8080");
            // These paths belong to the target Docker host, not the CI runner.
            service.Volumes.Add(new()
            {
                Name = "detour-certificates",
                Type = "bind",
                Source = builder.Configuration["Detour:CertificatesDirectory"] ?? "/srv/detour/certificates",
                Target = "/run/detour-certificates",
                ReadOnly = true
            });
            service.Volumes.Add(new()
            {
                Name = "detour-keys",
                Type = "bind",
                Source = builder.Configuration["Detour:KeysDirectory"] ?? "/srv/detour/keys",
                Target = "/var/lib/detour/keys"
            });
        });
    postgres.PublishAsDockerComposeService((_, service) => service.Restart = "unless-stopped");
}

builder.Build().Run();
