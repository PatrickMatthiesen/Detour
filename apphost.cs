#:package Aspire.Hosting.JavaScript@13.6.0-preview.1.26455.1
#:package Aspire.Hosting.PostgreSQL@13.6.0-preview.1.26455.1
#:package Aspire.Hosting.Docker@13.6.0-preview.1.26455.1
#:sdk Aspire.AppHost.Sdk@13.6.0-preview.1.26421.15
#:property AspireUseCliBundle=true
#:property NoWarn=ASPIRECSHARPAPPS001

var builder = DistributedApplication.CreateBuilder(args);

// Compose is used by `aspire publish`/`aspire deploy`; local development still runs
// the project and database resources directly through the AppHost.
var compose = builder.AddDockerComposeEnvironment("compose");

var postgres = builder.AddPostgres("postgres")
    .WithDataVolume();

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

#pragma warning disable ASPIREJAVASCRIPT001
web.PublishAsStaticWebsite(apiPath: "/api", apiTarget: api)
    .WithExternalHttpEndpoints();
#pragma warning restore ASPIREJAVASCRIPT001

builder.Build().Run();
