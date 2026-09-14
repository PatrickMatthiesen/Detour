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
                Latitude = 35.68,
                Longitude = 139.7,
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
                Latitude = 35.68,
                Longitude = 139.7,
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
            new PlaceChanges { Name = "Ginza", City = "Tokyo", Latitude = 35.68, Longitude = 139.7, Photo = new PhotoInput { Url = ImageUrl } });
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
            new PlaceChanges { Name = "Ginza", City = "Tokyo", Latitude = 35.68, Longitude = 139.7, Photo = new PhotoInput { Url = ImageUrl } });
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
                Latitude = 35.68,
                Longitude = 139.7,
                Photo = new PhotoDescriptor(Guid.Empty, ImageUrl, null, null, null, "place", null)
            },
            new Place
            {
                Id = "duplicate",
                Name = "Second",
                City = "Kyoto",
                Latitude = 35.69,
                Longitude = 139.71,
                Photo = new PhotoDescriptor(Guid.Empty, ReplacementUrl, null, null, null, "place", null)
            }
        ];

        Assert.IsType<ReplaceResult.Invalid>(await service.ReplaceAsync(input, input.Version));
        Assert.Empty(http.Requests);
        Assert.Empty(store.Objects);
        Assert.Empty(db.PhotoObjectDeletions);
    }

    [Theory]
    [InlineData(BulkEditMode.atomic, false)]
    [InlineData(BulkEditMode.best_effort, true)]
    public async Task Bulk_validation_commits_once_or_rolls_back(BulkEditMode mode, bool committed)
    {
        await using var db = CreateDb();
        var (service, tools) = CreateTools(db, new(), new());
        var initial = await service.GetSnapshotAsync();
        var result = await tools.EditPlaces(initial.Version,
            [NewPlace("one"), NewPlace("bad", new PlaceChanges { Name = "Missing location", City = "Tokyo" }), NewPlace("two")], mode);
        Assert.Equal(committed, result.Committed);
        Assert.False(result.Success);
        Assert.Equal(initial.Version + (committed ? 1 : 0), result.Version);
        Assert.Equal("failed", result.Results[1].Status);
        Assert.Equal("validation_failed", result.Results[1].Error!.Code);
        Assert.Equal(committed ? "succeeded" : "not_committed", result.Results[0].Status);
        var saved = await service.GetSnapshotAsync();
        Assert.Equal(committed ? 2 : 0, saved.Places.Count);
        if (committed)
        {
            Assert.Equal("one", result.Results[0].Item!.Id);
            var retry = await tools.EditPlaces(result.Version, [NewPlace("bad")]);
            Assert.True(retry.Success);
            Assert.Equal(3, (await service.GetSnapshotAsync()).Places.Count);
        }
    }

    [Theory]
    [InlineData(BulkEditMode.atomic, PhotoFailurePolicy.fail_operation, false, 0)]
    [InlineData(BulkEditMode.best_effort, PhotoFailurePolicy.fail_operation, true, 1)]
    [InlineData(BulkEditMode.atomic, PhotoFailurePolicy.save_without_new_photo, true, 2)]
    [InlineData(BulkEditMode.best_effort, PhotoFailurePolicy.save_without_new_photo, true, 2)]
    public async Task Bulk_photo_policy_is_independent_of_batch_mode(BulkEditMode mode, PhotoFailurePolicy policy, bool committed, int count)
    {
        await using var db = CreateDb();
        var http = new PhotoHttpClientFactory { FailRequests = true };
        var (service, tools) = CreateTools(db, http, new());
        var initial = await service.GetSnapshotAsync();
        var result = await tools.EditPlaces(initial.Version, [NewPlace("one"), NewPlace("photo", PhotoChanges())], mode, policy);
        Assert.Equal(committed, result.Committed);
        Assert.Equal(count, (await service.GetSnapshotAsync()).Places.Count);
        Assert.Equal(initial.Version + (committed ? 1 : 0), result.Version);
        var outcome = result.Results[1];
        Assert.Equal("http_502", (outcome.PhotoError ?? outcome.Error)!.Code);
        if (policy == PhotoFailurePolicy.save_without_new_photo)
        {
            Assert.Equal("succeeded_with_warning", outcome.Status);
            Assert.NotNull(outcome.Item);
            http.FailRequests = false;
            var retry = await tools.EditPlace(EditOperation.update, "photo", result.Version,
                new PlaceChanges { Photo = new PhotoInput { Url = ImageUrl } });
            Assert.True(retry.Success);
            Assert.NotNull(Assert.IsType<Place>(retry.Item).Photo);
        }
    }

    [Fact]
    public async Task Bulk_photo_warning_preserves_old_photo_and_saves_fields()
    {
        await using var db = CreateDb();
        var http = new PhotoHttpClientFactory();
        var (service, tools) = CreateTools(db, http, new());
        var created = await tools.EditPlace(EditOperation.create, "one", (await service.GetSnapshotAsync()).Version, PhotoChanges());
        var original = Assert.IsType<Place>(created.Item).Photo!;
        http.FailRequests = true;
        var result = await tools.EditPlaces(created.Version,
            [new(EditOperation.update, "one", new PlaceChanges { Name = "Renamed", Photo = new PhotoInput { Url = ReplacementUrl } })],
            photoFailurePolicy: PhotoFailurePolicy.save_without_new_photo);
        Assert.True(result.Committed);
        var saved = Assert.Single((await service.GetSnapshotAsync()).Places);
        Assert.Equal("Renamed", saved.Name);
        Assert.Equal(original.Id, saved.Photo!.Id);
        Assert.Equal("http_502", result.Results[0].PhotoError!.Code);
    }

    [Theory]
    [InlineData(BulkEditMode.atomic)]
    [InlineData(BulkEditMode.best_effort)]
    public async Task Bulk_conflict_during_photo_staging_commits_no_operations(BulkEditMode mode)
    {
        await using var db = CreateDb();
        var http = new PhotoHttpClientFactory();
        var store = new FakePhotoStore();
        var (service, tools) = CreateTools(db, http, store);
        var initial = await service.GetSnapshotAsync();
        http.BeforeRequest = async () =>
        {
            http.BeforeRequest = null;
            var concurrent = await tools.EditTask(EditOperation.create, "concurrent", initial.Version,
                new TripTaskChanges { Title = "Concurrent edit", Scope = "before" });
            Assert.True(concurrent.Success);
        };
        var result = await tools.EditPlaces(initial.Version, [NewPlace("one"), NewPlace("photo", PhotoChanges())], mode);
        Assert.False(result.Committed);
        Assert.Equal("version_conflict", result.Error);
        Assert.Equal(initial.Version + 1, result.Version);
        Assert.All(result.Results, x => Assert.Equal("not_committed", x.Status));
        var saved = await service.GetSnapshotAsync();
        Assert.Empty(saved.Places);
        Assert.Single(saved.Tasks);
        Assert.Empty(db.PlacePhotos);
        Assert.Single(db.PhotoObjectDeletions); // Staged object remains queued for cleanup.
    }

    [Fact]
    public async Task Bulk_rejects_duplicate_ids_and_stale_version_before_import()
    {
        await using var db = CreateDb();
        var http = new PhotoHttpClientFactory();
        var (service, tools) = CreateTools(db, http, new());
        var initial = await service.GetSnapshotAsync();
        Assert.Equal("invalid_batch", (await tools.EditPlaces(initial.Version, [NewPlace("one"), NewPlace("one")])).Error);
        Assert.Equal("version_conflict", (await tools.EditPlaces(initial.Version - 1, [NewPlace("one", PhotoChanges())])).Error);
        Assert.Empty(http.Requests);
        Assert.Empty((await service.GetSnapshotAsync()).Places);
    }

    [Fact]
    public async Task Bulk_updates_clear_fields_and_deletes_respect_references()
    {
        await using var db = CreateDb();
        var (service, tools) = CreateTools(db, new(), new());
        var created = await tools.EditPlaces((await service.GetSnapshotAsync()).Version,
            [NewPlace("one"), NewPlace("two", new PlaceChanges { Name = "Two", City = "Tokyo", Latitude = 35, Longitude = 139, Area = "Old", Selected = true })]);
        Assert.True(created.Success);
        var activity = await tools.EditActivity(EditOperation.create, "visit", created.Version,
            new ActivityChanges { PlaceId = "one", Date = new DateOnly(2026, 9, 13) });
        Assert.True(activity.Success);
        var edited = await tools.EditPlaces(activity.Version,
            [new(EditOperation.delete, "one"), new(EditOperation.update, "two", new PlaceChanges { Selected = false }, ["area"]), NewPlace("three")],
            BulkEditMode.best_effort);
        Assert.True(edited.Committed);
        Assert.Equal("referenced", edited.Results[0].Error!.Code);
        Assert.NotNull(edited.Results[0].Item);
        Assert.False(edited.Results[1].Item!.Selected);
        Assert.Null(edited.Results[1].Item!.Area);
        Assert.Equal("Two", edited.Results[1].Item!.Name);
        var deleted = await tools.EditPlaces(edited.Version, [new(EditOperation.delete, "three")]);
        Assert.True(deleted.Success);
        Assert.Null(deleted.Results[0].Item);
        var allFailed = await tools.EditPlaces(deleted.Version, [new(EditOperation.delete, "one")], BulkEditMode.best_effort);
        Assert.False(allFailed.Committed);
        Assert.Equal(deleted.Version, allFailed.Version);
        Assert.Equal(2, (await service.GetSnapshotAsync()).Places.Count);
    }

    [Theory]
    [InlineData("http_403")]
    [InlineData("unsupported_content_type")]
    [InlineData("too_large")]
    [InlineData("invalid_image")]
    public async Task Photo_import_returns_actionable_diagnostic_without_upstream_body(string code)
    {
        await using var db = CreateDb();
        var http = new PhotoHttpClientFactory
        {
            ResponseOverride = () =>
            {
                var response = new HttpResponseMessage(code == "http_403" ? HttpStatusCode.Forbidden : HttpStatusCode.OK)
                { Content = new StringContent("secret upstream details") };
                response.Content.Headers.ContentType = new(code == "unsupported_content_type" ? "text/html" : "image/jpeg");
                if (code == "too_large") response.Content.Headers.ContentLength = PhotoDownloader.MaxDownloadBytes + 1;
                return response;
            }
        };
        var (service, tools) = CreateTools(db, http, new());
        var initial = await service.GetSnapshotAsync();
        var result = await tools.EditPlace(EditOperation.create, "one", initial.Version, PhotoChanges());
        Assert.False(result.Success);
        Assert.Equal(code, result.Details!.Code);
        Assert.DoesNotContain("secret upstream details", result.Message);
        Assert.Equal(initial.Version, (await service.GetSnapshotAsync()).Version);
        Assert.Empty((await service.GetSnapshotAsync()).Places);
    }

    [Fact]
    public async Task Photo_failure_cannot_remove_a_stays_last_mapped_place()
    {
        await using var db = CreateDb();
        var http = new PhotoHttpClientFactory { FailRequests = true };
        var (service, tools) = CreateTools(db, http, new());
        var city = "Test village with no built-in center";
        var initial = await service.GetSnapshotAsync();
        var place = await tools.EditPlace(EditOperation.create, "old", initial.Version,
            new PlaceChanges { Name = "Old", City = city, Latitude = 35, Longitude = 139 });
        Assert.True(place.Success);
        var stay = await tools.EditStay(EditOperation.create, "stay", place.Version,
            new StayChanges { City = city, CheckIn = new DateOnly(2026, 9, 13), CheckOut = new DateOnly(2026, 9, 14) });
        Assert.True(stay.Success, stay.Message);
        var replacement = PhotoChanges();
        replacement.City = city;
        var result = await tools.EditPlaces(stay.Version,
            [new(EditOperation.delete, "old"), NewPlace("replacement", replacement)], BulkEditMode.best_effort);
        Assert.False(result.Committed);
        Assert.Contains("lose its map location", result.Message);
        var saved = await service.GetSnapshotAsync();
        Assert.Equal(stay.Version, saved.Version);
        Assert.Equal("old", Assert.Single(saved.Places).Id);
    }

    private static PlaceEditOperation NewPlace(string id, PlaceChanges? changes = null) => new(EditOperation.create, id,
        changes ?? new PlaceChanges { Name = id, City = "Tokyo", Latitude = 35, Longitude = 139 });
    private static PlaceChanges PhotoChanges() => new()
        { Name = "Photo", City = "Tokyo", Latitude = 35, Longitude = 139, Photo = new PhotoInput { Url = ImageUrl } };

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
        public Func<Task>? BeforeRequest { get; set; }
        public Func<HttpResponseMessage>? ResponseOverride { get; set; }

        public HttpClient CreateClient(string name) => new(new Handler(this));

        private sealed class Handler(PhotoHttpClientFactory owner) : HttpMessageHandler
        {
            protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            {
                if (owner.BeforeRequest is { } callback) await callback();
                owner.Requests.Add(request.RequestUri!.ToString());
                if (owner.ResponseOverride is { } respond) return respond();
                if (owner.FailRequests)
                    return new HttpResponseMessage(HttpStatusCode.BadGateway);
                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new ByteArrayContent(Image)
                };
                response.Content.Headers.ContentType = new("image/png");
                return response;
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
