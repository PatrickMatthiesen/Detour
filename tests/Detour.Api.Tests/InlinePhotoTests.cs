using System.Net;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Detour.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Detour.Api.Tests;

public sealed class InlinePhotoTests
{
    private const string ImageUrl = "https://images.example.test/test.png";
    private const string ReplacementUrl = "https://images.example.test/replacement.png";
    private const string TinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    [Fact]
    public async Task Typed_place_edits_import_preserve_replace_and_remove_photo()
    {
        await using var db = CreateDb();
        var http = new PhotoHttpClientFactory();
        var store = new FakePhotoStore();
        var (service, tools) = CreateTools(db, http, store);
        var initial = await service.GetSnapshotAsync();

        var created = await tools.EditPlace(
            EditOperation.create,
            "place-a",
            initial.Version,
            new PlaceChanges
            {
                Name = "Ginza",
                City = "Tokyo",
                Photo = new PhotoInput
                {
                    Url = ImageUrl,
                    SourceUrl = "https://example.test/ginza",
                    Author = "Photographer",
                    Caption = "Ginza at night",
                    Kind = "neighbourhood",
                    License = "CC BY 4.0"
                }
            });

        Assert.True(created.Success);
        Assert.Equal(initial.Version + 1, created.Version);
        var createdPlace = Assert.IsType<Place>(created.Item);
        var originalPhoto = Assert.IsType<PhotoDescriptor>(createdPlace.Photo);
        Assert.StartsWith("/api/places/place-a/photo?v=", originalPhoto.Url);
        Assert.Equal("https://example.test/ginza", originalPhoto.SourceUrl);
        Assert.Equal("Photographer", originalPhoto.Author);
        Assert.Equal("Ginza at night", originalPhoto.Caption);
        Assert.Equal("neighbourhood", originalPhoto.Kind);
        Assert.Equal("CC BY 4.0", originalPhoto.License);
        Assert.Equal([ImageUrl], http.Requests);
        Assert.Single(store.Objects);
        Assert.Single(db.PlacePhotos);

        var omittedPhoto = JsonSerializer.Deserialize<PlaceChanges>("""{"name":"Ginza renamed"}""", JsonOptions)!;
        Assert.False(omittedPhoto.PhotoSpecified);
        var renamed = await tools.EditPlace(EditOperation.update, "place-a", created.Version, omittedPhoto);

        Assert.True(renamed.Success);
        Assert.Equal(created.Version + 1, renamed.Version);
        var renamedPlace = Assert.IsType<Place>(renamed.Item);
        Assert.Equal("Ginza renamed", renamedPlace.Name);
        Assert.Equal(originalPhoto.Id, Assert.IsType<PhotoDescriptor>(renamedPlace.Photo).Id);
        Assert.Equal([ImageUrl], http.Requests);

        var echoed = await tools.EditPlace(
            EditOperation.update,
            "place-a",
            renamed.Version,
            new PlaceChanges { Photo = new PhotoInput { Url = originalPhoto.Url } });

        Assert.True(echoed.Success);
        Assert.Equal(renamed.Version + 1, echoed.Version);
        Assert.Equal(originalPhoto.Id, Assert.IsType<PhotoDescriptor>(Assert.IsType<Place>(echoed.Item).Photo).Id);
        Assert.Equal([ImageUrl], http.Requests);

        var replaced = await tools.EditPlace(
            EditOperation.update,
            "place-a",
            echoed.Version,
            new PlaceChanges
            {
                Photo = new PhotoInput
                {
                    Url = ReplacementUrl,
                    Author = "Replacement author",
                    Caption = "Replacement caption"
                }
            });

        Assert.True(replaced.Success);
        Assert.Equal(echoed.Version + 1, replaced.Version);
        var replacementPhoto = Assert.IsType<PhotoDescriptor>(Assert.IsType<Place>(replaced.Item).Photo);
        Assert.NotEqual(originalPhoto.Id, replacementPhoto.Id);
        Assert.StartsWith("/api/places/place-a/photo?v=", replacementPhoto.Url);
        Assert.Equal("Replacement author", replacementPhoto.Author);
        Assert.Equal("Replacement caption", replacementPhoto.Caption);
        Assert.Equal("place", replacementPhoto.Kind);
        Assert.Equal([ImageUrl, ReplacementUrl], http.Requests);
        Assert.Single(db.PlacePhotos);

        var explicitNull = JsonSerializer.Deserialize<PlaceChanges>("""{"photo":null}""", JsonOptions)!;
        Assert.True(explicitNull.PhotoSpecified);
        Assert.Null(explicitNull.Photo);
        var removed = await tools.EditPlace(EditOperation.update, "place-a", replaced.Version, explicitNull);

        Assert.True(removed.Success);
        Assert.Equal(replaced.Version + 1, removed.Version);
        Assert.Null(Assert.IsType<Place>(removed.Item).Photo);
        Assert.Empty(db.PlacePhotos);
        Assert.Equal([ImageUrl, ReplacementUrl], http.Requests);
    }

