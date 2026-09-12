using System.Net;
using System.Text.Json;
using Detour.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Detour.Api.Tests;

public sealed class PlaceLocationTests
{
    [Fact]
    public async Task Rejects_a_new_place_without_coordinates_without_advancing_version()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var initial = await service.GetSnapshotAsync();
        initial.Places.Add(new Place { Id = "missing-location", Name = "Missing location", City = "Tokyo" });

        var result = await service.ReplaceAsync(initial, initial.Version);

        var invalid = Assert.IsType<ReplaceResult.Invalid>(result);
        Assert.Contains("requires latitude", invalid.Message ?? "");
        var current = await service.GetSnapshotAsync();
        Assert.Equal(1, current.Version);
        Assert.Empty(current.Places);
    }

    [Fact]
    public async Task Mcp_place_create_resolves_and_persists_coordinates_from_a_short_maps_link()
    {
        await using var db = CreateDb();
        using var handler = new RedirectHandler("https://www.google.com/maps/search/?api=1&query=35.681236%2C139.767125");
        using var client = new HttpClient(handler);
        var service = CreateService(db, new GoogleMapsCoordinates(client));
        var tools = new TripMcpTools(service, new TripItemEditor(service));

        var result = await tools.EditPlace(EditOperation.create, "resolved-place", 1,
            new PlaceChanges
            {
                Name = "Tokyo Station",
                City = "Tokyo",
                SourceUrl = "https://example.test/source",
                GoogleMapsUrl = "https://maps.app.goo.gl/tokyo-station"
            });

        Assert.True(result.Success, result.Message);
        Assert.Equal(2, result.Version);
        var place = Assert.Single((await service.GetSnapshotAsync()).Places);
        Assert.Equal(35.681236, place.Latitude);
        Assert.Equal(139.767125, place.Longitude);
        Assert.Equal(1, handler.RequestCount);
    }

    [Fact]
    public async Task Legacy_unlocated_place_does_not_block_an_unrelated_task_edit()
    {
        await using var db = CreateDb();
        var snapshot = new TripSnapshot
        {
            Version = 7,
            Places = [new Place { Id = "legacy-place", Name = "Legacy place", City = "Tokyo" }],
            Tasks = [new TripTask { Id = "task-1", Title = "Review itinerary", Notes = "old notes" }]
        };
        await db.Trips.AddAsync(new TripDocumentRow
        {
            Id = Guid.NewGuid(),
            OwnerId = "local-dev",
            Version = snapshot.Version,
            Json = JsonSerializer.Serialize(snapshot, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            UpdatedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
        var service = CreateService(db);
        var tools = new TripMcpTools(service, new TripItemEditor(service));

        var result = await tools.EditTask(EditOperation.update, "task-1", 7,
            new TripTaskChanges { Notes = "updated notes" });

        Assert.True(result.Success, result.Message);
        Assert.Equal(8, result.Version);
        var current = await service.GetSnapshotAsync();
        Assert.Null(Assert.Single(current.Places).Latitude);
        Assert.Equal("updated notes", Assert.Single(current.Tasks).Notes);
    }

    [Fact]
    public async Task Rejects_clearing_valid_coordinates_when_the_place_has_no_resolvable_map_url()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var initial = await service.GetSnapshotAsync();
        initial.Places.Add(new Place
        {
            Id = "located-place",
            Name = "Located place",
            City = "Tokyo",
            Latitude = 35.681236,
            Longitude = 139.767125
        });
        Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(initial, initial.Version));

        var result = await tools.EditPlace(EditOperation.update, "located-place", 2, clearFields: ["latitude", "longitude"]);

        Assert.False(result.Success);
        Assert.Equal(2, result.Version);
        Assert.Contains("requires latitude", result.Message ?? "");
        var current = await service.GetSnapshotAsync();
        var place = Assert.Single(current.Places);
        Assert.Equal(35.681236, place.Latitude);
        Assert.Equal(139.767125, place.Longitude);
    }

    [Fact]
    public async Task Refreshes_coordinates_when_a_place_map_url_changes()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var initial = await service.GetSnapshotAsync();
        initial.Places.Add(new Place
        {
            Id = "moving-place",
            Name = "Moving place",
            City = "Tokyo",
            GoogleMapsUrl = "https://www.google.com/maps/search/?api=1&query=35%2C139",
            Latitude = 35,
            Longitude = 139
        });
        Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(initial, initial.Version));

        var result = await tools.EditPlace(EditOperation.update, "moving-place", 2,
            new PlaceChanges { GoogleMapsUrl = "https://www.google.com/maps/search/?api=1&query=36%2C140" });

        Assert.True(result.Success, result.Message);
        Assert.Equal(3, result.Version);
        var place = Assert.Single((await service.GetSnapshotAsync()).Places);
        Assert.Equal(36, place.Latitude);
        Assert.Equal(140, place.Longitude);
    }

    private static TripDbContext CreateDb() => new(new DbContextOptionsBuilder<TripDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static TripService CreateService(TripDbContext db, GoogleMapsCoordinates? coordinates = null)
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = System.Net.IPAddress.Loopback } };
        context.Request.Host = new HostString("localhost");
        var http = new HttpContextAccessor { HttpContext = context };
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Auth:AllowLocalDev"] = "true" })
            .Build();
        return new TripService(db, new OwnerAccessor(http, configuration), coordinates: coordinates);
    }

    private sealed class RedirectHandler(string destination) : HttpMessageHandler
    {
        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Found)
            {
                Headers = { Location = new Uri(destination) }
            });
        }
    }
}
