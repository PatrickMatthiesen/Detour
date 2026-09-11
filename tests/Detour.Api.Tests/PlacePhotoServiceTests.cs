using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Detour.Api.Tests;

public sealed class PlacePhotoServiceTests
{
    private const string TinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    [Fact]
    public async Task Uploaded_photo_is_preserved_when_full_trip_put_contains_forged_photo_metadata()
    {
        await using var db = CreateDb();
        var trips = CreateTripService(db, "owner-a");
        var store = new FakePhotoStore();
        var photos = CreatePhotoService(db, trips, "owner-a", store);
        var snapshot = await trips.GetSnapshotAsync();
        snapshot.Places.Add(new Place { Id = "place-a", Name = "Ginza", City = "Tokyo" });
        var saved = Assert.IsType<ReplaceResult.Success>(await trips.ReplaceAsync(snapshot, snapshot.Version));

        await using var input = new MemoryStream(Convert.FromBase64String(TinyPng));
        var imported = await photos.ImportUploadedAsync("place-a", input, "https://example.test/photo", "Author", "Ginza", "place", "CC0", saved.Snapshot.Version, CancellationToken.None);

        Assert.True(imported.Success);
        Assert.NotNull(imported.Photo);
        Assert.Single(store.Objects);
        var current = await trips.GetSnapshotAsync();
        var forged = current.Places.Single(x => x.Id == "place-a");
        forged.Photo = new PhotoDescriptor(Guid.NewGuid(), "/forged", "https://evil.test", "Evil", "forged", "place", null);
        forged.Name = "Ginza renamed";
        var replaced = await trips.ReplaceAsync(current, current.Version, CancellationToken.None);
        var canonical = Assert.IsType<ReplaceResult.Success>(replaced).Snapshot;

        var photo = Assert.Single(canonical.Places).Photo;
        Assert.Equal(imported.Photo!.Id, photo!.Id);
        Assert.Equal("Ginza renamed", canonical.Places[0].Name);
        Assert.Single(db.PlacePhotos);
    }

    [Fact]
    public async Task Photo_operations_are_owner_scoped_and_stale_writes_are_rejected()
    {
        await using var db = CreateDb();
        var ownerA = CreateTripService(db, "owner-a");
        var ownerB = CreateTripService(db, "owner-b");
        var store = new FakePhotoStore();
        var photosA = CreatePhotoService(db, ownerA, "owner-a", store);
        var initial = await ownerA.GetSnapshotAsync();
        initial.Places.Add(new Place { Id = "place-a", Name = "Ginza", City = "Tokyo" });
        var saved = Assert.IsType<ReplaceResult.Success>(await ownerA.ReplaceAsync(initial, initial.Version));
        await using var input = new MemoryStream(Convert.FromBase64String(TinyPng));
        var imported = await photosA.ImportUploadedAsync("place-a", input, null, null, null, null, null, saved.Snapshot.Version, CancellationToken.None);
        Assert.True(imported.Success);

        var other = await ownerB.GetSnapshotAsync();
        Assert.Empty(other.Places);
        var stale = await photosA.RemoveAsync("place-a", saved.Snapshot.Version, CancellationToken.None);
        Assert.False(stale.Success);
        Assert.Equal("version_conflict", stale.Error);
    }

    [Fact]
    public async Task Deleting_and_recreating_a_place_does_not_resurrect_its_photo()
    {
        await using var db = CreateDb();
        var trips = CreateTripService(db, "owner-a");
        var store = new FakePhotoStore();
        var photos = CreatePhotoService(db, trips, "owner-a", store);
        var initial = await trips.GetSnapshotAsync();
        initial.Places.Add(new Place { Id = "place-a", Name = "Ginza", City = "Tokyo" });
        var placeVersion = Assert.IsType<ReplaceResult.Success>(await trips.ReplaceAsync(initial, initial.Version)).Snapshot.Version;

        await using var input = new MemoryStream(Convert.FromBase64String(TinyPng));
        var imported = await photos.ImportUploadedAsync("place-a", input, null, null, null, null, null, placeVersion, CancellationToken.None);
        Assert.True(imported.Success);
        var objectKey = Assert.Single(store.Objects).Key;

        var withoutPlace = await trips.GetSnapshotAsync();
        withoutPlace.Places.Clear();
        var deleted = Assert.IsType<ReplaceResult.Success>(await trips.ReplaceAsync(withoutPlace, withoutPlace.Version));
        Assert.Empty(db.PlacePhotos);
        Assert.Contains(db.PhotoObjectDeletions, x => x.ObjectKey == objectKey);

        var recreated = await trips.GetSnapshotAsync();
        recreated.Places.Add(new Place { Id = "place-a", Name = "Ginza rebuilt", City = "Tokyo" });
        var rebuilt = Assert.IsType<ReplaceResult.Success>(await trips.ReplaceAsync(recreated, recreated.Version)).Snapshot;
        Assert.Null(Assert.Single(rebuilt.Places).Photo);

        await PhotoCleanupWorker.DrainAsync(db, store, CancellationToken.None);
        Assert.Empty(store.Objects);
        Assert.Empty(db.PhotoObjectDeletions);
    }

