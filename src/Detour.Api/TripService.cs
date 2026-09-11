using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;

namespace Detour.Api;

public sealed class TripService(TripDbContext db, OwnerAccessor ownerAccessor, PhotoImportService? photoImports = null)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<TripSnapshot> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        var owner = ownerAccessor.OwnerId;
        var row = await db.Trips.SingleOrDefaultAsync(x => x.OwnerId == owner, cancellationToken);
        if (row is null)
        {
            var snapshot = NewSnapshot();
            row = new TripDocumentRow { Id = Guid.NewGuid(), OwnerId = owner, Version = 1, Json = SerializeForPersistence(snapshot), UpdatedAt = DateTimeOffset.UtcNow };
            await db.Trips.AddAsync(row, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            snapshot.Version = row.Version;
            await EnrichPhotosAsync(snapshot, owner, cancellationToken);
            return snapshot;
        }
        var loaded = Read(row);
        await EnrichPhotosAsync(loaded, owner, cancellationToken);
        return loaded;
    }

    public async Task<ReplaceResult> ReplaceAsync(TripSnapshot input, long expectedVersion, CancellationToken cancellationToken = default)
    {
        if (expectedVersion < 0 || input.Trip is null || input.Trip.StartDate > input.Trip.EndDate) return new ReplaceResult.Invalid();
        var owner = ownerAccessor.OwnerId;
        try { ValidateAndNormalize(input); }
        catch (ArgumentException) { return new ReplaceResult.Invalid(); }
        var before = await db.Trips.AsNoTracking().SingleOrDefaultAsync(x => x.OwnerId == owner, cancellationToken);
        if (before is null) return new ReplaceResult.Conflict(NewSnapshot());
        if (before.Version != expectedVersion)
        {
            var current = Read(before);
            await EnrichPhotosAsync(current, owner, cancellationToken);
            return new ReplaceResult.Conflict(current);
        }
        var storedPhotos = await db.PlacePhotos.AsNoTracking().Where(x => x.OwnerId == owner).ToDictionaryAsync(x => x.PlaceId, cancellationToken);
        var staged = new Dictionary<string, PlacePhotoRow>();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(2));
        try
        {
            foreach (var place in input.Places.Where(x => x.PhotoSpecified && x.Photo is not null))
            {
                // The read model's private URL is a reference, never a download source.
                if (storedPhotos.TryGetValue(place.Id, out var stored) && place.Photo!.Url == ToDescriptor(stored).Url) continue;
                if (photoImports is null) return new ReplaceResult.PhotoFailed("Photo importing is not configured.");
                staged.Add(place.Id, await photoImports.StageAsync(owner, place, timeout.Token));
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new ReplaceResult.PhotoFailed("Photo import timed out. The place and existing photo were not changed.");
        }
        catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException or TimeoutException or
            SixLabors.ImageSharp.UnknownImageFormatException or SixLabors.ImageSharp.InvalidImageContentException or
            PhotoStorageUnavailableException or Amazon.S3.AmazonS3Exception)
        {
            return new ReplaceResult.PhotoFailed("Could not import the photo. Check the image URL, format, size, and storage availability. The place and existing photo were not changed.");
        }
        await using var transaction = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(timeout.Token) : null;
        var row = await LockTripAsync(db, owner, timeout.Token);
        if (row is null) return new ReplaceResult.Conflict(NewSnapshot());
        if (row.Version != expectedVersion)
        {
            var current = Read(row);
            await EnrichPhotosAsync(current, owner, timeout.Token);
            return new ReplaceResult.Conflict(current);
        }
        input.Version = expectedVersion + 1;
        row.Version = input.Version;
        row.Json = SerializeForPersistence(input);
        row.UpdatedAt = DateTimeOffset.UtcNow;
        var ids = input.Places.Select(x => x.Id).ToArray();
        var changedPhotoIds = input.Places.Where(x => x.PhotoSpecified && x.Photo is null).Select(x => x.Id).Concat(staged.Keys).ToArray();
        var deletedPhotos = await db.PlacePhotos.Where(x => x.OwnerId == owner && (!ids.Contains(x.PlaceId) || changedPhotoIds.Contains(x.PlaceId))).ToArrayAsync(timeout.Token);
        foreach (var photo in deletedPhotos)
            db.PhotoObjectDeletions.Add(new PhotoObjectDeletion { ObjectKey = photo.ObjectKey, NotBefore = DateTimeOffset.UtcNow });
        db.PlacePhotos.RemoveRange(deletedPhotos);
        foreach (var photo in staged.Values)
        {
            db.PlacePhotos.Add(photo);
            var reservation = await db.PhotoObjectDeletions.SingleAsync(x => x.ObjectKey == photo.ObjectKey, timeout.Token);
            db.PhotoObjectDeletions.Remove(reservation);
        }
        try
        {
            await db.SaveChangesAsync(timeout.Token);
            if (transaction is not null) await transaction.CommitAsync(timeout.Token);
        }
        catch (DbUpdateConcurrencyException)
        {
            if (transaction is not null) await transaction.RollbackAsync(timeout.Token);
            db.ChangeTracker.Clear();
            // Reset tracked values too, so another tool call in this scope reads the winner.
            var actual = await db.Trips.SingleAsync(x => x.OwnerId == owner, timeout.Token);
            var current = Read(actual);
            await EnrichPhotosAsync(current, owner, timeout.Token);
            return new ReplaceResult.Conflict(current);
        }
        var saved = Read(row);
        await EnrichPhotosAsync(saved, owner, timeout.Token);
        return new ReplaceResult.Success(saved);
    }

    public async Task<IReadOnlyList<Place>> SearchPlacesAsync(string? query, string? city, CancellationToken cancellationToken = default)
    {
        var snapshot = await GetSnapshotAsync(cancellationToken);
        return snapshot.Places.Where(place =>
            (string.IsNullOrWhiteSpace(query) || string.Join(' ', place.Name, place.City, place.Area, place.Category, place.Description, place.Notes).Contains(query, StringComparison.OrdinalIgnoreCase)) &&
            (string.IsNullOrWhiteSpace(city) || place.City.Equals(city, StringComparison.OrdinalIgnoreCase))).ToArray();
    }

    public async Task<ReplaceResult> SavePlaceAsync(Place place, long expectedVersion, CancellationToken cancellationToken = default)
    {
        var current = await GetSnapshotAsync(cancellationToken);
        // A single reel/article can contain several places. Only a stable place ID
        // identifies an update; source URLs are provenance and never dedupe keys.
        var existing = current.Places.FirstOrDefault(x => x.Id.Equals(place.Id, StringComparison.OrdinalIgnoreCase));
        if (existing is not null) { place.Id = existing.Id; current.Places[current.Places.IndexOf(existing)] = place; }
        else current.Places.Add(place);
        return await ReplaceAsync(current, expectedVersion, cancellationToken);
    }

    public async Task<ReplaceResult> UpdateBookingAsync(Booking booking, long expectedVersion, CancellationToken cancellationToken = default)
    {
        var current = await GetSnapshotAsync(cancellationToken);
        var existing = current.Bookings.FirstOrDefault(x => x.Id == booking.Id);
        if (existing is null) current.Bookings.Add(booking);
        else current.Bookings[current.Bookings.IndexOf(existing)] = booking;
        return await ReplaceAsync(current, expectedVersion, cancellationToken);
    }

    public async Task SeedAsync(string path, string ownerId = "local-dev", CancellationToken cancellationToken = default)
    {
        if (!File.Exists(path) || await db.Trips.AnyAsync(x => x.OwnerId == ownerId, cancellationToken)) return;
        var snapshot = JsonSerializer.Deserialize<TripSnapshot>(await File.ReadAllTextAsync(path, cancellationToken), JsonOptions) ?? NewSnapshot();
        ValidateAndNormalize(snapshot);
        var row = new TripDocumentRow { Id = Guid.NewGuid(), OwnerId = ownerId, Version = snapshot.Version, Json = SerializeForPersistence(snapshot), UpdatedAt = DateTimeOffset.UtcNow };
        await db.Trips.AddAsync(row, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
    }

    private static TripSnapshot Read(TripDocumentRow row)
    {
        var snapshot = JsonSerializer.Deserialize<TripSnapshot>(row.Json, JsonOptions) ?? NewSnapshot();
        snapshot.Version = row.Version;
        return snapshot;
    }

    internal static async Task<TripDocumentRow?> LockTripAsync(TripDbContext db, string owner, CancellationToken ct)
    {
        // Serialize metadata mutations before touching the unique place-photo row.
        // Refresh earlier reads in this request after acquiring the PostgreSQL lock.
        db.ChangeTracker.Clear();
        return db.Database.IsNpgsql()
            ? await db.Trips.FromSqlInterpolated($"SELECT * FROM \"Trips\" WHERE \"OwnerId\" = {owner} FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.Trips.SingleOrDefaultAsync(x => x.OwnerId == owner, ct);
    }

    private async Task EnrichPhotosAsync(TripSnapshot snapshot, string owner, CancellationToken cancellationToken)
    {
        foreach (var place in snapshot.Places) place.Photo = null;
        if (snapshot.Places.Count == 0) return;
        var ids = snapshot.Places.Select(x => x.Id).ToArray();
        var photos = await db.PlacePhotos.Where(x => x.OwnerId == owner && ids.Contains(x.PlaceId)).ToArrayAsync(cancellationToken);
        foreach (var row in photos)
            if (snapshot.Places.FirstOrDefault(x => x.Id == row.PlaceId) is { } place)
                place.Photo = ToDescriptor(row);
    }

    internal static PhotoDescriptor ToDescriptor(PlacePhotoRow row) => new(
        row.Id,
        $"/api/places/{Uri.EscapeDataString(row.PlaceId)}/photo?v={row.Id:N}",
        row.SourceUrl,
        row.Author,
        row.Caption,
        row.Kind,
        row.License);

    internal static string SerializeForPersistence(TripSnapshot snapshot)
    {
        var node = JsonSerializer.SerializeToNode(snapshot, JsonOptions)!.AsObject();
        if (node["places"] is JsonArray places)
            foreach (var place in places.OfType<JsonObject>()) place.Remove("photo");
        return node.ToJsonString(JsonOptions);
    }

    private static TripSnapshot NewSnapshot() => new() { Version = 1, Trip = new() };

    private static void ValidateAndNormalize(TripSnapshot snapshot)
    {
        snapshot.Places ??= []; snapshot.Stays ??= []; snapshot.TravelLegs ??= []; snapshot.Activities ??= []; snapshot.Bookings ??= []; snapshot.Tasks ??= []; snapshot.PackingItems ??= [];
        foreach (var stay in snapshot.Stays)
            if (stay.CheckOut < stay.CheckIn) throw new ArgumentException("Stay checkout must not precede check-in.");
        foreach (var place in snapshot.Places)
        {
            if (string.IsNullOrWhiteSpace(place.Id) || string.IsNullOrWhiteSpace(place.Name) || string.IsNullOrWhiteSpace(place.City)) throw new ArgumentException("Place id, name, and city are required.");
            ValidateUrl(place.SourceUrl, "place source URL"); ValidateUrl(place.GoogleMapsUrl, "Google Maps URL");
            if (place.Latitude is < -90 or > 90 || place.Longitude is < -180 or > 180) throw new ArgumentException("Place coordinates are invalid.");
            if (place.DurationMinutes is <= 0) throw new ArgumentException("Place duration must be positive.");
        }
        foreach (var leg in snapshot.TravelLegs) if (leg.DurationMinutes is <= 0) throw new ArgumentException("Travel duration must be positive.");
        foreach (var activity in snapshot.Activities) if (activity.DurationMinutes is <= 0) throw new ArgumentException("Activity duration must be positive.");
        foreach (var booking in snapshot.Bookings)
        {
            ValidateUrl(booking.Url, "booking URL");
            if (booking.Start is not null && booking.End is not null && booking.End < booking.Start) throw new ArgumentException("Booking end must not precede start.");
            if (booking.CheckIn is not null && booking.CheckOut is not null && booking.CheckOut < booking.CheckIn) throw new ArgumentException("Booking checkout must not precede check-in.");
        }
        foreach (var item in snapshot.PackingItems) if (item.Quantity < 1) item.Quantity = 1;
    }

    private static void ValidateUrl(string? value, string field)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) throw new ArgumentException($"{field} must be an http or https URL.");
    }
}
