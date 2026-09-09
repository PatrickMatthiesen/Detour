using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Detour.Api;

public sealed class TripService(TripDbContext db, OwnerAccessor ownerAccessor)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<TripSnapshot> GetSnapshotAsync(CancellationToken cancellationToken = default)
    {
        var owner = ownerAccessor.OwnerId;
        var row = await db.Trips.SingleOrDefaultAsync(x => x.OwnerId == owner, cancellationToken);
        if (row is null)
        {
            var snapshot = NewSnapshot();
            row = new TripDocumentRow { Id = Guid.NewGuid(), OwnerId = owner, Version = 1, Json = JsonSerializer.Serialize(snapshot, JsonOptions), UpdatedAt = DateTimeOffset.UtcNow };
            await db.Trips.AddAsync(row, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
            snapshot.Version = row.Version;
            return snapshot;
        }
        return Read(row);
    }

    public async Task<ReplaceResult> ReplaceAsync(TripSnapshot input, long expectedVersion, CancellationToken cancellationToken = default)
    {
        if (expectedVersion < 0 || input.Trip is null || input.Trip.StartDate > input.Trip.EndDate) return new ReplaceResult.Invalid();
        var owner = ownerAccessor.OwnerId;
        var row = await db.Trips.SingleOrDefaultAsync(x => x.OwnerId == owner, cancellationToken);
        if (row is null) return new ReplaceResult.Conflict(NewSnapshot());
        if (row.Version != expectedVersion) return new ReplaceResult.Conflict(Read(row));
        try { ValidateAndNormalize(input); }
        catch (ArgumentException) { return new ReplaceResult.Invalid(); }
        input.Version = expectedVersion + 1;
        row.Version = input.Version;
        row.Json = JsonSerializer.Serialize(input, JsonOptions);
        row.UpdatedAt = DateTimeOffset.UtcNow;
        try { await db.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateConcurrencyException)
        {
            // Reset tracked values too, so another tool call in this scope reads the winner.
            await db.Entry(row).ReloadAsync(cancellationToken);
            return new ReplaceResult.Conflict(Read(row));
        }
        return new ReplaceResult.Success(input);
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
        var row = new TripDocumentRow { Id = Guid.NewGuid(), OwnerId = ownerId, Version = snapshot.Version, Json = JsonSerializer.Serialize(snapshot, JsonOptions), UpdatedAt = DateTimeOffset.UtcNow };
        await db.Trips.AddAsync(row, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
    }

    private static TripSnapshot Read(TripDocumentRow row)
    {
        var snapshot = JsonSerializer.Deserialize<TripSnapshot>(row.Json, JsonOptions) ?? NewSnapshot();
        snapshot.Version = row.Version;
        return snapshot;
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