    [Fact]
    public async Task Failed_photo_deletion_remains_queued_for_a_later_retry()
    {
        await using var db = CreateDb();
        var trips = CreateTripService(db, "owner-a");
        var store = new FakePhotoStore();
        var photos = CreatePhotoService(db, trips, "owner-a", store);
        var initial = await trips.GetSnapshotAsync();
        initial.Places.Add(new Place { Id = "place-a", Name = "Ginza", City = "Tokyo" });
        var placeVersion = Assert.IsType<ReplaceResult.Success>(await trips.ReplaceAsync(initial, initial.Version)).Snapshot.Version;

        await using var input = new MemoryStream(Convert.FromBase64String(TinyPng));
        Assert.True((await photos.ImportUploadedAsync("place-a", input, null, null, null, null, null, placeVersion, CancellationToken.None)).Success);
        var current = await trips.GetSnapshotAsync();
        current.Places.Clear();
        Assert.IsType<ReplaceResult.Success>(await trips.ReplaceAsync(current, current.Version));
        var objectKey = Assert.Single(store.Objects).Key;
        store.FailNextDelete = true;

        await Assert.ThrowsAsync<InvalidOperationException>(() => PhotoCleanupWorker.DrainAsync(db, store, CancellationToken.None));
        Assert.Contains(db.PhotoObjectDeletions, x => x.ObjectKey == objectKey);
        Assert.Contains(objectKey, store.Objects.Keys);

        await PhotoCleanupWorker.DrainAsync(db, store, CancellationToken.None);
        Assert.DoesNotContain(objectKey, store.Objects.Keys);
        Assert.Empty(db.PhotoObjectDeletions);
        Assert.Equal(2, store.DeleteCalls);
    }

    [Theory]
    [InlineData("http://127.0.0.1/image.jpg")]
    [InlineData("http://192.168.1.1/image.jpg")]
    [InlineData("http://10.0.0.1/image.jpg")]
    [InlineData("http://[::1]/image.jpg")]
    [InlineData("http://example.test:8080/image.jpg")]
    [InlineData("http://user:password@example.test/image.jpg")]
    public void Downloader_rejects_local_credentialed_and_nonstandard_urls(string value)
        => Assert.Throws<InvalidOperationException>(() => PhotoDownloader.ValidateUri(value));

    private static TripDbContext CreateDb() => new(new DbContextOptionsBuilder<TripDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static TripService CreateTripService(TripDbContext db, string owner)
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = System.Net.IPAddress.Loopback } };
        context.Request.Host = new HostString("localhost");
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", owner)], "test"));
        return new(db, new OwnerAccessor(new FixedHttpContextAccessor(context), new ConfigurationBuilder().AddInMemoryCollection().Build()));
    }

    private static PlacePhotoService CreatePhotoService(TripDbContext db, TripService trips, string owner, FakePhotoStore store)
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = System.Net.IPAddress.Loopback } };
        context.Request.Host = new HostString("localhost");
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", owner)], "test"));
        var accessor = new OwnerAccessor(new FixedHttpContextAccessor(context), new ConfigurationBuilder().AddInMemoryCollection().Build());
        return new(db, accessor, trips, new PhotoDownloader(new EmptyHttpClientFactory()), store, NullLogger<PlacePhotoService>.Instance);
    }

    private sealed class FixedHttpContextAccessor(HttpContext context) : IHttpContextAccessor { public HttpContext? HttpContext { get; set; } = context; }
    private sealed class EmptyHttpClientFactory : IHttpClientFactory { public HttpClient CreateClient(string name) => new(); }
    private sealed class FakePhotoStore : IPhotoObjectStore
    {
        public Dictionary<string, byte[]> Objects { get; } = [];
        public bool FailNextDelete { get; set; }
        public int DeleteCalls { get; private set; }
        public async Task PutAsync(string objectKey, Stream content, string contentType, long length, CancellationToken cancellationToken) { using var b = new MemoryStream(); await content.CopyToAsync(b, cancellationToken); Objects[objectKey] = b.ToArray(); }
        public Task<PhotoObject?> GetAsync(string objectKey, CancellationToken cancellationToken) => Task.FromResult(Objects.TryGetValue(objectKey, out var value) ? new PhotoObject(new MemoryStream(value), "image/jpeg", value.Length) : null);
        public Task DeleteAsync(string objectKey, CancellationToken cancellationToken)
        {
            DeleteCalls++;
            if (FailNextDelete) { FailNextDelete = false; throw new InvalidOperationException("simulated object store failure"); }
            Objects.Remove(objectKey);
            return Task.CompletedTask;
        }
    }
}
