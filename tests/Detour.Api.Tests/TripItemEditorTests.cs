using System.Text.Json.Nodes;
using Detour.Api;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Detour.Api.Tests;

public sealed class TripItemEditorTests
{
    [Fact]
    public async Task Update_preserves_omitted_fields_and_null_clears_nullable_field()
    {
        await using var db = CreateDb();
        var (service, editor) = CreateEditor(db);
        var initial = await service.GetSnapshotAsync();
        initial.Places.Add(new Place
        {
            Id = "place-1",
            Name = "Old name",
            City = "Tokyo",
            Area = "Asakusa", Latitude = 35.68, Longitude = 139.7,
            Notes = "Keep me",
            SourceUrl = "https://example.test/source"
        });
        var seeded = Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(initial, initial.Version));

        var result = await editor.EditAsync(
            "places",
            "update",
            "place-1",
            new JsonObject { ["name"] = "New name", ["area"] = null },
            seeded.Snapshot.Version);

        Assert.True(result.Success);
        Assert.Equal(seeded.Snapshot.Version + 1, result.Version);
        var edited = Assert.IsType<Place>(result.Item);
        Assert.Equal("New name", edited.Name);
        Assert.Null(edited.Area);
        Assert.Equal("Keep me", edited.Notes);
        Assert.Equal("https://example.test/source", edited.SourceUrl);
    }

    [Fact]
    public async Task Stale_edit_is_rejected_with_current_item()
    {
        await using var db = CreateDb();
        var (service, editor) = CreateEditor(db);
        var initial = await service.GetSnapshotAsync();
        var created = await editor.EditAsync(
            "packingItems",
            "create",
            "pack-1",
            new JsonObject { ["name"] = "Passport", ["quantity"] = 1 },
            initial.Version);

        var stale = await editor.EditAsync(
            "packingItems",
            "update",
            "pack-1",
            new JsonObject { ["name"] = "Changed" },
            initial.Version);

        Assert.True(created.Success);
        Assert.False(stale.Success);
        Assert.Equal("version_conflict", stale.Error);
        Assert.Equal(created.Version, stale.Version);
        Assert.Equal("Passport", Assert.IsType<PackingItem>(stale.Item).Name);
    }

    [Fact]
    public async Task Retried_create_does_not_duplicate_stable_id()
    {
        await using var db = CreateDb();
        var (service, editor) = CreateEditor(db);
        var initial = await service.GetSnapshotAsync();
        var first = await editor.EditAsync(
            "bookings",
            "create",
            "booking-1",
            new JsonObject { ["title"] = "Flight" },
            initial.Version);

        var retry = await editor.EditAsync(
            "bookings",
            "create",
            "booking-1",
            new JsonObject { ["title"] = "Flight" },
            first.Version);

        Assert.True(first.Success);
        Assert.False(retry.Success);
        Assert.Equal("already_exists", retry.Error);
        Assert.Equal(first.Version, retry.Version);
        Assert.Single((await service.GetSnapshotAsync()).Bookings);
    }

    public static TheoryData<JsonObject, string> InvalidPackingChanges => new()
    {
        { new JsonObject { ["unknown"] = true }, "invalid_changes" },
        { new JsonObject { ["Name"] = "Wrong casing" }, "invalid_changes" },
        { new JsonObject { ["quantity"] = "many" }, "invalid_changes" },
        { new JsonObject { ["name"] = null }, "invalid_changes" },
        { new JsonObject { ["quantity"] = -1 }, "validation_failed" }
    };

    [Theory]
    [MemberData(nameof(InvalidPackingChanges))]
    public async Task Invalid_changes_do_not_persist_or_advance_version(JsonObject changes, string expectedError)
    {
        await using var db = CreateDb();
        var (service, editor) = CreateEditor(db);
        var initial = await service.GetSnapshotAsync();

        var result = await editor.EditAsync("packingItems", "create", "pack-1", changes, initial.Version);

        Assert.False(result.Success);
        Assert.Equal(expectedError, result.Error);
        var current = await service.GetSnapshotAsync();
        Assert.Equal(initial.Version, current.Version);
        Assert.Empty(current.PackingItems);
    }

    [Fact]
    public async Task Referenced_place_and_booking_cannot_be_deleted()
    {
        await using var db = CreateDb();
        var (service, editor) = CreateEditor(db);
        var initial = await service.GetSnapshotAsync();
        initial.Places.Add(new Place { Id = "place-1", Name = "Temple", City = "Kyoto", Latitude = 35.01, Longitude = 135.76 });
        initial.Activities.Add(new Activity { Id = "activity-1", PlaceId = "place-1", Date = new DateOnly(2026, 10, 1) });
        initial.Bookings.Add(new Booking { Id = "booking-1", Title = "Hotel" });
        initial.Stays.Add(new Stay
        {
            Id = "stay-1",
            Name = "Hotel",
            City = "Kyoto",
            CheckIn = new DateOnly(2026, 10, 1),
            CheckOut = new DateOnly(2026, 10, 2),
            BookingId = "booking-1"
        });
        var seeded = Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(initial, initial.Version));

        var placeDelete = await editor.EditAsync("places", "delete", "place-1", new JsonObject(), seeded.Snapshot.Version);
        var bookingDelete = await editor.EditAsync("bookings", "delete", "booking-1", new JsonObject(), seeded.Snapshot.Version);

        Assert.Equal("referenced", placeDelete.Error);
        Assert.Contains("activity-1", placeDelete.Message);
        Assert.Equal("referenced", bookingDelete.Error);
        Assert.Contains("stay-1", bookingDelete.Message);
        var current = await service.GetSnapshotAsync();
        Assert.Equal(seeded.Snapshot.Version, current.Version);
        Assert.Single(current.Places);
        Assert.Single(current.Bookings);
    }

    [Fact]
    public async Task Editing_one_collection_preserves_every_other_collection()
    {
        await using var db = CreateDb();
        var (service, editor) = CreateEditor(db);
        var initial = await service.GetSnapshotAsync();
        initial.Places.Add(new Place { Id = "place-1", Name = "Temple", City = "Kyoto", Latitude = 35.01, Longitude = 135.76 });
        initial.Bookings.Add(new Booking { Id = "booking-1", Title = "Flight" });
        initial.Tasks.Add(new TripTask { Id = "task-1", Title = "Check passport", Scope = "trip" });
        initial.PackingItems.Add(new PackingItem { Id = "pack-1", Name = "Passport" });
        initial.Activities.Add(new Activity { Id = "activity-1", Title = "Walk", Date = new DateOnly(2026, 10, 1) });
        initial.Stays.Add(new Stay { Id = "stay-1", Name = "Hotel", City = "Tokyo", CheckIn = new DateOnly(2026, 10, 1), CheckOut = new DateOnly(2026, 10, 2) });
        initial.TravelLegs.Add(new TravelLeg { Id = "leg-1", From = "Tokyo", To = "Kyoto", Date = new DateOnly(2026, 10, 2) });
        var seeded = Assert.IsType<ReplaceResult.Success>(await service.ReplaceAsync(initial, initial.Version));

        var result = await editor.EditAsync("tasks", "update", "task-1", new JsonObject { ["completed"] = true }, seeded.Snapshot.Version);

        Assert.True(result.Success);
        var current = await service.GetSnapshotAsync();
        Assert.Single(current.Places);
        Assert.Single(current.Bookings);
        Assert.Single(current.PackingItems);
        Assert.Single(current.Activities);
        Assert.Single(current.Stays);
        Assert.Single(current.TravelLegs);
        Assert.True(Assert.Single(current.Tasks).Completed);
        Assert.Equal("trip", Assert.Single(current.Tasks).Scope);
    }

    [Fact]
    public async Task References_and_task_scope_are_validated_before_persistence()
    {
        await using var db = CreateDb();
        var (service, editor) = CreateEditor(db);
        var initial = await service.GetSnapshotAsync();

        var activity = await editor.EditAsync(
            "activities",
            "create",
            "activity-1",
            new JsonObject { ["placeId"] = "missing", ["date"] = "2026-10-01" },
            initial.Version);
        var stay = await editor.EditAsync(
            "stays",
            "create",
            "stay-1",
            new JsonObject
            {
                ["name"] = "Hotel",
                ["city"] = "Tokyo",
                ["checkIn"] = "2026-10-01",
                ["checkOut"] = "2026-10-02",
                ["bookingId"] = "missing"
            },
            initial.Version);
        var task = await editor.EditAsync(
            "tasks",
            "create",
            "task-1",
            new JsonObject { ["title"] = "Check passport", ["scope"] = "trip" },
            initial.Version);

        Assert.Equal("validation_failed", activity.Error);
        Assert.Equal("validation_failed", stay.Error);
        Assert.Equal("validation_failed", task.Error);
        var current = await service.GetSnapshotAsync();
        Assert.Equal(initial.Version, current.Version);
        Assert.Empty(current.Activities);
        Assert.Empty(current.Stays);
        Assert.Empty(current.Tasks);
    }

    private static TripDbContext CreateDb()
    {
        var options = new DbContextOptionsBuilder<TripDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new TripDbContext(options);
    }

    private static (TripService Service, TripItemEditor Editor) CreateEditor(TripDbContext db)
    {
        var context = new DefaultHttpContext { Connection = { RemoteIpAddress = System.Net.IPAddress.Loopback } };
        context.Request.Host = new HostString("localhost");
        var http = new HttpContextAccessor { HttpContext = context };
        var service = new TripService(db, new OwnerAccessor(http, new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Auth:AllowLocalDev"] = "true" })
            .Build()));
        return (service, new TripItemEditor(service));
    }
}