    [Fact]
    public async Task Failed_inline_import_leaves_photo_place_fields_and_version_unchanged()
    {
        await using var db = CreateDb();
        var http = new PhotoHttpClientFactory();
        var store = new FakePhotoStore();
        var (service, tools) = CreateTools(db, http, store);
        var initial = await service.GetSnapshotAsync();
        var created = await tools.EditPlace(
            EditOperation.create,
            "place-a",
            initial.Version,
            new PlaceChanges
            {
                Name = "Ginza",
                City = "Tokyo",
                Notes = "Keep this",
                Photo = new PhotoInput { Url = ImageUrl, Caption = "Original" }
            });
        Assert.True(created.Success);
        var before = await service.GetSnapshotAsync();
        var beforePlace = Assert.Single(before.Places);
        var beforePhoto = Assert.IsType<PhotoDescriptor>(beforePlace.Photo);
        http.FailRequests = true;

        var failed = await tools.EditPlace(
            EditOperation.update,
            "place-a",
            before.Version,
            new PlaceChanges
            {
                Name = "Must not persist",
                Notes = "Must not persist either",
                Photo = new PhotoInput { Url = ReplacementUrl }
            });

        Assert.False(failed.Success);
        Assert.Equal("photo_import_failed", failed.Error);
        Assert.Equal(before.Version, failed.Version);
        var current = await service.GetSnapshotAsync();
        var currentPlace = Assert.Single(current.Places);
        Assert.Equal(before.Version, current.Version);
        Assert.Equal("Ginza", currentPlace.Name);
        Assert.Equal("Keep this", currentPlace.Notes);
        Assert.Equal(beforePhoto.Id, Assert.IsType<PhotoDescriptor>(currentPlace.Photo).Id);
        Assert.Single(db.PlacePhotos);
        Assert.Equal([ImageUrl, ReplacementUrl], http.Requests);
    }

    [Fact]
    public async Task Stale_inline_photo_edit_is_rejected_before_downloading()
    {
        await using var db = CreateDb();
        var http = new PhotoHttpClientFactory();
        var store = new FakePhotoStore();
        var (service, tools) = CreateTools(db, http, store);
        var initial = await service.GetSnapshotAsync();
        var created = await tools.EditPlace(
            EditOperation.create,
            "place-a",
            initial.Version,
            new PlaceChanges { Name = "Ginza", City = "Tokyo", Photo = new PhotoInput { Url = ImageUrl } });
        Assert.True(created.Success);

        var stale = await tools.EditPlace(
            EditOperation.update,
            "place-a",
            initial.Version,
            new PlaceChanges { Name = "Must not persist", Photo = new PhotoInput { Url = ReplacementUrl } });

        Assert.False(stale.Success);
        Assert.Equal("version_conflict", stale.Error);
        Assert.Equal(created.Version, stale.Version);
        Assert.Equal([ImageUrl], http.Requests);
        var current = await service.GetSnapshotAsync();
        Assert.Equal("Ginza", Assert.Single(current.Places).Name);
        Assert.Equal(created.Version, current.Version);
    }

    [Fact]
    public async Task Full_trip_json_distinguishes_omitted_photo_from_explicit_null()
    {
        await using var db = CreateDb();
        var http = new PhotoHttpClientFactory();
        var store = new FakePhotoStore();
        var (service, tools) = CreateTools(db, http, store);
        var initial = await service.GetSnapshotAsync();
        var created = await tools.EditPlace(
            EditOperation.create,
            "place-a",
            initial.Version,
            new PlaceChanges { Name = "Ginza", City = "Tokyo", Photo = new PhotoInput { Url = ImageUrl } });
        Assert.True(created.Success);
        var originalPhoto = Assert.IsType<PhotoDescriptor>(Assert.IsType<Place>(created.Item).Photo);

        var omittedJson = JsonSerializer.SerializeToNode(await service.GetSnapshotAsync(), JsonOptions)!.AsObject();
        omittedJson["places"]!.AsArray()[0]!.AsObject().Remove("photo");
        var omitted = omittedJson.Deserialize<TripSnapshot>(JsonOptions)!;
        Assert.False(Assert.Single(omitted.Places).PhotoSpecified);
        var preserved = Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(omitted, omitted.Version));

