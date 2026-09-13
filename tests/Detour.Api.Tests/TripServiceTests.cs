using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Configuration;
using System.Text.Json;
using Detour.Api;

namespace Detour.Api.Tests;

public sealed class TripServiceTests
{
    [Fact]
    public async Task Creates_personal_trip_with_real_trip_dates()
    {
        await using var db = CreateDb();
        var service = CreateService(db);

        var snapshot = await service.GetSnapshotAsync();

        Assert.Equal("Japan 2026", snapshot.Trip.Name);
        Assert.Equal(new DateOnly(2026, 9, 30), snapshot.Trip.StartDate);
        Assert.Equal(new DateOnly(2026, 10, 25), snapshot.Trip.EndDate);
        Assert.Equal(1, snapshot.Version);
    }

    [Fact]
    public async Task Rejects_stale_replace_and_returns_current_snapshot()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var initial = await service.GetSnapshotAsync();
        var staleVersion = initial.Version;
        initial.Places.Add(new Place { Name = "Senso-ji", City = "Tokyo", Latitude = 35.68, Longitude = 139.7, SourceUrl = "https://example.test/senso" });
        var saved = await service.ReplaceAsync(initial, initial.Version);
        var success = Assert.IsType<ReplaceResult.Success>(saved);

        var stale = await service.ReplaceAsync(new TripSnapshot { Trip = new() }, staleVersion);

