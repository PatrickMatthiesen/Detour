using System.Collections.Concurrent;
using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Npgsql;
using Detour.Api;
using OpenIddict.Abstractions;

namespace Detour.Api.Tests;

/// <summary>
/// Real PostgreSQL checks are opt-in with TRIPADVISOR_TEST_CONNECTION. The fixture
/// creates and drops a private schema, so these tests never touch application data.
/// Example: Host=localhost;Port=28168;Username=postgres;Password=...;Database=postgres.
/// </summary>
public sealed class PostgresIntegrationTests : IAsyncLifetime
{
    private readonly string? baseConnection = Environment.GetEnvironmentVariable("TRIPADVISOR_TEST_CONNECTION");
    private string? schema;
    private string? connection;

    public async Task InitializeAsync()
    {
        if (string.IsNullOrWhiteSpace(baseConnection)) return;
        schema = "trip_test_" + Guid.NewGuid().ToString("N");
        var admin = new NpgsqlConnectionStringBuilder(baseConnection) { SearchPath = null };
        await using var db = new NpgsqlConnection(admin.ConnectionString);
        await db.OpenAsync();
        await using var command = db.CreateCommand();
        command.CommandText = $"CREATE SCHEMA \"{schema}\"";
        await command.ExecuteNonQueryAsync();
        var isolated = new NpgsqlConnectionStringBuilder(baseConnection) { SearchPath = schema };
        connection = isolated.ConnectionString;
        await using var context = CreateDb();
        await context.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        if (string.IsNullOrWhiteSpace(baseConnection) || string.IsNullOrWhiteSpace(schema)) return;
        var admin = new NpgsqlConnectionStringBuilder(baseConnection) { SearchPath = null };
        await using var db = new NpgsqlConnection(admin.ConnectionString);
        await db.OpenAsync();
        await using var command = db.CreateCommand();
        command.CommandText = $"DROP SCHEMA IF EXISTS \"{schema}\" CASCADE";
        await command.ExecuteNonQueryAsync();
    }

    [Fact]
    public async Task Seed_roundtrips_all_real_data_and_offset_fields_through_postgres()
    {
        if (!HasDatabase()) return;
        await using var db = CreateDb();
        var service = CreateService(db, "seed-owner");
        var seed = new TripSnapshot
        {
            Version = 7,
            Trip = new TripDocument
            {
                Id = "synthetic-trip",
                Name = "Synthetic Trip",
                StartDate = new DateOnly(2026, 9, 30),
                EndDate = new DateOnly(2026, 10, 25),
                TimeZone = "Asia/Tokyo",
                Arrival = new FlightAnchor
                {
                    Airport = "HND",
                    LocalDateTime = new DateTimeOffset(2026, 9, 30, 16, 45, 0, TimeSpan.FromHours(9)),
                    Date = new DateOnly(2026, 9, 30),
                    Raw = "synthetic arrival"
                }
            },
            Places = [new Place { Id = "seed-place", Name = "Synthetic Place", City = "Tokyo", Latitude = 35.68, Longitude = 139.7, SourceUrl = "https://example.test/place" }],
            Stays = [new Stay { Id = "seed-stay", Name = "Synthetic Stay", City = "Tokyo", CheckIn = new DateOnly(2026, 9, 30), CheckOut = new DateOnly(2026, 10, 1) }],
            TravelLegs = [new TravelLeg { Id = "seed-leg", From = "Tokyo", To = "Kyoto", Date = new DateOnly(2026, 10, 1), Mode = "train", Estimated = false }],
            Activities = [new Activity { Id = "seed-activity", Title = "Synthetic Activity", Date = new DateOnly(2026, 10, 1) }],
            Bookings = [new Booking
            {
                Id = "seed-booking",
                Kind = "flight",
                Title = "Synthetic Flight",
                Start = new DateTimeOffset(2026, 10, 1, 10, 0, 0, TimeSpan.FromHours(2)),
                End = new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.FromHours(2)),
                Location = "HND"
            }],
            Tasks = [new TripTask { Id = "seed-task", Title = "Synthetic Task" }],
            PackingItems = [new PackingItem { Id = "seed-packing", Name = "Synthetic Packing Item" }]
        };
        var seedPath = Path.Combine(Path.GetTempPath(), $"tripadvisor-seed-{Guid.NewGuid():N}.json");