        Assert.Equal(created.Version + 1, preserved.Snapshot.Version);
        Assert.Equal(originalPhoto.Id, Assert.IsType<PhotoDescriptor>(Assert.Single(preserved.Snapshot.Places).Photo).Id);
        Assert.Equal([ImageUrl], http.Requests);

        var nullJson = JsonSerializer.SerializeToNode(await service.GetSnapshotAsync(), JsonOptions)!.AsObject();
        nullJson["places"]!.AsArray()[0]!.AsObject()["photo"] = null;
        var explicitNull = nullJson.Deserialize<TripSnapshot>(JsonOptions)!;
        var nullPlace = Assert.Single(explicitNull.Places);
        Assert.True(nullPlace.PhotoSpecified);
        Assert.Null(nullPlace.Photo);
        var removed = Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(explicitNull, explicitNull.Version));

        Assert.Equal(preserved.Snapshot.Version + 1, removed.Snapshot.Version);
        Assert.Null(Assert.Single(removed.Snapshot.Places).Photo);
        Assert.Empty(db.PlacePhotos);
        Assert.Equal([ImageUrl], http.Requests);
    }

    [Fact]
    public async Task Full_trip_replace_rejects_duplicate_place_ids_before_staging_photos()
    {
        await using var db = CreateDb();
        var http = new PhotoHttpClientFactory();
        var store = new FakePhotoStore();
        var (service, _) = CreateTools(db, http, store);
        var input = await service.GetSnapshotAsync();
        input.Places =
        [
            new Place
            {
                Id = "duplicate",
                Name = "First",
                City = "Tokyo",
                Photo = new PhotoDescriptor(Guid.Empty, ImageUrl, null, null, null, "place", null)
            },
            new Place
            {
                Id = "duplicate",
                Name = "Second",
                City = "Kyoto",
                Photo = new PhotoDescriptor(Guid.Empty, ReplacementUrl, null, null, null, "place", null)
            }
        ];

        Assert.IsType<ReplaceResult.Invalid>(await service.ReplaceAsync(input, input.Version));
        Assert.Empty(http.Requests);
        Assert.Empty(store.Objects);
        Assert.Empty(db.PhotoObjectDeletions);
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private static TripDbContext CreateDb() => new(
        new DbContextOptionsBuilder<TripDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static (TripService Service, TripMcpTools Tools) CreateTools(
        TripDbContext db,
        PhotoHttpClientFactory http,
        FakePhotoStore store)
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = IPAddress.Loopback } };
        context.Request.Host = new HostString("localhost");
        context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "owner-a")], "test"));
        var owner = new OwnerAccessor(
            new HttpContextAccessor { HttpContext = context },
            new ConfigurationBuilder().AddInMemoryCollection().Build());
        var imports = new PhotoImportService(db, new PhotoDownloader(http), store);
        var service = new TripService(db, owner, imports);
        return (service, new TripMcpTools(service, new TripItemEditor(service)));
    }

    private sealed class PhotoHttpClientFactory : IHttpClientFactory
    {
        private static readonly byte[] Image = Convert.FromBase64String(TinyPng);

        public List<string> Requests { get; } = [];
        public bool FailRequests { get; set; }

        public HttpClient CreateClient(string name) => new(new Handler(this));

        private sealed class Handler(PhotoHttpClientFactory owner) : HttpMessageHandler
        {
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                owner.Requests.Add(request.RequestUri!.ToString());
                if (owner.FailRequests)
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadGateway));
                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new ByteArrayContent(Image)
                };
                response.Content.Headers.ContentType = new("image/png");
                return Task.FromResult(response);
            }
        }
    }

    private sealed class FakePhotoStore : IPhotoObjectStore
    {
        public Dictionary<string, byte[]> Objects { get; } = [];

        public async Task PutAsync(string objectKey, Stream content, string contentType, long length, CancellationToken cancellationToken)
        {
            using var copy = new MemoryStream();
            await content.CopyToAsync(copy, cancellationToken);
            Objects[objectKey] = copy.ToArray();
        }

        public Task<PhotoObject?> GetAsync(string objectKey, CancellationToken cancellationToken) =>
            Task.FromResult(Objects.TryGetValue(objectKey, out var bytes)
                ? new PhotoObject(new MemoryStream(bytes), "image/jpeg", bytes.Length)
                : null);

        public Task DeleteAsync(string objectKey, CancellationToken cancellationToken)
        {
            Objects.Remove(objectKey);
            return Task.CompletedTask;
        }
    }
}