        var conflict = Assert.IsType<ReplaceResult.Conflict>(stale);
        Assert.Equal(success.Snapshot.Version, conflict.Snapshot.Version);
        Assert.Single(conflict.Snapshot.Places);
    }

    [Fact]
    public async Task Invalid_stay_dates_are_rejected_without_advancing_version()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var initial = await service.GetSnapshotAsync();
        initial.Stays.Add(new Stay { City = "Kyoto", CheckIn = new(2026, 10, 10), CheckOut = new(2026, 10, 9) });

        var result = await service.ReplaceAsync(initial, initial.Version);

        Assert.IsType<ReplaceResult.Invalid>(result);
        Assert.Equal(initial.Version, (await service.GetSnapshotAsync()).Version);
        Assert.Empty((await service.GetSnapshotAsync()).Stays);
    }

    public static TheoryData<string> InvalidStayCities => new()
    {
        "Osaka / Kyoto",
        @"Osaka \ Kyoto",
        "Osaka; Kyoto",
        "Osaka & Kyoto",
        "Osaka + Kyoto",
        "Osaka and Kyoto",
        "Osaka OR Kyoto",
        "Other",
        "unknown city"
    };

    [Theory]
    [MemberData(nameof(InvalidStayCities))]
    public async Task New_stays_reject_combined_or_placeholder_cities_even_with_matching_coordinates(string city)
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var initial = await service.GetSnapshotAsync();
        initial.Places.Add(new Place { Name = "Mapped hotel", City = city, Latitude = 35.0, Longitude = 136.0 });
        initial.Stays.Add(new Stay
        {
            City = city,
            CheckIn = new(2026, 10, 9),
            CheckOut = new(2026, 10, 10)
        });

        var result = Assert.IsType<ReplaceResult.Invalid>(await service.ReplaceAsync(initial, initial.Version));

        Assert.Contains("must name one map city or city area", result.Message);
        Assert.Empty((await service.GetSnapshotAsync()).Stays);
    }

    [Fact]
    public async Task Unknown_city_area_is_accepted_when_a_matching_place_has_coordinates()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var initial = await service.GetSnapshotAsync();
        initial.Places.Add(new Place { Name = "Mapped hotel", City = "Lake Kawaguchi", Latitude = 35.5, Longitude = 138.76 });
        initial.Stays.Add(new Stay
        {
            City = "  Lake Kawaguchi  ",
            CheckIn = new(2026, 10, 9),
            CheckOut = new(2026, 10, 10)
        });

        var saved = Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(initial, initial.Version));

        Assert.Equal("Lake Kawaguchi", Assert.Single(saved.Snapshot.Stays).City);
    }

    [Fact]
    public async Task Unknown_city_without_a_matching_mapped_place_is_rejected()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var initial = await service.GetSnapshotAsync();
        initial.Stays.Add(new Stay
        {
            City = "Takayama",
            CheckIn = new(2026, 10, 9),
            CheckOut = new(2026, 10, 10)
        });

        var result = Assert.IsType<ReplaceResult.Invalid>(await service.ReplaceAsync(initial, initial.Version));

        Assert.Contains("add a saved place in that city with valid coordinates", result.Message);
        Assert.Empty((await service.GetSnapshotAsync()).Stays);
    }

    [Fact]
    public async Task Unchanged_legacy_unresolved_stay_does_not_block_unrelated_edits()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var initial = await service.GetSnapshotAsync();
        initial.Stays.Add(new Stay
        {
            Id = "legacy-stay",
            City = "Osaka / Kyoto",
            CheckIn = new(2026, 10, 9),
            CheckOut = new(2026, 10, 10)
        });
        db.Trips.Single().Json = JsonSerializer.Serialize(initial, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await db.SaveChangesAsync();
        var legacy = await service.GetSnapshotAsync();
        legacy.Tasks.Add(new TripTask { Id = "task-1", Title = "Keep planning", Scope = "before" });

        var saved = Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(legacy, legacy.Version));

        Assert.Equal("Osaka / Kyoto", Assert.Single(saved.Snapshot.Stays).City);
        Assert.Single(saved.Snapshot.Tasks);
    }

    [Fact]
    public async Task Removing_the_last_mapped_place_for_an_existing_stay_is_rejected()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var initial = await service.GetSnapshotAsync();
        initial.Places.Add(new Place { Id = "takayama-map", Name = "Mapped hotel", City = "Takayama", Latitude = 36.14, Longitude = 137.25 });
        initial.Stays.Add(new Stay
        {
            Id = "takayama-stay",
            City = "Takayama",
            CheckIn = new(2026, 10, 9),
            CheckOut = new(2026, 10, 10)
        });
        var seeded = Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(initial, initial.Version));
        seeded.Snapshot.Places.Clear();

        var result = Assert.IsType<ReplaceResult.Invalid>(await service.ReplaceAsync(seeded.Snapshot, seeded.Snapshot.Version));

        Assert.Contains("would lose its map location", result.Message);
        Assert.Single((await service.GetSnapshotAsync()).Places);
    }

    [Fact]
    public async Task Save_place_updates_by_id_and_allows_multiple_places_from_one_source()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var initial = await service.GetSnapshotAsync();
        var original = new Place { Name = "Old", City = "Tokyo", Latitude = 35.68, Longitude = 139.7, SourceUrl = "https://example.test/place" };
        initial.Places.Add(original);
        await service.ReplaceAsync(initial, initial.Version);

        var updated = await service.SavePlaceAsync(new Place { Id = original.Id, Name = "New", City = "Tokyo", Latitude = 35.68, Longitude = 139.7, SourceUrl = "https://example.test/place", Description = "updated" }, 2);

        Assert.IsType<ReplaceResult.Success>(updated);
        var current = await service.GetSnapshotAsync();
        var place = Assert.Single(current.Places);
        Assert.Equal("New", place.Name);
        Assert.Equal("updated", place.Description);

        var second = await service.SavePlaceAsync(new Place { Name = "Another", City = "Tokyo", Latitude = 35.68, Longitude = 139.7, SourceUrl = "https://example.test/place" }, current.Version);
        Assert.IsType<ReplaceResult.Success>(second);
        Assert.Equal(2, (await service.GetSnapshotAsync()).Places.Count);
    }

    [Fact]
    public async Task Rejects_invalid_external_url_and_coordinates()
    {
        await using var db = CreateDb();
        var service = CreateService(db);
        var initial = await service.GetSnapshotAsync();
        initial.Places.Add(new Place { Name = "Bad", City = "Tokyo", SourceUrl = "javascript:alert(1)", Latitude = 120 });

        Assert.IsType<ReplaceResult.Invalid>(await service.ReplaceAsync(initial, initial.Version));
        Assert.Empty((await service.GetSnapshotAsync()).Places);
    }

    [Fact]
    public void Development_fallback_does_not_authenticate_remote_host_through_proxy()
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = System.Net.IPAddress.Loopback } };
        context.Request.Host = new HostString("192.168.1.50");
        var accessor = new OwnerAccessor(new HttpContextAccessor { HttpContext = context }, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Auth:AllowLocalDev"] = "true" }).Build());

        Assert.Throws<UnauthorizedAccessException>(() => _ = accessor.OwnerId);
    }

    [Fact]
    public void Development_fallback_rejects_unknown_peer_address()
    {
        var context = new DefaultHttpContext();
        context.Request.Host = new HostString("localhost");
        var accessor = new OwnerAccessor(new HttpContextAccessor { HttpContext = context }, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Auth:AllowLocalDev"] = "true" }).Build());

        Assert.Throws<UnauthorizedAccessException>(() => _ = accessor.OwnerId);
    }

    private static TripDbContext CreateDb()
    {
        var options = new DbContextOptionsBuilder<TripDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new TripDbContext(options);
    }

    private static TripService CreateService(TripDbContext db)
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = System.Net.IPAddress.Loopback } };
        context.Request.Host = new HostString("localhost");
        var http = new HttpContextAccessor { HttpContext = context };
        return new TripService(db, new OwnerAccessor(http, new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Auth:AllowLocalDev"] = "true" }).Build()));
    }

}
