using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;
using Detour.Api;

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
        var seedPath = FindSeed();

        await service.SeedAsync(seedPath, "seed-owner");
        await using var secondDb = CreateDb();
        var reloaded = await CreateService(secondDb, "seed-owner").GetSnapshotAsync();

        Assert.Equal(0, reloaded.Version);
        Assert.Equal(89, reloaded.Places.Count);
        Assert.Equal(11, reloaded.Stays.Count);
        Assert.Equal(12, reloaded.TravelLegs.Count);
        Assert.Equal(2, reloaded.Activities.Count);
        Assert.Equal(6, reloaded.Bookings.Count);
        Assert.Equal("Asia/Tokyo", reloaded.Trip.TimeZone);
        var flight = Assert.Single(reloaded.Bookings, x => x.Title.StartsWith("QR160", StringComparison.Ordinal));
        Assert.Equal(TimeSpan.FromHours(2), flight.Start!.Value.Offset);
        Assert.Equal("HND", reloaded.Trip.Arrival?.Airport);
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
        var left = Clone(initial); left.Places.Add(new Place { Id = "race-left", Name = "Left", City = "Tokyo" });
        var right = Clone(initial); right.Places.Add(new Place { Id = "race-right", Name = "Right", City = "Tokyo" });

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
    public async Task Different_authenticated_owners_are_isolated_in_postgres()
    {
        if (!HasDatabase()) return;
        await using var dbA = CreateDb();
        await using var dbB = CreateDb();
        var a = CreateService(dbA, "owner-a");
        var b = CreateService(dbB, "owner-b");
        var snapshot = await a.GetSnapshotAsync();
        snapshot.Places.Add(new Place { Id = "private-a", Name = "Private", City = "Tokyo" });
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
            new PlaceChanges { Name = "MCP Place", City = "Tokyo", SourceUrl = "https://example.test/reel" });
        Assert.True(second.Success);
        Assert.Equal(2, second.Version);
        Assert.True((await tools.EditPlace(EditOperation.create, "mcp-place-2", 2,
            new PlaceChanges { Name = "Second Reel Place", City = "Tokyo", SourceUrl = "https://example.test/reel" })).Success);
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

    private bool HasDatabase() => !string.IsNullOrWhiteSpace(connection);

    private TripDbContext CreateDb() => new(new DbContextOptionsBuilder<TripDbContext>().UseNpgsql(connection!).Options);

    private static TripService CreateService(TripDbContext db, string owner)
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = IPAddress.Loopback } };
        context.Request.Host = new HostString("localhost");
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", owner)], "test"));
        return new TripService(db, new OwnerAccessor(new FixedHttpContextAccessor(context), new ConfigurationBuilder().AddInMemoryCollection().Build()));
    }

    private static TripSnapshot Clone(TripSnapshot snapshot) => JsonSerializer.Deserialize<TripSnapshot>(JsonSerializer.Serialize(snapshot, JsonOptions), JsonOptions)!;

    private static string FindSeed()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "data", "japan-2026.seed.json");
            if (File.Exists(candidate)) return candidate;
            current = current.Parent;
        }
        throw new FileNotFoundException("Real Japan seed not found.");
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private sealed class FixedHttpContextAccessor(HttpContext context) : IHttpContextAccessor
    {
        public HttpContext? HttpContext { get; set; } = context;
    }

}
