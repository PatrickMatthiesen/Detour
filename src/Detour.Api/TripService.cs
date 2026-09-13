using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;

namespace Detour.Api;

public sealed class TripService(TripDbContext db, OwnerAccessor ownerAccessor, PhotoImportService? photoImports = null, GoogleMapsCoordinates? coordinates = null, GooglePlacesClient? placesClient = null)
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
        await EnrichLocationsAsync(loaded, owner, cancellationToken, refresh: true);
        await EnrichPhotosAsync(loaded, owner, cancellationToken);
        return loaded;
    }

    public async Task<ReplaceResult> ReplaceAsync(TripSnapshot input, long expectedVersion, CancellationToken cancellationToken = default)
    {
        if (expectedVersion < 0 || input.Trip is null || input.Trip.StartDate > input.Trip.EndDate) return new ReplaceResult.Invalid();
        var owner = ownerAccessor.OwnerId;
        try { ValidateAndNormalize(input); }
        catch (ArgumentException exception) { return new ReplaceResult.Invalid(exception.Message); }
        var before = await db.Trips.AsNoTracking().SingleOrDefaultAsync(x => x.OwnerId == owner, cancellationToken);
        if (before is null) return new ReplaceResult.Conflict(NewSnapshot());
        if (before.Version != expectedVersion)
        {
            var current = Read(before);
            await EnrichPhotosAsync(current, owner, cancellationToken);
            return new ReplaceResult.Conflict(current);
        }
        var previous = Read(before);
        Dictionary<string, GooglePlaceLocationRow> locations;
        try
        {
            locations = await NormalizeCoordinatesAsync(input, previous, owner, cancellationToken);
            StayCityValidator.Validate(input, previous);
        }
        catch (ArgumentException exception) { return new ReplaceResult.Invalid(exception.Message); }
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
        var existingLocations = await db.GooglePlaceLocations.Where(x => x.OwnerId == owner).ToArrayAsync(timeout.Token);
        foreach (var existing in existingLocations)
        {
            if (!locations.Remove(existing.PlaceId, out var replacement)) db.GooglePlaceLocations.Remove(existing);
            else if (replacement.MapsUrl != existing.MapsUrl || replacement.ExpiresAt > existing.ExpiresAt)
                db.Entry(existing).CurrentValues.SetValues(replacement);
        }
        db.GooglePlaceLocations.AddRange(locations.Values);
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
        await EnrichLocationsAsync(saved, owner, timeout.Token);
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
        foreach (var place in snapshot.Places)
            if (!GoogleMapsCoordinates.IsValid(place.Latitude, place.Longitude)
                && GoogleMapsCoordinates.Parse(place.GoogleMapsUrl) is { } point)
                (place.Latitude, place.Longitude) = (point.Latitude, point.Longitude);
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
        await EnrichLocationsAsync(snapshot, owner, cancellationToken);
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
            foreach (var place in places.OfType<JsonObject>())
            {
                place.Remove("photo");
                place.Remove("coordinatesFromGoogle");
                place.Remove("resolveCoordinates");
                if (snapshot.Places.Any(p => p.Id == place["id"]?.GetValue<string>() && p.CoordinatesFromGoogle))
                {
                    place.Remove("latitude");
                    place.Remove("longitude");
                }
            }
        return node.ToJsonString(JsonOptions);
    }

    private async Task<Dictionary<string, GooglePlaceLocationRow>> NormalizeCoordinatesAsync(TripSnapshot input, TripSnapshot previous, string owner, CancellationToken ct)
    {
        var cached = await db.GooglePlaceLocations.AsNoTracking().Where(x => x.OwnerId == owner).ToDictionaryAsync(x => x.PlaceId, ct);
        var retained = new Dictionary<string, GooglePlaceLocationRow>();
        foreach (var old in previous.Places)
            if (cached.TryGetValue(old.Id, out var stored) && stored.MapsUrl == old.GoogleMapsUrl)
            {
                old.CoordinatesFromGoogle = true;
                old.Latitude = old.Longitude = null;
                if (stored.ExpiresAt > DateTimeOffset.UtcNow)
                    (old.Latitude, old.Longitude) = (stored.Latitude, stored.Longitude);
            }
        foreach (var place in input.Places)
        {
            var echoedGoogleCoordinates = place.CoordinatesFromGoogle;
            var retryLocation = place.ResolveCoordinates && !GoogleMapsCoordinates.IsValid(place.Latitude, place.Longitude);
            place.ResolveCoordinates = false;
            place.CoordinatesFromGoogle = false;
            var old = previous.Places.FirstOrDefault(p => p.Id == place.Id);
            var urlChanged = old?.GoogleMapsUrl != place.GoogleMapsUrl;
            if (urlChanged && echoedGoogleCoordinates && old?.CoordinatesFromGoogle == true)
                place.Latitude = place.Longitude = null;
            var coordinatesChanged = old?.Latitude != place.Latitude || old?.Longitude != place.Longitude;
            if (old?.CoordinatesFromGoogle == true && !retryLocation && !urlChanged && (!coordinatesChanged || echoedGoogleCoordinates))
            {
                place.CoordinatesFromGoogle = true;
                retained.Add(place.Id, cached[place.Id]);
                (place.Latitude, place.Longitude) = (old.Latitude, old.Longitude);
                continue;
            }
            var requiresLocation = retryLocation || old is null || urlChanged || coordinatesChanged
                || old.Name != place.Name || old.City != place.City || old.Area != place.Area
                || GoogleMapsCoordinates.IsValid(old.Latitude, old.Longitude);
            // A new location URL must not silently retain coordinates from the previous URL.
            var needsResolution = !GoogleMapsCoordinates.IsValid(place.Latitude, place.Longitude)
                || urlChanged && !coordinatesChanged;
            if (needsResolution)
            {
                var point = GoogleMapsCoordinates.Parse(place.GoogleMapsUrl);
                if (point is null && requiresLocation && coordinates is not null)
                    point = await coordinates.ResolveAsync(place.GoogleMapsUrl, ct);
                if (point is { } resolved)
                {
                    if (retryLocation && !urlChanged && old?.CoordinatesFromGoogle == true
                        && resolved.GooglePlaceId != cached[place.Id].GooglePlaceId)
                        throw new ArgumentException($"The Google Maps search for '{place.Name}' now matches a different place. Check its Maps URL or provide verified coordinates.");
                    (place.Latitude, place.Longitude) = (resolved.Latitude, resolved.Longitude);
                    if (resolved.GooglePlaceId is { } googleId && resolved.Query is { } query)
                    {
                        place.CoordinatesFromGoogle = true;
                        retained.Add(place.Id, new GooglePlaceLocationRow
                        {
                            OwnerId = owner, PlaceId = place.Id, MapsUrl = place.GoogleMapsUrl!, Query = query,
                            GooglePlaceId = googleId, Latitude = resolved.Latitude, Longitude = resolved.Longitude,
                            ExpiresAt = DateTimeOffset.UtcNow.AddDays(29)
                        });
                    }
                }
                else if (urlChanged && !coordinatesChanged && !string.IsNullOrWhiteSpace(place.GoogleMapsUrl))
                    throw new ArgumentException($"Place '{place.Name}' needs verified latitude and longitude for the new Google Maps URL. The link did not resolve a place location.");
            }
            if (requiresLocation && !GoogleMapsCoordinates.IsValid(place.Latitude, place.Longitude))
                throw new ArgumentException($"Place '{place.Name}' requires latitude and longitude, or a Google Maps link that resolves to one place. Text searches need the server's Google Places API key. Map-view links need separately verified coordinates. Do not guess.");
        }
        return retained;
    }

    private async Task EnrichLocationsAsync(TripSnapshot snapshot, string owner, CancellationToken ct, bool refresh = false)
    {
        var cached = await db.GooglePlaceLocations.AsNoTracking().Where(x => x.OwnerId == owner).ToArrayAsync(ct);
        foreach (var row in cached)
        {
            var place = snapshot.Places.FirstOrDefault(p => p.Id == row.PlaceId && p.GoogleMapsUrl == row.MapsUrl);
            if (place is null) continue;
            place.CoordinatesFromGoogle = true;
            place.Latitude = place.Longitude = null;
            if (row.ExpiresAt <= DateTimeOffset.UtcNow && row.RefreshAfter <= DateTimeOffset.UtcNow && refresh && placesClient is not null)
            {
                // Reserve one refresh attempt. Failures and concurrent reads cannot hammer the paid API.
                row.Latitude = row.Longitude = null;
                row.RefreshAfter = DateTimeOffset.UtcNow.AddMinutes(15);
                if (!await UpdateCachedLocationAsync(row, ct)) continue;
                // Refresh only the same Google place. A changed search result needs user review.
                try
                {
                    var resolved = await placesClient.SearchAsync(row.Query, ct);
                    if (resolved.GooglePlaceId == row.GooglePlaceId)
                    {
                        row.Latitude = resolved.Latitude;
                        row.Longitude = resolved.Longitude;
                        row.ExpiresAt = DateTimeOffset.UtcNow.AddDays(29);
                        if (!await UpdateCachedLocationAsync(row, ct)) continue;
                    }
                }
                catch (ArgumentException) { /* Keep the trip readable during lookup failures. */ }
            }
            if (row.ExpiresAt > DateTimeOffset.UtcNow)
                (place.Latitude, place.Longitude) = (row.Latitude, row.Longitude);
        }
    }

    private async Task<bool> UpdateCachedLocationAsync(GooglePlaceLocationRow row, CancellationToken ct)
    {
        var originalRevision = row.Revision;
        row.Revision = Guid.NewGuid();
        if (db.Database.IsRelational())
            return await db.GooglePlaceLocations.Where(x => x.OwnerId == row.OwnerId && x.PlaceId == row.PlaceId && x.Revision == originalRevision)
                .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.Latitude, row.Latitude)
                    .SetProperty(x => x.Longitude, row.Longitude).SetProperty(x => x.ExpiresAt, row.ExpiresAt)
                    .SetProperty(x => x.RefreshAfter, row.RefreshAfter).SetProperty(x => x.Revision, row.Revision), ct) == 1;
        var tracked = db.GooglePlaceLocations.Local.FirstOrDefault(x => x.OwnerId == row.OwnerId && x.PlaceId == row.PlaceId);
        if (tracked is not null) db.Entry(tracked).State = EntityState.Detached;
        var entry = db.Attach(row);
        entry.State = EntityState.Modified;
        entry.Property(x => x.Revision).OriginalValue = originalRevision;
        try { await db.SaveChangesAsync(ct); return true; }
        catch (DbUpdateConcurrencyException) { return false; }
        finally { entry.State = EntityState.Detached; }
    }

    private static TripSnapshot NewSnapshot() => new() { Version = 1, Trip = new() };

    private static void ValidateAndNormalize(TripSnapshot snapshot)
    {
        snapshot.Places ??= []; snapshot.Stays ??= []; snapshot.TravelLegs ??= []; snapshot.Activities ??= []; snapshot.Bookings ??= []; snapshot.Tasks ??= []; snapshot.PackingItems ??= [];
        if (snapshot.Places.Select(x => x.Id).Distinct(StringComparer.Ordinal).Count() != snapshot.Places.Count)
            throw new ArgumentException("Place IDs must be unique.");
        foreach (var stay in snapshot.Stays)
        {
            stay.City = stay.City?.Trim() ?? "";
            if (stay.CheckOut < stay.CheckIn) throw new ArgumentException("Stay checkout must not precede check-in.");
        }
        foreach (var place in snapshot.Places)
        {
            if (string.IsNullOrWhiteSpace(place.Id) || string.IsNullOrWhiteSpace(place.Name) || string.IsNullOrWhiteSpace(place.City)) throw new ArgumentException("Place id, name, and city are required.");
            place.GoogleMapsUrl = GoogleMapsCoordinates.NormalizeUrl(place.GoogleMapsUrl);
            if (place.Id.Length > 200 || place.GoogleMapsUrl?.Length > 2048) throw new ArgumentException("Place ID or Google Maps URL is too long.");
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
