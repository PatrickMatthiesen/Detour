using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Detour.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Detour.Api.Tests;

public sealed class GooglePlacePersistenceTests
{
    private const string SearchUrl = "https://www.google.com/maps/search/?api=1&query=Nakiryu%2C%20Tokyo%2C%20Japan";
    private const string DirectUrl = "https://www.google.com/maps/search/?api=1&query=35.681236%2C139.767125";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    [Fact]
    public async Task Place_id_resolves_caches_and_refreshes_same_identity()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("nakiryu", 35.7, 139.7);
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var result = await tools.EditPlace(EditOperation.create, "one", 1,
            new PlaceChanges { Name = "Nakiryu", City = "Tokyo", GooglePlaceId = "nakiryu" });
        Assert.True(result.Success, result.Message);
        Assert.True(Assert.IsType<Place>(result.Item).CoordinatesFromGoogle);
        Assert.Equal("nakiryu", Assert.Single(handler.DetailIds));
        Assert.Empty(handler.Queries);
        var cache = Assert.Single(db.GooglePlaceLocations);
        Assert.Equal("place_id:nakiryu", cache.Query);
        cache.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();
        var reloaded = await service.GetSnapshotAsync();
        Assert.Equal(35.7, Assert.Single(reloaded.Places).Latitude);
        Assert.Equal(2, handler.DetailIds.Count);
        Assert.False(ReadRawPlace(db).TryGetProperty("latitude", out _));
    }

    [Fact]
    public async Task Bulk_ambiguity_returns_candidates_and_allows_retry_by_id()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("first", 35.7, 139.7,
            """{"places":[{"id":"first","displayName":{"text":"First shop"},"formattedAddress":"1 Tokyo","location":{"latitude":35.7,"longitude":139.7}},{"id":"second","displayName":{"text":"Second shop"},"formattedAddress":"2 Tokyo","location":{"latitude":35.8,"longitude":139.8}}]}""");
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var result = await tools.EditPlaces(1,
            [new(EditOperation.create, "ambiguous", new PlaceChanges { Name = "Shop", City = "Tokyo", GoogleMapsUrl = SearchUrl }),
             new(EditOperation.create, "valid", new PlaceChanges { Name = "Valid", City = "Tokyo", Latitude = 35, Longitude = 139 })],
            BulkEditMode.best_effort);
        Assert.True(result.Committed);
        Assert.Equal(2, result.Version);
        var failure = result.Results[0].Error!;
        Assert.Equal("ambiguous_location", failure.Code);
        Assert.Equal(new LocationCandidate("first", "First shop", "1 Tokyo", 35.7, 139.7), failure.Candidates![0]);
        Assert.Single((await service.GetSnapshotAsync()).Places);
        Assert.Empty(db.GooglePlaceLocations);
        var retry = await tools.EditPlaces(result.Version,
            [new(EditOperation.create, "ambiguous", new PlaceChanges { Name = "Shop", City = "Tokyo", GooglePlaceId = failure.Candidates[0].PlaceId })]);
        Assert.True(retry.Success);
        Assert.Equal(2, (await service.GetSnapshotAsync()).Places.Count);
        Assert.Single(db.GooglePlaceLocations);
    }

    [Fact]
    public async Task Name_only_mcp_create_uses_the_decoded_query_caches_and_reloads_coordinates()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7286762, 139.7303427);
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));

        var result = await tools.EditPlace(EditOperation.create, "nakiryu", 1,
            new PlaceChanges { Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl });

        Assert.True(result.Success, result.Message);
        Assert.Equal(["Nakiryu, Tokyo, Japan"], handler.Queries);
        var created = Assert.IsType<Place>(result.Item);
        Assert.True(created.CoordinatesFromGoogle);
        Assert.Equal(35.7286762, created.Latitude);
        Assert.Equal(139.7303427, created.Longitude);
        var cached = Assert.Single(db.GooglePlaceLocations);
        Assert.Equal("owner-a", cached.OwnerId);
        Assert.Equal("nakiryu", cached.PlaceId);
        Assert.Equal(SearchUrl, cached.MapsUrl);
        Assert.Equal("Nakiryu, Tokyo, Japan", cached.Query);
        Assert.Equal("places/nakiryu", cached.GooglePlaceId);
        Assert.Equal(35.7286762, cached.Latitude);
        Assert.Equal(139.7303427, cached.Longitude);
        Assert.InRange(cached.ExpiresAt, DateTimeOffset.UtcNow.AddDays(28), DateTimeOffset.UtcNow.AddDays(30));

        var rawPlace = ReadRawPlace(db);
        Assert.False(rawPlace.TryGetProperty("latitude", out _));
        Assert.False(rawPlace.TryGetProperty("longitude", out _));
        Assert.False(rawPlace.TryGetProperty("coordinatesFromGoogle", out _));

        var reloaded = await CreateService(db, "owner-a", handler).GetSnapshotAsync();
        var place = Assert.Single(reloaded.Places);
        Assert.True(place.CoordinatesFromGoogle);
        Assert.Equal(35.7286762, place.Latitude);
        Assert.Equal(139.7303427, place.Longitude);
    }

    [Fact]
    public async Task Scheme_less_name_url_is_normalized_before_google_places_lookup()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7286762, 139.7303427);
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));

        var result = await tools.EditPlace(EditOperation.create, "invalid-url", 1,
            new PlaceChanges { Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = "www.google.com/maps/search/?query=Nakiryu" });

        Assert.True(result.Success, result.Message);
        Assert.Equal(["Nakiryu"], handler.Queries);
        Assert.Equal(2, (await service.GetSnapshotAsync()).Version);
        Assert.Single(db.GooglePlaceLocations);
    }

    [Fact]
    public async Task Unrelated_task_and_full_json_roundtrip_keep_google_coordinates_in_cache()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7286762, 139.7303427);
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var created = await tools.EditPlace(EditOperation.create, "nakiryu", 1,
            new PlaceChanges { Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl });
        Assert.True(created.Success, created.Message);

        var read = await service.GetSnapshotAsync();
        read.Tasks.Add(new TripTask { Id = "task-1", Title = "Check route" });
        var roundTrip = JsonSerializer.Deserialize<TripSnapshot>(JsonSerializer.Serialize(read, JsonOptions), JsonOptions)!;
        var saved = await service.ReplaceAsync(roundTrip, read.Version);

        Assert.IsType<ReplaceResult.Success>(saved);
        Assert.Equal(3, (await service.GetSnapshotAsync()).Version);
        Assert.Single(db.GooglePlaceLocations);
        Assert.Single(handler.Queries);
        var rawPlace = ReadRawPlace(db);
        Assert.False(rawPlace.TryGetProperty("latitude", out _));
        Assert.False(rawPlace.TryGetProperty("coordinatesFromGoogle", out _));
    }

    [Fact]
    public async Task Explicit_mcp_coordinates_make_a_place_permanent_and_remove_the_cache()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7286762, 139.7303427);
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var created = await tools.EditPlace(EditOperation.create, "nakiryu", 1,
            new PlaceChanges { Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl });
        Assert.True(created.Success, created.Message);

        var edited = await tools.EditPlace(EditOperation.update, "nakiryu", created.Version,
            new PlaceChanges { Latitude = 35.7, Longitude = 139.8 });

        Assert.True(edited.Success, edited.Message);
        var place = Assert.Single((await service.GetSnapshotAsync()).Places);
        Assert.False(place.CoordinatesFromGoogle);
        Assert.Equal(35.7, place.Latitude);
        Assert.Equal(139.8, place.Longitude);
        Assert.Empty(db.GooglePlaceLocations);
        var rawPlace = ReadRawPlace(db);
        Assert.Equal(35.7, rawPlace.GetProperty("latitude").GetDouble());
        Assert.False(rawPlace.TryGetProperty("coordinatesFromGoogle", out _));
    }

    [Fact]
    public async Task Ambiguous_google_result_fails_without_changing_trip_or_cache()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler(
            "places/first", 35.7, 139.7,
            "{\"places\":[{\"id\":\"places/first\",\"location\":{\"latitude\":35.7,\"longitude\":139.7}},{\"id\":\"places/second\",\"location\":{\"latitude\":35.8,\"longitude\":139.8}}]}");
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));

        var result = await tools.EditPlace(EditOperation.create, "ambiguous", 1,
            new PlaceChanges { Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl });

        Assert.False(result.Success);
        Assert.Contains("multiple", result.Message ?? "", StringComparison.OrdinalIgnoreCase);
        Assert.Equal("ambiguous_location", result.Details!.Code);
        Assert.Equal(2, result.Details.Candidates!.Count);
        Assert.Equal(1, (await service.GetSnapshotAsync()).Version);
        Assert.Empty((await service.GetSnapshotAsync()).Places);
        Assert.Empty(db.GooglePlaceLocations);
    }

    [Fact]
    public async Task Stale_replace_does_not_make_a_paid_google_places_call()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7286762, 139.7303427);
        var service = CreateService(db, "owner-a", handler);
        var initial = await service.GetSnapshotAsync();
        initial.Places.Add(new Place { Id = "manual", Name = "Manual", City = "Tokyo", Latitude = 35.7, Longitude = 139.7 });
        Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(initial, initial.Version));
        var stale = new TripSnapshot
        {
            Trip = new(),
            Places = [new Place { Id = "stale", Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl }]
        };

        var result = await service.ReplaceAsync(stale, 1);

        Assert.IsType<ReplaceResult.Conflict>(result);
        Assert.Empty(handler.Queries);
        Assert.Equal(2, (await service.GetSnapshotAsync()).Version);
    }

    [Fact]
    public async Task Changing_a_cached_url_to_a_direct_coordinate_url_removes_the_cache()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7286762, 139.7303427);
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var created = await tools.EditPlace(EditOperation.create, "nakiryu", 1,
            new PlaceChanges { Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl });
        Assert.True(created.Success, created.Message);

        var updated = await tools.EditPlace(EditOperation.update, "nakiryu", created.Version,
            new PlaceChanges { GoogleMapsUrl = DirectUrl });

        Assert.True(updated.Success, updated.Message);
        var place = Assert.Single((await service.GetSnapshotAsync()).Places);
        Assert.False(place.CoordinatesFromGoogle);
        Assert.Equal(35.681236, place.Latitude);
        Assert.Equal(139.767125, place.Longitude);
        Assert.Empty(db.GooglePlaceLocations);
        Assert.Single(handler.Queries);
    }

    [Fact]
    public async Task Google_location_cache_is_isolated_between_owners()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7286762, 139.7303427);
        var ownerA = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(ownerA, new TripItemEditor(ownerA));
        var created = await tools.EditPlace(EditOperation.create, "same-id", 1,
            new PlaceChanges { Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl });
        Assert.True(created.Success, created.Message);

        var ownerB = CreateService(db, "owner-b");
        var other = await ownerB.GetSnapshotAsync();

        Assert.Empty(other.Places);
        Assert.Single(db.GooglePlaceLocations.Where(x => x.OwnerId == "owner-a"));
        Assert.Empty(db.GooglePlaceLocations.Where(x => x.OwnerId == "owner-b"));
    }

    [Fact]
    public async Task Expired_pruned_cache_survives_a_stale_snapshot_task_save_without_permanent_coordinates()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7286762, 139.7303427);
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var created = await tools.EditPlace(EditOperation.create, "nakiryu", 1,
            new PlaceChanges { Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl });
        Assert.True(created.Success, created.Message);

        var stale = await service.GetSnapshotAsync();
        Assert.True(Assert.Single(stale.Places).CoordinatesFromGoogle);
        var cached = Assert.Single(db.GooglePlaceLocations);
        cached.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();
        await GoogleLocationCleanupWorker.PruneAsync(db);
        Assert.Null(cached.Latitude);
        Assert.Null(cached.Longitude);

        stale.Tasks.Add(new TripTask { Id = "task-1", Title = "Check route" });
        var saved = await CreateService(db, "owner-a").ReplaceAsync(stale, stale.Version);

        Assert.IsType<ReplaceResult.Success>(saved);
        Assert.Equal(3, (await CreateService(db, "owner-a").GetSnapshotAsync()).Version);
        var retained = Assert.Single(db.GooglePlaceLocations);
        Assert.Null(retained.Latitude);
        Assert.Null(retained.Longitude);
        Assert.False(ReadRawPlace(db).TryGetProperty("latitude", out _));
        Assert.False(ReadRawPlace(db).TryGetProperty("coordinatesFromGoogle", out _));
    }

    [Fact]
    public async Task Stale_expired_google_coordinates_are_replaced_by_a_new_direct_url()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7286762, 139.7303427);
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var created = await tools.EditPlace(EditOperation.create, "nakiryu", 1,
            new PlaceChanges { Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl });
        Assert.True(created.Success, created.Message);

        var stale = await service.GetSnapshotAsync();
        var stalePlace = Assert.Single(stale.Places);
        Assert.True(stalePlace.CoordinatesFromGoogle);
        Assert.Equal(35.7286762, stalePlace.Latitude);
        var cached = Assert.Single(db.GooglePlaceLocations);
        cached.ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1);
        await db.SaveChangesAsync();
        await GoogleLocationCleanupWorker.PruneAsync(db);

        stalePlace.GoogleMapsUrl = DirectUrl;
        var updated = await service.ReplaceAsync(stale, stale.Version);

        Assert.IsType<ReplaceResult.Success>(updated);
        var place = Assert.Single((await service.GetSnapshotAsync()).Places);
        Assert.False(place.CoordinatesFromGoogle);
        Assert.Equal(35.681236, place.Latitude);
        Assert.Equal(139.767125, place.Longitude);
        Assert.Empty(db.GooglePlaceLocations);
        Assert.Equal(35.681236, ReadRawPlace(db).GetProperty("latitude").GetDouble());
    }

    [Fact]
    public async Task Explicit_mcp_retry_resolves_only_the_selected_legacy_place()
    {
        await using var db = await CreateLegacyPlacesDb("owner-a", 5,
            new Place { Id = "target", Name = "Target", City = "Tokyo", GoogleMapsUrl = SearchUrl },
            new Place { Id = "other", Name = "Other", City = "Tokyo", GoogleMapsUrl = "https://www.google.com/maps/search/?api=1&query=Other%2C%20Tokyo" });
        var handler = new GooglePlacesHandler("places/target", 35.7, 139.8);
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));

        var result = await tools.EditPlace(EditOperation.update, "target", 5);

        Assert.True(result.Success, result.Message);
        Assert.Equal(["Nakiryu, Tokyo, Japan"], handler.Queries);
        var snapshot = await service.GetSnapshotAsync();
        var target = snapshot.Places.Single(x => x.Id == "target");
        var other = snapshot.Places.Single(x => x.Id == "other");
        Assert.True(target.CoordinatesFromGoogle);
        Assert.Equal(35.7, target.Latitude);
        Assert.Null(other.Latitude);
        Assert.Single(db.GooglePlaceLocations);
        Assert.Equal("target", Assert.Single(db.GooglePlaceLocations).PlaceId);
    }

    [Fact]
    public async Task One_shot_http_resolution_is_cleared_and_unrelated_missing_places_are_not_retried()
    {
        await using var db = await CreateLegacyPlacesDb("owner-a", 5,
            new Place { Id = "target", Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl },
            new Place { Id = "other", Name = "Other", City = "Tokyo", GoogleMapsUrl = "https://www.google.com/maps/search/?api=1&query=Other%2C%20Tokyo" });
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7, 139.8);
        var service = CreateService(db, "owner-a", handler);
        var httpSnapshot = await service.GetSnapshotAsync();
        httpSnapshot.Places.Single(x => x.Id == "target").ResolveCoordinates = true;
        httpSnapshot = JsonSerializer.Deserialize<TripSnapshot>(JsonSerializer.Serialize(httpSnapshot, JsonOptions), JsonOptions)!;

        var saved = await service.ReplaceAsync(httpSnapshot, 5);

        var success = Assert.IsType<ReplaceResult.Success>(saved);
        Assert.False(success.Snapshot.Places.Single(x => x.Id == "target").ResolveCoordinates);
        Assert.Single(handler.Queries);
        var rawPlace = ReadRawPlace(db);
        Assert.False(rawPlace.TryGetProperty("resolveCoordinates", out _));
        var followUp = await service.GetSnapshotAsync();
        followUp.Tasks.Add(new TripTask { Id = "task-1", Title = "Check route" });
        var followUpResult = await service.ReplaceAsync(followUp, followUp.Version);
        Assert.IsType<ReplaceResult.Success>(followUpResult);
        Assert.Single(handler.Queries);
        Assert.Null((await service.GetSnapshotAsync()).Places.Single(x => x.Id == "other").Latitude);
    }

    [Fact]
    public async Task Failed_explicit_retry_keeps_version_source_and_notes_and_can_be_retried()
    {
        await using var db = await CreateLegacyPlacesDb("owner-a", 5,
            new Place { Id = "target", Name = "Nakiryu", City = "Tokyo", Notes = "Keep this", SourceUrl = "https://example.test/source", GoogleMapsUrl = SearchUrl });
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7, 139.8) { Failure = true };
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));

        var failed = await tools.EditPlace(EditOperation.update, "target", 5, new PlaceChanges { Notes = "Updated notes" });

        Assert.False(failed.Success);
        Assert.Equal(5, failed.Version);
        Assert.Contains("could not reach", failed.Message ?? "", StringComparison.OrdinalIgnoreCase);
        var unchanged = Assert.Single((await CreateService(db, "owner-a").GetSnapshotAsync()).Places);
        Assert.Equal("Keep this", unchanged.Notes);
        Assert.Equal("https://example.test/source", unchanged.SourceUrl);
        handler.Failure = false;

        var retried = await tools.EditPlace(EditOperation.update, "target", 5, new PlaceChanges { Notes = "Updated notes" });

        Assert.True(retried.Success, retried.Message);
        Assert.Equal(6, retried.Version);
        Assert.Collection(handler.Queries,
            query => Assert.Equal("Nakiryu, Tokyo, Japan", query),
            query => Assert.Equal("Nakiryu, Tokyo, Japan", query));
        var saved = Assert.Single((await service.GetSnapshotAsync()).Places);
        Assert.Equal("Updated notes", saved.Notes);
        Assert.True(saved.CoordinatesFromGoogle);
    }

    [Fact]
    public async Task Explicit_retry_bypasses_refresh_cooldown_but_rejects_a_different_google_place()
    {
        await using var db = await CreateExpiredCacheDb("owner-a", "places/original", 35.7286762, 139.7303427);
        var cached = Assert.Single(db.GooglePlaceLocations);
        cached.RefreshAfter = DateTimeOffset.UtcNow.AddMinutes(15);
        await db.SaveChangesAsync();
        var handler = new GooglePlacesHandler("places/different", 35.8, 139.9);
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));

        var result = await tools.EditPlace(EditOperation.update, "nakiryu", 4);

        Assert.False(result.Success);
        Assert.Equal(4, result.Version);
        Assert.Contains("different place", result.Message ?? "", StringComparison.OrdinalIgnoreCase);
        Assert.Single(handler.Queries);
        var row = Assert.Single(db.GooglePlaceLocations);
        Assert.Equal("places/original", row.GooglePlaceId);
        // A failed explicit retry must leave the last cached row untouched. The
        // expired pair is still withheld from reads until a successful refresh.
        Assert.Equal(35.7286762, row.Latitude);
        Assert.Equal(139.7303427, row.Longitude);
    }

    [Fact]
    public async Task Expired_cache_refreshes_the_same_google_place_and_does_not_return_old_coordinates()
    {
        await using var db = await CreateExpiredCacheDb("owner-a", "places/nakiryu", 35.7286762, 139.7303427);
        var handler = new GooglePlacesHandler("places/nakiryu", 35.8, 139.9);
        var service = CreateService(db, "owner-a", handler);

        var snapshot = await service.GetSnapshotAsync();

        var place = Assert.Single(snapshot.Places);
        Assert.Equal(35.8, place.Latitude);
        Assert.Equal(139.9, place.Longitude);
        var cached = Assert.Single(db.GooglePlaceLocations);
        Assert.Equal(35.8, cached.Latitude);
        Assert.Equal(139.9, cached.Longitude);
        Assert.True(cached.ExpiresAt > DateTimeOffset.UtcNow);
        Assert.Single(handler.Queries);
    }

    [Fact]
    public async Task Expired_cache_lookup_failure_returns_no_old_coordinates()
    {
        await using var db = await CreateExpiredCacheDb("owner-a", "places/nakiryu", 35.7286762, 139.7303427);
        var handler = new GooglePlacesHandler("places/nakiryu", 35.8, 139.9) { Failure = true };
        var service = CreateService(db, "owner-a", handler);

        var snapshot = await service.GetSnapshotAsync();

        var place = Assert.Single(snapshot.Places);
        Assert.Null(place.Latitude);
        Assert.Null(place.Longitude);
        Assert.Single(handler.Queries);
        Assert.True(Assert.Single(db.GooglePlaceLocations).ExpiresAt < DateTimeOffset.UtcNow);

        var secondRead = await service.GetSnapshotAsync();
        Assert.Null(Assert.Single(secondRead.Places).Latitude);
        Assert.Single(handler.Queries);
    }

    [Fact]
    public async Task Expired_cache_google_place_mismatch_returns_no_old_coordinates()
    {
        await using var db = await CreateExpiredCacheDb("owner-a", "places/nakiryu", 35.7286762, 139.7303427);
        var handler = new GooglePlacesHandler("places/another-place", 35.8, 139.9);
        var service = CreateService(db, "owner-a", handler);

        var snapshot = await service.GetSnapshotAsync();

        var place = Assert.Single(snapshot.Places);
        Assert.Null(place.Latitude);
        Assert.Null(place.Longitude);
        Assert.Single(handler.Queries);
        var cached = Assert.Single(db.GooglePlaceLocations);
        Assert.Null(cached.Latitude);
        Assert.Null(cached.Longitude);
        Assert.True(cached.ExpiresAt < DateTimeOffset.UtcNow);
    }

    [Fact]
    public async Task Prune_clears_expired_coordinates_but_keeps_the_google_location_row()
    {
        await using var db = await CreateExpiredCacheDb("owner-a", "places/nakiryu", 35.7286762, 139.7303427);
        var before = Assert.Single(db.GooglePlaceLocations);
        var revision = before.Revision;

        await GoogleLocationCleanupWorker.PruneAsync(db);

        var after = Assert.Single(db.GooglePlaceLocations);
        Assert.Null(after.Latitude);
        Assert.Null(after.Longitude);
        Assert.Equal("places/nakiryu", after.GooglePlaceId);
        Assert.NotEqual(revision, after.Revision);
    }

    [Fact]
    public async Task Deleting_a_place_drops_its_google_location_cache()
    {
        await using var db = CreateDb();
        var handler = new GooglePlacesHandler("places/nakiryu", 35.7286762, 139.7303427);
        var service = CreateService(db, "owner-a", handler);
        var tools = new TripMcpTools(service, new TripItemEditor(service));
        var created = await tools.EditPlace(EditOperation.create, "nakiryu", 1,
            new PlaceChanges { Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl });
        Assert.True(created.Success, created.Message);

        var deleted = await tools.EditPlace(EditOperation.delete, "nakiryu", created.Version);

        Assert.True(deleted.Success, deleted.Message);
        Assert.Empty((await service.GetSnapshotAsync()).Places);
        Assert.Empty(db.GooglePlaceLocations);
    }

    private static TripDbContext CreateDb() => new(new DbContextOptionsBuilder<TripDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static async Task<TripDbContext> CreateLegacyPlacesDb(string owner, long version, params Place[] places)
    {
        var db = CreateDb();
        var snapshot = new TripSnapshot { Version = version, Places = places.ToList() };
        await db.Trips.AddAsync(new TripDocumentRow
        {
            Id = Guid.NewGuid(),
            OwnerId = owner,
            Version = version,
            Json = JsonSerializer.Serialize(snapshot, JsonOptions),
            UpdatedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
        return db;
    }

    private static async Task<TripDbContext> CreateExpiredCacheDb(string owner, string googlePlaceId, double oldLatitude, double oldLongitude)
    {
        var db = CreateDb();
        var snapshot = new TripSnapshot
        {
            Version = 4,
            Places = [new Place { Id = "nakiryu", Name = "Nakiryu", City = "Tokyo", GoogleMapsUrl = SearchUrl }]
        };
        await db.Trips.AddAsync(new TripDocumentRow
        {
            Id = Guid.NewGuid(),
            OwnerId = owner,
            Version = snapshot.Version,
            Json = JsonSerializer.Serialize(snapshot, JsonOptions),
            UpdatedAt = DateTimeOffset.UtcNow
        });
        await db.GooglePlaceLocations.AddAsync(new GooglePlaceLocationRow
        {
            OwnerId = owner,
            PlaceId = "nakiryu",
            MapsUrl = SearchUrl,
            Query = "Nakiryu, Tokyo, Japan",
            GooglePlaceId = googlePlaceId,
            Latitude = oldLatitude,
            Longitude = oldLongitude,
            ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(-1),
            RefreshAfter = DateTimeOffset.UtcNow.AddMinutes(-1)
        });
        await db.SaveChangesAsync();
        return db;
    }

    private static TripService CreateService(TripDbContext db, string owner, GooglePlacesHandler? handler = null)
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = IPAddress.Loopback } };
        context.Request.Host = new HostString("localhost");
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", owner)], "test"));
        var ownerAccessor = new OwnerAccessor(new HttpContextAccessor { HttpContext = context }, new ConfigurationBuilder().Build());
        if (handler is null) return new TripService(db, ownerAccessor);

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["GoogleMaps:ApiKey"] = "test-key" })
            .Build();
        var http = new HttpClient(handler);
        var places = new GooglePlacesClient(http, configuration);
        var coordinates = new GoogleMapsCoordinates(http, places);
        return new TripService(db, ownerAccessor, coordinates: coordinates, placesClient: places);
    }

    private static JsonElement ReadRawPlace(TripDbContext db)
    {
        var row = db.Trips.Single();
        using var document = JsonDocument.Parse(row.Json);
        return document.RootElement.GetProperty("places")[0].Clone();
    }

    private sealed class GooglePlacesHandler(string googlePlaceId, double latitude, double longitude, string? responseJson = null) : HttpMessageHandler
    {
        public List<string> Queries { get; } = [];
        public List<string> DetailIds { get; } = [];
        public bool Failure { get; set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Method == HttpMethod.Get)
            {
                DetailIds.Add(Uri.UnescapeDataString(request.RequestUri!.Segments.Last()));
                if (Failure) throw new HttpRequestException("simulated Google Places outage");
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(JsonSerializer.Serialize(new { id = googlePlaceId, location = new { latitude, longitude } }), Encoding.UTF8, "application/json")
                };
            }
            var body = await request.Content!.ReadAsStringAsync(cancellationToken);
            using var document = JsonDocument.Parse(body);
            Queries.Add(document.RootElement.GetProperty("textQuery").GetString()!);
            if (Failure) throw new HttpRequestException("simulated Google Places outage");
            var json = responseJson ?? JsonSerializer.Serialize(new
            {
                places = new[] { new { id = googlePlaceId, location = new { latitude, longitude } } }
            });
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
        }
    }
}