        try
        {
            await File.WriteAllTextAsync(seedPath, JsonSerializer.Serialize(seed, JsonOptions));
            await service.SeedAsync(seedPath, "seed-owner");
            await using var secondDb = CreateDb();
            var reloaded = await CreateService(secondDb, "seed-owner").GetSnapshotAsync();

            Assert.Equal(7, reloaded.Version);
            Assert.Single(reloaded.Places);
            Assert.Equal("seed-place", Assert.Single(reloaded.Places).Id);
            Assert.Equal("Synthetic Stay", Assert.Single(reloaded.Stays).Name);
            Assert.Equal("seed-leg", Assert.Single(reloaded.TravelLegs).Id);
            Assert.Equal("Synthetic Activity", Assert.Single(reloaded.Activities).Title);
            Assert.Equal("Synthetic Flight", Assert.Single(reloaded.Bookings).Title);
            Assert.Equal("Synthetic Task", Assert.Single(reloaded.Tasks).Title);
            Assert.Equal("Synthetic Packing Item", Assert.Single(reloaded.PackingItems).Name);
            Assert.Equal("Asia/Tokyo", reloaded.Trip.TimeZone);
            Assert.Equal("HND", reloaded.Trip.Arrival?.Airport);
            Assert.Equal(TimeSpan.FromHours(9), reloaded.Trip.Arrival!.LocalDateTime!.Value.Offset);
            Assert.Equal(TimeSpan.FromHours(2), Assert.Single(reloaded.Bookings).Start!.Value.Offset);
        }
        finally
        {
            if (File.Exists(seedPath)) File.Delete(seedPath);
        }
    }

    [Fact]
    public async Task Concurrent_postgres_writes_allow_exactly_one_version_to_win()
    {
        if (!HasDatabase()) return;
        await using var setup = CreateDb();
        var initial = await CreateService(setup, "race-owner").GetSnapshotAsync();
        await using var db1 = CreateDb();
        await using var db2 = CreateDb();
        var service1 = CreateService(db1, "race-owner");
        var service2 = CreateService(db2, "race-owner");
        var left = Clone(initial); left.Places.Add(new Place { Id = "race-left", Name = "Left", City = "Tokyo", Latitude = 35.68, Longitude = 139.7 });
        var right = Clone(initial); right.Places.Add(new Place { Id = "race-right", Name = "Right", City = "Tokyo", Latitude = 35.68, Longitude = 139.7 });

        await service1.GetSnapshotAsync();
        await service2.GetSnapshotAsync();
        var results = await Task.WhenAll(service1.ReplaceAsync(left, initial.Version), service2.ReplaceAsync(right, initial.Version));

        Assert.Equal(1, results.Count(x => x is ReplaceResult.Success));
        Assert.Equal(1, results.Count(x => x is ReplaceResult.Conflict));
        await using var verifyDb = CreateDb();
        var final = await CreateService(verifyDb, "race-owner").GetSnapshotAsync();
        Assert.Equal(2, final.Version);
        Assert.Single(final.Places);
        var loser = results[0] is ReplaceResult.Conflict ? service1 : service2;
        var recovered = await loser.GetSnapshotAsync();
        Assert.Equal(final.Places[0].Id, Assert.Single(recovered.Places).Id);
        var edit = await new TripItemEditor(loser).EditAsync("places", "update", final.Places[0].Id,
            new System.Text.Json.Nodes.JsonObject { ["selected"] = true }, final.Version);
        Assert.True(edit.Success);
    }

    [Fact]
    public async Task Early_version_conflict_refreshes_a_preloaded_service_tracker()
    {
        if (!HasDatabase()) return;
        await using var setup = CreateDb();
        var initial = await CreateService(setup, "early-conflict-owner").GetSnapshotAsync();
        await using var loserDb = CreateDb();
        await using var winnerDb = CreateDb();
        var loser = CreateService(loserDb, "early-conflict-owner");
        var winner = CreateService(winnerDb, "early-conflict-owner");
        var stale = await loser.GetSnapshotAsync();
        var winning = Clone(initial);
        winning.Places.Add(new Place { Id = "winner-place", Name = "Winner", City = "Tokyo", Latitude = 35.68, Longitude = 139.7 });
        var saved = Assert.IsType<ReplaceResult.Success>(await winner.ReplaceAsync(winning, initial.Version));
        stale.Places.Add(new Place { Id = "loser-place", Name = "Loser", City = "Tokyo", Latitude = 35.68, Longitude = 139.7 });

        var conflict = Assert.IsType<ReplaceResult.Conflict>(await loser.ReplaceAsync(stale, stale.Version));

        Assert.Equal(saved.Snapshot.Version, conflict.Snapshot.Version);
        Assert.Equal("winner-place", Assert.Single(conflict.Snapshot.Places).Id);
        var recovered = await loser.GetSnapshotAsync();
        Assert.Equal(saved.Snapshot.Version, recovered.Version);
        Assert.Equal("winner-place", Assert.Single(recovered.Places).Id);
        var edit = await new TripItemEditor(loser).EditAsync("places", "update", "winner-place",
            new System.Text.Json.Nodes.JsonObject { ["selected"] = true }, recovered.Version);
        Assert.True(edit.Success);
    }

    [Fact]
    public async Task Different_authenticated_owners_are_isolated_in_postgres()
    {
        if (!HasDatabase()) return;
        await using var dbA = CreateDb();
        await using var dbB = CreateDb();
        var a = CreateService(dbA, "owner-a");
        var b = CreateService(dbB, "owner-b");
        var snapshot = await a.GetSnapshotAsync();
        snapshot.Places.Add(new Place { Id = "private-a", Name = "Private", City = "Tokyo", Latitude = 35.68, Longitude = 139.7 });
        await a.ReplaceAsync(snapshot, snapshot.Version);

        Assert.Single((await a.GetSnapshotAsync()).Places);
        Assert.Empty((await b.GetSnapshotAsync()).Places);
    }

    [Fact]
    public async Task Mcp_sdk_tools_write_place_and_booking_to_postgres()
    {
        if (!HasDatabase()) return;
        await using var db = CreateDb();
        var service = CreateService(db, "mcp-owner");
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var initial = await tools.GetTrip();
        Assert.Equal(1, initial.Version);
        var second = await tools.EditPlace(EditOperation.create, "mcp-place", 1,
            new PlaceChanges { Name = "MCP Place", City = "Tokyo", Latitude = 35.68, Longitude = 139.7, SourceUrl = "https://example.test/reel" });
        Assert.True(second.Success);
        Assert.Equal(2, second.Version);
        Assert.True((await tools.EditPlace(EditOperation.create, "mcp-place-2", 2,
            new PlaceChanges { Name = "Second Reel Place", City = "Tokyo", Latitude = 35.68, Longitude = 139.7, SourceUrl = "https://example.test/reel" })).Success);
        Assert.True((await tools.EditBooking(EditOperation.create, "mcp-booking", 3,
            new BookingChanges { Kind = "hotel", Title = "MCP Hotel", Status = "confirmed", CheckIn = new(2026, 10, 1), CheckOut = new(2026, 10, 3) })).Success);
        var final = await service.GetSnapshotAsync();
        Assert.Equal(2, final.Places.Count);
        Assert.Contains(final.Places, x => x.Id == "mcp-place-2");
        Assert.Contains(final.Bookings, x => x.Id == "mcp-booking");
        Assert.False((await tools.EditBooking(EditOperation.update, "mcp-booking", 3, new BookingChanges { Title = "Stale" })).Success);
        Assert.Equal("MCP Hotel", Assert.Single((await service.GetSnapshotAsync()).Bookings).Title);
    }

    [Fact]
    public async Task First_migration_preserves_a_pre_migration_trip_table()
    {
        if (string.IsNullOrWhiteSpace(baseConnection)) return;
        var legacySchema = "trip_legacy_" + Guid.NewGuid().ToString("N");
        var adminBuilder = new NpgsqlConnectionStringBuilder(baseConnection) { SearchPath = null };
        await using (var admin = new NpgsqlConnection(adminBuilder.ConnectionString))
        {
            await admin.OpenAsync();
            await using var command = admin.CreateCommand();
            command.CommandText = $"CREATE SCHEMA \"{legacySchema}\"";
            await command.ExecuteNonQueryAsync();
        }

        try
        {
            var legacyConnection = new NpgsqlConnectionStringBuilder(baseConnection) { SearchPath = legacySchema }.ConnectionString;
            await using (var legacy = new NpgsqlConnection(legacyConnection))
            {
                await legacy.OpenAsync();
                await using var command = legacy.CreateCommand();
                command.CommandText = """
                    CREATE TABLE "Trips" ("Id" uuid NOT NULL, "OwnerId" varchar(200) NOT NULL, "Version" bigint NOT NULL, "Json" jsonb NOT NULL, "UpdatedAt" timestamptz NOT NULL, CONSTRAINT "PK_Trips" PRIMARY KEY ("Id"));
                    CREATE UNIQUE INDEX "IX_Trips_OwnerId" ON "Trips" ("OwnerId");
                    INSERT INTO "Trips" VALUES ('11111111-1111-1111-1111-111111111111', 'legacy-owner', 7, '{"version":7,"places":[]}', now());
                    """;
                await command.ExecuteNonQueryAsync();
            }

            await using var migrated = new TripDbContext(new DbContextOptionsBuilder<TripDbContext>().UseNpgsql(legacyConnection).Options);
            await migrated.Database.MigrateAsync();
            var row = await migrated.Trips.SingleAsync(x => x.OwnerId == "legacy-owner");
            Assert.Equal(7, row.Version);
            Assert.Equal(7, JsonDocument.Parse(row.Json).RootElement.GetProperty("version").GetInt32());
        }
        finally
        {
            await using var admin = new NpgsqlConnection(adminBuilder.ConnectionString);
            await admin.OpenAsync();
            await using var command = admin.CreateCommand();
            command.CommandText = $"DROP SCHEMA IF EXISTS \"{legacySchema}\" CASCADE";
            await command.ExecuteNonQueryAsync();
        }
    }

    [Fact]
    public async Task Auth_me_exposes_login_capabilities_without_exposing_owner_data()
    {
        if (!HasDatabase()) return;
        var previous = Environment.GetEnvironmentVariable("ConnectionStrings__tripdb");
        Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", connection);
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development"));
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("http://localhost") });
            using var response = await client.GetAsync("/auth/me");
            response.EnsureSuccessStatusCode();
            var json = JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync(), JsonOptions);
            Assert.False(json.GetProperty("authenticated").GetBoolean());
            Assert.True(json.GetProperty("localDevelopment").GetBoolean());
            Assert.False(json.GetProperty("googleConfigured").GetBoolean());
        }
        finally { Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", previous); }
    }

    [Fact]
    public async Task Protected_resource_metadata_advertises_the_canonical_mcp_resource()
    {
        if (!HasDatabase()) return;
        var previousConnection = Environment.GetEnvironmentVariable("ConnectionStrings__tripdb");
        var previousPublicUrl = Environment.GetEnvironmentVariable("Auth__PublicUrl");
        Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", connection);
        Environment.SetEnvironmentVariable("Auth__PublicUrl", "https://detour.example.test");
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development"));
            using var response = await factory.CreateClient().GetAsync("/.well-known/oauth-protected-resource/mcp");
            response.EnsureSuccessStatusCode();
            var metadata = JsonSerializer.Deserialize<JsonElement>(await response.Content.ReadAsStringAsync(), JsonOptions);
            Assert.Equal("https://detour.example.test/mcp", metadata.GetProperty("resource").GetString());
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", previousConnection);
            Environment.SetEnvironmentVariable("Auth__PublicUrl", previousPublicUrl);
        }
    }

    [Fact]
    public async Task OAuth_initializer_reconciles_an_existing_scope_to_the_canonical_resource()
    {
        if (!HasDatabase()) return;
        const string scope = "tripadvisor_api";
        const string resource = "https://detour.example.test/mcp";
        await using (var db = new NpgsqlConnection(connection))
        {
            await db.OpenAsync();
            await using var command = db.CreateCommand();
            command.CommandText = """
                INSERT INTO "OpenIddictScopes" ("Id", "Name", "DisplayName", "Resources")
                VALUES (@id, @name, 'stale resource', '["tripadvisor_api"]')
                ON CONFLICT ("Name") DO UPDATE SET "DisplayName" = EXCLUDED."DisplayName", "Resources" = EXCLUDED."Resources"
                """;
            command.Parameters.AddWithValue("id", "stale-" + Guid.NewGuid().ToString("N"));
            command.Parameters.AddWithValue("name", scope);
            await command.ExecuteNonQueryAsync();
        }

        var previousConnection = Environment.GetEnvironmentVariable("ConnectionStrings__tripdb");
        var previousPublicUrl = Environment.GetEnvironmentVariable("Auth__PublicUrl");
        Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", connection);
        Environment.SetEnvironmentVariable("Auth__PublicUrl", "https://detour.example.test");
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development"));
            using var serviceScope = factory.Services.CreateScope();
            var manager = serviceScope.ServiceProvider.GetRequiredService<IOpenIddictScopeManager>();
            var existing = await manager.FindByNameAsync(scope);
            Assert.NotNull(existing);
            Assert.Equal("Detour data", await manager.GetDisplayNameAsync(existing!));
            Assert.Equal(resource, Assert.Single(await manager.GetResourcesAsync(existing!)));
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", previousConnection);
            Environment.SetEnvironmentVariable("Auth__PublicUrl", previousPublicUrl);
        }
    }

    [Fact]
    public async Task Google_login_challenge_preserves_identity_external_login_provider()
    {
        if (!HasDatabase()) return;
        var previousConnection = Environment.GetEnvironmentVariable("ConnectionStrings__tripdb");
        var previousClientId = Environment.GetEnvironmentVariable("Auth__Google__ClientId");
        var previousClientSecret = Environment.GetEnvironmentVariable("Auth__Google__ClientSecret");
        Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", connection);
        Environment.SetEnvironmentVariable("Auth__Google__ClientId", "regression-client");
        Environment.SetEnvironmentVariable("Auth__Google__ClientSecret", "regression-secret");
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development"));
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                BaseAddress = new Uri("http://localhost"),
                AllowAutoRedirect = false
            });

            using var response = await client.GetAsync("/auth/login?returnUrl=%2Fplan");
            Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
            var location = Assert.IsType<Uri>(response.Headers.Location);
            var state = QueryHelpers.ParseQuery(location.Query)["state"].ToString();
            Assert.False(string.IsNullOrWhiteSpace(state));

            var googleOptions = factory.Services.GetRequiredService<IOptionsMonitor<GoogleOptions>>().Get(GoogleDefaults.AuthenticationScheme);
            var properties = googleOptions.StateDataFormat.Unprotect(state);
            Assert.NotNull(properties);
            Assert.Equal(GoogleDefaults.AuthenticationScheme, properties!.Items["LoginProvider"]);
            Assert.Equal("/auth/callback?returnUrl=%2Fplan", properties.RedirectUri);
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", previousConnection);
            Environment.SetEnvironmentVariable("Auth__Google__ClientId", previousClientId);
            Environment.SetEnvironmentVariable("Auth__Google__ClientSecret", previousClientSecret);
        }
    }

    [Theory]
    [InlineData("owner@example.test", true, true)]
    [InlineData("other@example.test", true, false)]
    [InlineData("owner@example.test", false, false)]
    public async Task Google_callback_authenticates_only_allowed_verified_users(string email, bool verified, bool expectedAuthenticated)
    {
        if (!HasDatabase()) return;
        var previousConnection = Environment.GetEnvironmentVariable("ConnectionStrings__tripdb");
        var previousClientId = Environment.GetEnvironmentVariable("Auth__Google__ClientId");
        var previousClientSecret = Environment.GetEnvironmentVariable("Auth__Google__ClientSecret");
        var previousAllowedEmail = Environment.GetEnvironmentVariable("Auth__AllowedEmails__0");
        var previousLocalDev = Environment.GetEnvironmentVariable("Auth__AllowLocalDev");
        Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", connection);
        Environment.SetEnvironmentVariable("Auth__Google__ClientId", "regression-client");
        Environment.SetEnvironmentVariable("Auth__Google__ClientSecret", "regression-secret");
        Environment.SetEnvironmentVariable("Auth__AllowedEmails__0", "owner@example.test");
        Environment.SetEnvironmentVariable("Auth__AllowLocalDev", "false");
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Development");
                builder.ConfigureTestServices(services => services.PostConfigure<GoogleOptions>(
                    GoogleDefaults.AuthenticationScheme, options =>
                    {
                        options.AuthorizationEndpoint = "https://accounts.google.test/o/oauth2/v2/auth";
                        options.TokenEndpoint = "https://oauth2.google.test/token";
                        options.UserInformationEndpoint = "https://oauth2.google.test/userinfo";
                        options.Backchannel = new HttpClient(new GoogleBackchannelHandler(email, verified));
                    }));
            });
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                BaseAddress = new Uri("https://localhost"),
                AllowAutoRedirect = false
            });

            using var login = await client.GetAsync("/auth/login?returnUrl=%2Fplan");
            Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
            var authorization = Assert.IsType<Uri>(login.Headers.Location);
            var state = QueryHelpers.ParseQuery(authorization.Query)["state"].ToString();
            Assert.False(string.IsNullOrWhiteSpace(state));

            using var googleCallback = await client.GetAsync($"/signin-google?code=test-code&state={Uri.EscapeDataString(state)}");
            Assert.Equal(HttpStatusCode.Redirect, googleCallback.StatusCode);
            var callback = Assert.IsType<Uri>(googleCallback.Headers.Location);
            Assert.Equal("/auth/callback?returnUrl=%2Fplan", callback.OriginalString);

            using var completed = await client.GetAsync(callback.OriginalString);
            Assert.Equal(HttpStatusCode.Redirect, completed.StatusCode);
            Assert.Equal(expectedAuthenticated ? "/plan" : "/?login=denied", Assert.IsType<Uri>(completed.Headers.Location).OriginalString);

            using var me = await client.GetAsync("/auth/me");
            me.EnsureSuccessStatusCode();
            var json = JsonSerializer.Deserialize<JsonElement>(await me.Content.ReadAsStringAsync(), JsonOptions);
            Assert.Equal(expectedAuthenticated, json.GetProperty("authenticated").GetBoolean());
            if (expectedAuthenticated) Assert.Equal(email, json.GetProperty("email").GetString());
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", previousConnection);
            Environment.SetEnvironmentVariable("Auth__Google__ClientId", previousClientId);
            Environment.SetEnvironmentVariable("Auth__Google__ClientSecret", previousClientSecret);
            Environment.SetEnvironmentVariable("Auth__AllowedEmails__0", previousAllowedEmail);
            Environment.SetEnvironmentVariable("Auth__AllowLocalDev", previousLocalDev);
        }
    }

    [Fact]
    public async Task Protected_api_and_mcp_reject_anonymous_and_invalid_bearer_requests()
    {
        if (!HasDatabase()) return;
        var previousConnection = Environment.GetEnvironmentVariable("ConnectionStrings__tripdb");
        var previousLocal = Environment.GetEnvironmentVariable("Auth__AllowLocalDev");
        Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", connection);
        Environment.SetEnvironmentVariable("Auth__AllowLocalDev", "false");
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder => builder.UseEnvironment("Development"));
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("http://localhost"), AllowAutoRedirect = false });

            using var anonymous = await client.GetAsync("/api/trip");
            Assert.Contains(anonymous.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Redirect });
            Assert.DoesNotContain("places", await anonymous.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

            using var invalid = new HttpRequestMessage(HttpMethod.Get, "/api/trip");
            invalid.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "definitely-not-a-token");
            using var invalidResponse = await client.SendAsync(invalid);
            Assert.Contains(invalidResponse.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Redirect });

            using var mcpRequest = new HttpRequestMessage(HttpMethod.Post, "/mcp")
            {
                Content = new StringContent("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}", Encoding.UTF8, "application/json")
            };
            mcpRequest.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "definitely-not-a-token");
            using var mcp = await client.SendAsync(mcpRequest);
            Assert.Contains(mcp.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Redirect });
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", previousConnection);
            Environment.SetEnvironmentVariable("Auth__AllowLocalDev", previousLocal);
        }
    }

    [Fact]
    public async Task Authenticated_http_photo_roundtrip_is_private_and_survives_full_trip_replace()
    {
        if (!HasDatabase()) return;
        var previousConnection = Environment.GetEnvironmentVariable("ConnectionStrings__tripdb");
        var previousLocal = Environment.GetEnvironmentVariable("Auth__AllowLocalDev");
        var previousClientId = Environment.GetEnvironmentVariable("Auth__Google__ClientId");
        var previousClientSecret = Environment.GetEnvironmentVariable("Auth__Google__ClientSecret");
        var previousAllowed = Environment.GetEnvironmentVariable("Auth__AllowedEmails__0");
        Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", connection);
        Environment.SetEnvironmentVariable("Auth__AllowLocalDev", "false");
        Environment.SetEnvironmentVariable("Auth__Google__ClientId", "photo-test-client");
        Environment.SetEnvironmentVariable("Auth__Google__ClientSecret", "photo-test-secret");
        Environment.SetEnvironmentVariable("Auth__AllowedEmails__0", "photo-owner@example.test");
        try
        {
            var store = new HttpPhotoStore();
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Development");
                builder.ConfigureTestServices(services =>
                {
                    services.RemoveAll<IPhotoObjectStore>();
                    services.AddSingleton<IPhotoObjectStore>(store);
                    services.PostConfigure<GoogleOptions>(GoogleDefaults.AuthenticationScheme, options =>
                    {
                        options.AuthorizationEndpoint = "https://accounts.google.test/o/oauth2/v2/auth";
                        options.TokenEndpoint = "https://oauth2.google.test/token";
                        options.UserInformationEndpoint = "https://oauth2.google.test/userinfo";
                        options.Backchannel = new HttpClient(new GoogleBackchannelHandler("photo-owner@example.test", true));
                    });
                });
            });
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });

            using var anonymous = await client.GetAsync($"/api/places/missing/photo?v={Guid.NewGuid():N}");
            Assert.Contains(anonymous.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.Redirect });
            await CompleteGoogleLoginAsync(client, "/");

            using var read = await client.GetAsync("/api/trip");
            read.EnsureSuccessStatusCode();
            var snapshot = JsonSerializer.Deserialize<TripSnapshot>(await read.Content.ReadAsStringAsync(), JsonOptions)!;
            snapshot.Places.Add(new Place { Id = "http-photo-place", Name = "HTTP photo place", City = "Tokyo", Latitude = 35.68, Longitude = 139.7 });
            var csrf = JsonSerializer.Deserialize<JsonElement>(await (await client.GetAsync("/auth/csrf")).Content.ReadAsStringAsync(), JsonOptions).GetProperty("token").GetString();
            using var replace = new HttpRequestMessage(HttpMethod.Put, "/api/trip") { Content = JsonContent.Create(snapshot) };
            replace.Headers.TryAddWithoutValidation("X-CSRF-TOKEN", csrf);
            replace.Headers.TryAddWithoutValidation("If-Match", snapshot.Version.ToString());
            using var savedResponse = await client.SendAsync(replace);
            savedResponse.EnsureSuccessStatusCode();
            var saved = JsonSerializer.Deserialize<TripSnapshot>(await savedResponse.Content.ReadAsStringAsync(), JsonOptions)!;

            using var form = new MultipartFormDataContent();
            form.Add(new StringContent(saved.Version.ToString()), "expectedVersion");
            form.Add(new StringContent("https://example.test/photo"), "sourceUrl");
            form.Add(new StringContent("Photo Author"), "author");
            form.Add(new StringContent("Tokyo"), "caption");
            form.Add(new StringContent("place"), "kind");
            form.Add(new ByteArrayContent(Convert.FromBase64String(TinyPng)), "file", "photo.png");
            using var upload = new HttpRequestMessage(HttpMethod.Post, "/api/places/http-photo-place/photo/upload") { Content = form };
            upload.Headers.TryAddWithoutValidation("X-CSRF-TOKEN", csrf);
            using var uploaded = await client.SendAsync(upload);
            uploaded.EnsureSuccessStatusCode();
            var uploadedResult = JsonSerializer.Deserialize<PhotoOperationResult>(await uploaded.Content.ReadAsStringAsync(), JsonOptions)!;
            Assert.True(uploadedResult.Success);
            Assert.NotNull(uploadedResult.Photo);

            using var image = await client.GetAsync(uploadedResult.Photo!.Url);
            image.EnsureSuccessStatusCode();
            Assert.True(image.Headers.CacheControl?.Private);
            Assert.True(image.Headers.CacheControl?.NoStore);
            Assert.NotEmpty(await image.Content.ReadAsByteArrayAsync());

            var current = JsonSerializer.Deserialize<TripSnapshot>(await (await client.GetAsync("/api/trip")).Content.ReadAsStringAsync(), JsonOptions)!;
            current.Places.Single(x => x.Id == "http-photo-place").Name = "Renamed HTTP photo place";
            using var preserve = new HttpRequestMessage(HttpMethod.Put, "/api/trip") { Content = JsonContent.Create(current) };
            preserve.Headers.TryAddWithoutValidation("X-CSRF-TOKEN", csrf);
            preserve.Headers.TryAddWithoutValidation("If-Match", current.Version.ToString());
            using var preserved = await client.SendAsync(preserve);
            preserved.EnsureSuccessStatusCode();
            var canonical = JsonSerializer.Deserialize<TripSnapshot>(await preserved.Content.ReadAsStringAsync(), JsonOptions)!;
            Assert.Equal(uploadedResult.Photo.Id, canonical.Places.Single(x => x.Id == "http-photo-place").Photo!.Id);
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", previousConnection);
            Environment.SetEnvironmentVariable("Auth__AllowLocalDev", previousLocal);
            Environment.SetEnvironmentVariable("Auth__Google__ClientId", previousClientId);
            Environment.SetEnvironmentVariable("Auth__Google__ClientSecret", previousClientSecret);
            Environment.SetEnvironmentVariable("Auth__AllowedEmails__0", previousAllowed);
        }
    }

    [Fact]
    public async Task Concurrent_postgres_photo_imports_allow_exactly_one_version_to_win()
    {
        if (!HasDatabase()) return;
        await using var setup = CreateDb();
        var seed = CreateService(setup, "photo-race-owner");
        var initial = await seed.GetSnapshotAsync();
        initial.Places.Add(new Place { Id = "photo-race-place", Name = "Photo race", City = "Tokyo", Latitude = 35.68, Longitude = 139.7 });
        var saved = Assert.IsType<ReplaceResult.Success>(await seed.ReplaceAsync(initial, initial.Version));
        var store = new HttpPhotoStore();
        await using var db1 = CreateDb();
        await using var db2 = CreateDb();
        var downloader = new PhotoDownloader(new StaticPhotoHttpClientFactory());
        var service1 = new TripService(db1, PhotoOwner("photo-race-owner"), new PhotoImportService(db1, downloader, store));
        var service2 = new TripService(db2, PhotoOwner("photo-race-owner"), new PhotoImportService(db2, downloader, store));
        var left = new TripItemEditor(service1).EditAsync("places", "update", "photo-race-place",
            System.Text.Json.Nodes.JsonNode.Parse("""{"photo":{"url":"https://images.example.test/one.png"}}""")!.AsObject(), saved.Snapshot.Version);
        var right = new TripItemEditor(service2).EditAsync("places", "update", "photo-race-place",
            System.Text.Json.Nodes.JsonNode.Parse("""{"photo":{"url":"https://images.example.test/two.png"}}""")!.AsObject(), saved.Snapshot.Version);
        var results = await Task.WhenAll(left, right);
        Assert.Equal(1, results.Count(x => x.Success));
        Assert.Equal(1, results.Count(x => x.Error == "version_conflict"));
        await using var verify = CreateDb();
        Assert.Single(verify.PlacePhotos.Where(x => x.OwnerId == "photo-race-owner"));
        Assert.Equal(saved.Snapshot.Version + 1, (await CreateService(verify, "photo-race-owner").GetSnapshotAsync()).Version);
    }

    private static async Task CompleteGoogleLoginAsync(HttpClient client, string returnPath)
    {
        using var login = await client.GetAsync($"/auth/login?returnUrl={Uri.EscapeDataString(returnPath)}");
        Assert.Equal(HttpStatusCode.Redirect, login.StatusCode);
        var authorization = Assert.IsType<Uri>(login.Headers.Location);
        var state = QueryHelpers.ParseQuery(authorization.Query)["state"].ToString();
        Assert.False(string.IsNullOrWhiteSpace(state));

        using var googleCallback = await client.GetAsync($"/signin-google?code=test-code&state={Uri.EscapeDataString(state)}");
        Assert.Equal(HttpStatusCode.Redirect, googleCallback.StatusCode);
        var callback = Assert.IsType<Uri>(googleCallback.Headers.Location);
        using var completed = await client.GetAsync(callback.OriginalString);
        Assert.Equal(HttpStatusCode.Redirect, completed.StatusCode);
        Assert.Equal(returnPath, Assert.IsType<Uri>(completed.Headers.Location).OriginalString);
    }

    private static OwnerAccessor PhotoOwner(string owner)
    {
        var context = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", owner)], "test")) };
        return new OwnerAccessor(new FixedHttpContextAccessor(context), new ConfigurationBuilder().Build());
    }

    private sealed class StaticPhotoHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new StaticPhotoHandler());
        private sealed class StaticPhotoHandler : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            {
                var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Convert.FromBase64String(TinyPng)) };
                response.Content.Headers.ContentType = new("image/png");
                return Task.FromResult(response);
            }
        }
    }

    private const string TinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    private static PlacePhotoService CreatePhotoService(TripDbContext db, TripService service, string owner, HttpPhotoStore store)
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = IPAddress.Loopback } };
        context.Request.Host = new HostString("localhost");
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", owner)], "test"));
        var accessor = new OwnerAccessor(new FixedHttpContextAccessor(context), new ConfigurationBuilder().AddInMemoryCollection().Build());
        return new PlacePhotoService(db, accessor, service, store, NullLogger<PlacePhotoService>.Instance);
    }

    private sealed class EmptyHttpClientFactory : IHttpClientFactory { public HttpClient CreateClient(string name) => new(); }

    private sealed class HttpPhotoStore : IPhotoObjectStore
    {
        private readonly ConcurrentDictionary<string, byte[]> objects = new();
        public async Task PutAsync(string key, Stream content, string type, long length, CancellationToken ct) { await using var buffer = new MemoryStream(); await content.CopyToAsync(buffer, ct); objects[key] = buffer.ToArray(); }
        public Task<PhotoObject?> GetAsync(string key, CancellationToken ct) => Task.FromResult(objects.TryGetValue(key, out var bytes) ? new PhotoObject(new MemoryStream(bytes), "image/jpeg", bytes.Length) : null);
        public Task DeleteAsync(string key, CancellationToken ct) { objects.TryRemove(key, out _); return Task.CompletedTask; }
    }

    private static string Base64UrlEncode(byte[] bytes)
        => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private bool HasDatabase() => !string.IsNullOrWhiteSpace(connection);

    private TripDbContext CreateDb() => new(new DbContextOptionsBuilder<TripDbContext>().UseNpgsql(connection!).Options);

    [Fact]
    public async Task Google_coordinates_expire_refresh_and_stay_out_of_the_trip_document_in_postgres()
    {
        if (!HasDatabase()) return;
        using var handler = new PlacesBackchannelHandler();
        using var http = new HttpClient(handler);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["GoogleMaps:ApiKey"] = "test-key" }).Build();
        var placesClient = new GooglePlacesClient(http, configuration);
        await using var db = CreateDb();
        var service = CreateService(db, "maps-owner", placesClient);
        var snapshot = await service.GetSnapshotAsync();
        snapshot.Places.Add(new Place
        {
            Id = "nakiryu", Name = "Nakiryu", City = "Tokyo",
            GoogleMapsUrl = "google.com/maps/search/?api=1&query=Nakiryu%20Minamiotsuka%20Japan"
        });
        var saved = Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(snapshot, snapshot.Version));
        Assert.Equal(35.7286762, Assert.Single(saved.Snapshot.Places).Latitude);
        Assert.Single(handler.Queries);
        var stored = await db.GooglePlaceLocations.SingleAsync();
        stored.ExpiresAt = DateTimeOffset.UtcNow.AddDays(-1);
        await db.SaveChangesAsync();
        await GoogleLocationCleanupWorker.PruneAsync(db);
        db.ChangeTracker.Clear();
        Assert.Null((await db.GooglePlaceLocations.SingleAsync()).Latitude);
        Assert.DoesNotContain("35.7286762", (await db.Trips.SingleAsync()).Json);

        await using var readerDb = CreateDb();
        var reader = CreateService(readerDb, "maps-owner", placesClient);
        var refreshed = await reader.GetSnapshotAsync();
        Assert.Equal(35.7286762, Assert.Single(refreshed.Places).Latitude);
        Assert.Equal(2, handler.Queries.Count);
        Assert.Equal(saved.Snapshot.Version, refreshed.Version);
        var edited = Clone(refreshed);
        edited.Tasks.Add(new TripTask { Id = "check", Title = "Check hours" });
        Assert.IsType<ReplaceResult.Success>(await reader.ReplaceAsync(edited, edited.Version));
        readerDb.ChangeTracker.Clear();
        Assert.DoesNotContain("35.7286762", (await readerDb.Trips.SingleAsync()).Json);
        Assert.True((await readerDb.GooglePlaceLocations.SingleAsync()).ExpiresAt > DateTimeOffset.UtcNow.AddDays(28));

        var cached = await readerDb.GooglePlaceLocations.SingleAsync();
        cached.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
        cached.RefreshAfter = DateTimeOffset.MinValue;
        await readerDb.SaveChangesAsync();
        handler.Fail = true;
        Assert.Null(Assert.Single((await reader.GetSnapshotAsync()).Places).Latitude);
        Assert.Null(Assert.Single((await reader.GetSnapshotAsync()).Places).Latitude);
        Assert.Equal(3, handler.Queries.Count);
    }

    private sealed class PlacesBackchannelHandler : HttpMessageHandler
    {
        public List<string> Queries { get; } = [];
        public bool Fail { get; set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Assert.Equal("https://places.googleapis.com/v1/places:searchText", request.RequestUri!.AbsoluteUri);
            using var json = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct));
            Queries.Add(json.RootElement.GetProperty("textQuery").GetString()!);
            return new HttpResponseMessage(Fail ? HttpStatusCode.TooManyRequests : HttpStatusCode.OK)
            {
                Content = new StringContent("""{"places":[{"id":"nakiryu-google-id","location":{"latitude":35.7286762,"longitude":139.7303427}}]}""", Encoding.UTF8, "application/json")
            };
        }
    }

    private static TripService CreateService(TripDbContext db, string owner, GooglePlacesClient? places = null)
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = IPAddress.Loopback } };
        context.Request.Host = new HostString("localhost");
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", owner)], "test"));
        return new TripService(db, new OwnerAccessor(new FixedHttpContextAccessor(context), new ConfigurationBuilder().AddInMemoryCollection().Build()),
            coordinates: places is null ? null : new GoogleMapsCoordinates(new HttpClient(), places), placesClient: places);
    }

    private static TripSnapshot Clone(TripSnapshot snapshot) => JsonSerializer.Deserialize<TripSnapshot>(JsonSerializer.Serialize(snapshot, JsonOptions), JsonOptions)!;

    private sealed class GoogleBackchannelHandler(string email, bool verified) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.AbsolutePath;
            if (path == "/token")
                return Task.FromResult(JsonResponse("{\"access_token\":\"test-access-token\",\"token_type\":\"Bearer\",\"expires_in\":3600}"));
            if (path == "/userinfo")
                return Task.FromResult(JsonResponse($"{{\"sub\":\"google-user\",\"id\":\"google-user\",\"name\":\"Test Owner\",\"email\":\"{email}\",\"email_verified\":{verified.ToString().ToLowerInvariant()}}}"));
            throw new InvalidOperationException($"Unexpected Google backchannel request: {request.Method} {request.RequestUri}");
        }

        private static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
    }

    [Fact]
    public async Task Chatgpt_oauth_authorization_code_and_refresh_token_accept_the_canonical_resource()
    {
        if (!HasDatabase()) return;
        var previousConnection = Environment.GetEnvironmentVariable("ConnectionStrings__tripdb");
        var previousPublicUrl = Environment.GetEnvironmentVariable("Auth__PublicUrl");
        var previousClientId = Environment.GetEnvironmentVariable("Auth__OAuth__ClientId");
        var previousRedirect = Environment.GetEnvironmentVariable("Auth__OAuth__RedirectUris__0");
        var previousGoogleClientId = Environment.GetEnvironmentVariable("Auth__Google__ClientId");
        var previousGoogleClientSecret = Environment.GetEnvironmentVariable("Auth__Google__ClientSecret");
        var previousAllowedEmail = Environment.GetEnvironmentVariable("Auth__AllowedEmails__0");
        var previousLocalDev = Environment.GetEnvironmentVariable("Auth__AllowLocalDev");
        Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", connection);
        Environment.SetEnvironmentVariable("Auth__PublicUrl", "https://detour.example.test");
        Environment.SetEnvironmentVariable("Auth__OAuth__ClientId", "detour-chatgpt");
        Environment.SetEnvironmentVariable("Auth__OAuth__RedirectUris__0", "https://chatgpt.com/connector_platform_oauth_redirect");
        Environment.SetEnvironmentVariable("Auth__Google__ClientId", "regression-client");
        Environment.SetEnvironmentVariable("Auth__Google__ClientSecret", "regression-secret");
        Environment.SetEnvironmentVariable("Auth__AllowedEmails__0", "owner@example.test");
        Environment.SetEnvironmentVariable("Auth__AllowLocalDev", "false");
        try
        {
            using var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Development");
                builder.ConfigureTestServices(services => services.PostConfigure<GoogleOptions>(
                    GoogleDefaults.AuthenticationScheme, options =>
                    {
                        options.AuthorizationEndpoint = "https://accounts.google.test/o/oauth2/v2/auth";
                        options.TokenEndpoint = "https://oauth2.google.test/token";
                        options.UserInformationEndpoint = "https://oauth2.google.test/userinfo";
                        options.Backchannel = new HttpClient(new GoogleBackchannelHandler("owner@example.test", true));
                    }));
                builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["GoogleMaps:ApiKey"] = "test-maps-key"
                }));
                builder.ConfigureTestServices(services => services.AddHttpClient<GooglePlacesClient>()
                    .ConfigurePrimaryHttpMessageHandler(() => new PlacesBackchannelHandler()));
            });
            using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                BaseAddress = new Uri("https://localhost"),
                AllowAutoRedirect = false
            });

            await CompleteGoogleLoginAsync(client, "/connect/authorize");
            using var oauthClient = factory.CreateClient(new WebApplicationFactoryClientOptions
            {
                BaseAddress = new Uri("https://localhost"),
                AllowAutoRedirect = false,
                HandleCookies = false
            });
            const string redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
            const string resource = "https://detour.example.test/mcp";
            const string codeVerifier = "detour-chatgpt-code-verifier-012345678901234567890123456789";
            var challenge = Base64UrlEncode(System.Security.Cryptography.SHA256.HashData(Encoding.ASCII.GetBytes(codeVerifier)));
            var invalidResourceQuery = QueryHelpers.AddQueryString("/connect/authorize", new Dictionary<string, string?>
            {
                ["response_type"] = "code",
                ["client_id"] = "detour-chatgpt",
                ["redirect_uri"] = redirectUri,
                ["scope"] = "openid profile email offline_access tripadvisor_api",
                ["code_challenge"] = challenge,
                ["code_challenge_method"] = "S256",
                ["resource"] = "https://other.example.test/mcp"
            });
            using var invalidResource = await client.GetAsync(invalidResourceQuery);
            Assert.Equal(HttpStatusCode.BadRequest, invalidResource.StatusCode);
            Assert.Contains("invalid_target", await invalidResource.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);

            var query = QueryHelpers.AddQueryString("/connect/authorize", new Dictionary<string, string?>
            {
                ["response_type"] = "code",
                ["client_id"] = "detour-chatgpt",
                ["redirect_uri"] = redirectUri,
                ["scope"] = "openid profile email offline_access tripadvisor_api",
                ["code_challenge"] = challenge,
                ["code_challenge_method"] = "S256",
                ["resource"] = resource
            });
            using var authorize = await client.GetAsync(query);
            Assert.True(authorize.StatusCode == HttpStatusCode.Redirect, await authorize.Content.ReadAsStringAsync());
            var callback = Assert.IsType<Uri>(authorize.Headers.Location);
            var callbackQuery = QueryHelpers.ParseQuery(callback.Query);
            var code = callbackQuery["code"].ToString();
            Assert.False(string.IsNullOrWhiteSpace(code));
            Assert.Equal(redirectUri, $"{callback.Scheme}://{callback.Authority}{callback.AbsolutePath}");

            using var token = await oauthClient.PostAsync("/connect/token", new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["client_id"] = "detour-chatgpt",
                ["redirect_uri"] = redirectUri,
                ["code"] = code,
                ["code_verifier"] = codeVerifier,
                ["resource"] = resource
            }));
            token.EnsureSuccessStatusCode();
            var tokenJson = JsonSerializer.Deserialize<JsonElement>(await token.Content.ReadAsStringAsync(), JsonOptions);
            var accessToken = tokenJson.GetProperty("access_token").GetString();
            var refreshToken = tokenJson.GetProperty("refresh_token").GetString();
            Assert.False(string.IsNullOrWhiteSpace(accessToken));
            Assert.False(string.IsNullOrWhiteSpace(refreshToken));

            using var api = new HttpRequestMessage(HttpMethod.Get, "/api/trip");
            api.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            using var apiResponse = await oauthClient.SendAsync(api);
            apiResponse.EnsureSuccessStatusCode();
            var trip = JsonSerializer.Deserialize<TripSnapshot>(await apiResponse.Content.ReadAsStringAsync(), JsonOptions)!;
            var originalVersion = trip.Version;
            var csrf = JsonSerializer.Deserialize<JsonElement>(await (await client.GetAsync("/auth/csrf")).Content.ReadAsStringAsync(), JsonOptions).GetProperty("token").GetString();
            trip.Places.Add(new Place { Id = "http-location", Name = "Location test", City = "Tokyo" });
            using var missingLocation = new HttpRequestMessage(HttpMethod.Put, "/api/trip")
            {
                Content = new StringContent(JsonSerializer.Serialize(trip, JsonOptions), Encoding.UTF8, "application/json")
            };
            missingLocation.Headers.TryAddWithoutValidation("X-CSRF-TOKEN", csrf);
            using var missingResponse = await client.SendAsync(missingLocation);
            Assert.Equal(HttpStatusCode.BadRequest, missingResponse.StatusCode);
            Assert.Contains("requires latitude", await missingResponse.Content.ReadAsStringAsync());

            trip.Places[^1].GoogleMapsUrl = "https://www.google.com/maps/search/?api=1&query=35.68%2C139.7";
            trip.Places.Add(new Place
            {
                Id = "http-google-search", Name = "Nakiryu", City = "Tokyo",
                GoogleMapsUrl = "https://www.google.com/maps/search/?api=1&query=Nakiryu%20Minamiotsuka%20Japan"
            });
            using var located = new HttpRequestMessage(HttpMethod.Put, "/api/trip")
            {
                Content = new StringContent(JsonSerializer.Serialize(trip, JsonOptions), Encoding.UTF8, "application/json")
            };
            located.Headers.TryAddWithoutValidation("X-CSRF-TOKEN", csrf);
            using var locatedResponse = await client.SendAsync(located);
            locatedResponse.EnsureSuccessStatusCode();
            var locatedTrip = JsonSerializer.Deserialize<TripSnapshot>(await locatedResponse.Content.ReadAsStringAsync(), JsonOptions)!;
            Assert.Equal(originalVersion + 1, locatedTrip.Version);
            Assert.Equal(35.68, locatedTrip.Places.Single(p => p.Id == "http-location").Latitude);
            Assert.Equal(139.7, locatedTrip.Places.Single(p => p.Id == "http-location").Longitude);
            Assert.Equal(35.7286762, locatedTrip.Places.Single(p => p.Id == "http-google-search").Latitude);
            Assert.True(locatedTrip.Places.Single(p => p.Id == "http-google-search").CoordinatesFromGoogle);

            using var initialize = new HttpRequestMessage(HttpMethod.Post, "/mcp")
            {
                Content = new StringContent("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"detour-regression\",\"version\":\"1.0\"}}}", Encoding.UTF8, "application/json")
            };
            initialize.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            initialize.Headers.Accept.ParseAdd("application/json");
            initialize.Headers.Accept.ParseAdd("text/event-stream");
            initialize.Headers.TryAddWithoutValidation("MCP-Protocol-Version", "2025-06-18");
            using var initializeResponse = await oauthClient.SendAsync(initialize);
            initializeResponse.EnsureSuccessStatusCode();
            Assert.True(initializeResponse.Headers.TryGetValues("Mcp-Session-Id", out var sessionValues));
            var sessionId = Assert.Single(sessionValues!);

            using var toolsList = new HttpRequestMessage(HttpMethod.Post, "/mcp")
            {
                Content = new StringContent("{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{}}", Encoding.UTF8, "application/json")
            };
            toolsList.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", accessToken);
            toolsList.Headers.TryAddWithoutValidation("Mcp-Session-Id", sessionId);
            toolsList.Headers.Accept.ParseAdd("application/json");
            toolsList.Headers.Accept.ParseAdd("text/event-stream");
            toolsList.Headers.TryAddWithoutValidation("MCP-Protocol-Version", "2025-06-18");
            using var toolsListResponse = await oauthClient.SendAsync(toolsList);
            toolsListResponse.EnsureSuccessStatusCode();
            var toolsListBody = await toolsListResponse.Content.ReadAsStringAsync();
            Assert.True(toolsListBody.Contains("GetTrip", StringComparison.Ordinal) || toolsListBody.Contains("get_trip", StringComparison.Ordinal));
            Assert.Contains("map location", toolsListBody);
            Assert.Contains("Google Places Text Search", toolsListBody);
            Assert.Contains("changes.photo imports", toolsListBody);

            using var refresh = await oauthClient.PostAsync("/connect/token", new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["client_id"] = "detour-chatgpt",
                ["refresh_token"] = refreshToken!,
                ["resource"] = resource
            }));
            refresh.EnsureSuccessStatusCode();
            var refreshedJson = JsonSerializer.Deserialize<JsonElement>(await refresh.Content.ReadAsStringAsync(), JsonOptions);
            Assert.False(string.IsNullOrWhiteSpace(refreshedJson.GetProperty("access_token").GetString()));
            var refreshedRefreshToken = refreshedJson.TryGetProperty("refresh_token", out var nextRefreshToken)
                ? nextRefreshToken.GetString()
                : refreshToken;

            using var wrongResource = await oauthClient.PostAsync("/connect/token", new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "refresh_token",
                ["client_id"] = "detour-chatgpt",
                ["refresh_token"] = refreshedRefreshToken!,
                ["resource"] = "https://other.example.test/mcp"
            }));
            Assert.Equal(HttpStatusCode.BadRequest, wrongResource.StatusCode);
            Assert.Contains("invalid_target", await wrongResource.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Environment.SetEnvironmentVariable("ConnectionStrings__tripdb", previousConnection);
            Environment.SetEnvironmentVariable("Auth__PublicUrl", previousPublicUrl);
            Environment.SetEnvironmentVariable("Auth__OAuth__ClientId", previousClientId);
            Environment.SetEnvironmentVariable("Auth__OAuth__RedirectUris__0", previousRedirect);
            Environment.SetEnvironmentVariable("Auth__Google__ClientId", previousGoogleClientId);
            Environment.SetEnvironmentVariable("Auth__Google__ClientSecret", previousGoogleClientSecret);
            Environment.SetEnvironmentVariable("Auth__AllowedEmails__0", previousAllowedEmail);
            Environment.SetEnvironmentVariable("Auth__AllowLocalDev", previousLocalDev);
        }
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private sealed class FixedHttpContextAccessor(HttpContext context) : IHttpContextAccessor
    {
        public HttpContext? HttpContext { get; set; } = context;
    }

}
