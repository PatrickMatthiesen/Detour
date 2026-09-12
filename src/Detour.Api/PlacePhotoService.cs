using Microsoft.EntityFrameworkCore;

namespace Detour.Api;

public sealed record PhotoOperationResult(bool Success, long Version, PhotoDescriptor? Photo, string? Error, string? Message);

public sealed class PlacePhotoService(
    TripDbContext db,
    OwnerAccessor ownerAccessor,
    TripService trips,
    IPhotoObjectStore objects,
    ILogger<PlacePhotoService> logger)
{
    private static readonly string[] Kinds = ["place", "neighbourhood", "illustrative"];

    public async Task<PhotoOperationResult> ImportUploadedAsync(string placeId, Stream content, string? sourceUrl, string? author, string? caption, string? kind, string? license, long expectedVersion, CancellationToken ct)
    {
        var current = await trips.GetSnapshotAsync(ct);
        var place = current.Places.FirstOrDefault(x => x.Id == placeId);
        if (place is null) return Failure(current.Version, "not_found", $"Place '{placeId}' was not found.");
        if (current.Version != expectedVersion) return Failure(current.Version, "version_conflict", "The trip changed. Re-read it and retry with the current version.", place.Photo);
        if (!string.IsNullOrWhiteSpace(sourceUrl))
            try { PhotoDownloader.ValidateUri(sourceUrl); } catch (InvalidOperationException ex) { return Failure(current.Version, "invalid_source_url", ex.Message, place.Photo); }
        kind = string.IsNullOrWhiteSpace(kind) ? "place" : kind.Trim().ToLowerInvariant();
        if (!Kinds.Contains(kind, StringComparer.Ordinal)) return Failure(current.Version, "invalid_kind", "kind must be place, neighbourhood, or illustrative.", place.Photo);
        if (sourceUrl?.Length > 2048 || caption?.Length > 500 || author?.Length > 500 || license?.Length > 500) return Failure(current.Version, "invalid_metadata", "Photo metadata is too long.", place.Photo);
        using var downloaded = await PhotoDownloader.NormalizeAsync(content, ct);
        return await StoreDownloadedAsync(placeId, sourceUrl, author, caption, kind, license, expectedVersion, downloaded, ct);
    }

    private async Task<PhotoOperationResult> StoreDownloadedAsync(string placeId, string? sourceUrl, string? author, string? caption, string? kind, string? license, long expectedVersion, DownloadedPhoto downloaded, CancellationToken ct)
    {
        var photoId = Guid.NewGuid();
        var objectKey = $"places/{ownerAccessor.OwnerId}/{placeId}/{photoId:N}.jpg";
        // Reserve cleanup before uploading, so interrupted requests do not leak objects.
        // This exceeds the bounded upload/commit deadline below.
        db.PhotoObjectDeletions.Add(new PhotoObjectDeletion { ObjectKey = objectKey, NotBefore = DateTimeOffset.UtcNow.AddHours(1) });
        await db.SaveChangesAsync(ct);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMinutes(2));
        try
        {
            await objects.PutAsync(objectKey, downloaded.Content, downloaded.ContentType, downloaded.Length, timeout.Token);
            var result = await CommitAsync(placeId, expectedVersion, photoId, objectKey, downloaded.ContentType, downloaded.Length, sourceUrl, author, caption, kind!, license, timeout.Token);
            return result.Result;
        }
        catch
        {
            logger.LogWarning("Photo import did not complete; any unreferenced upload is queued for cleanup");
            throw;
        }
    }

    public async Task<PhotoOperationResult> RemoveAsync(string placeId, long expectedVersion, CancellationToken ct)
    {
        var current = await trips.GetSnapshotAsync(ct);
        var place = current.Places.FirstOrDefault(x => x.Id == placeId);
        if (place is null) return Failure(current.Version, "not_found", $"Place '{placeId}' was not found.");
        if (current.Version != expectedVersion) return Failure(current.Version, "version_conflict", "The trip changed. Re-read it and retry with the current version.", place.Photo);
        var existing = await db.PlacePhotos.SingleOrDefaultAsync(x => x.OwnerId == ownerAccessor.OwnerId && x.PlaceId == placeId, ct);
        if (existing is null) return new PhotoOperationResult(true, current.Version, null, null, null);
        var result = await CommitRemoveAsync(placeId, expectedVersion, existing, ct);
        return result.Result;
    }

    public async Task<PhotoObject?> OpenAsync(string placeId, Guid photoId, CancellationToken ct)
    {
        var row = await db.PlacePhotos.SingleOrDefaultAsync(x => x.OwnerId == ownerAccessor.OwnerId && x.PlaceId == placeId && x.Id == photoId, ct);
        return row is null ? null : await objects.GetAsync(row.ObjectKey, ct);
    }

    private async Task<(PhotoOperationResult Result, string? ReplacedObjectKey)> CommitAsync(string placeId, long expectedVersion, Guid photoId, string objectKey, string contentType, long length, string? sourceUrl, string? author, string? caption, string kind, string? license, CancellationToken ct)
    {
        await using var transaction = db.Database.ProviderName?.Contains("InMemory", StringComparison.OrdinalIgnoreCase) == true ? null : await db.Database.BeginTransactionAsync(ct);
        var owner = ownerAccessor.OwnerId;
        var trip = (await TripService.LockTripAsync(db, owner, ct))!;
        if (trip.Version != expectedVersion) return (Failure(trip.Version, "version_conflict", "The trip changed. Re-read it and retry with the current version."), null);
        var old = await db.PlacePhotos.SingleOrDefaultAsync(x => x.OwnerId == owner && x.PlaceId == placeId, ct);
        var now = DateTimeOffset.UtcNow;
        if (old is not null)
        {
            db.PlacePhotos.Remove(old);
            db.PhotoObjectDeletions.Add(new PhotoObjectDeletion { ObjectKey = old.ObjectKey, NotBefore = now });
        }
        var reservation = await db.PhotoObjectDeletions.SingleAsync(x => x.ObjectKey == objectKey, ct);
        db.PhotoObjectDeletions.Remove(reservation);
        var newRow = new PlacePhotoRow { Id = photoId, OwnerId = owner, PlaceId = placeId, ObjectKey = objectKey, ContentType = contentType, Length = length, SourceUrl = sourceUrl, Author = author, Caption = caption, Kind = kind, License = license, CreatedAt = now, UpdatedAt = now };
        db.PlacePhotos.Add(newRow);
        trip.Version = expectedVersion + 1; trip.UpdatedAt = now;
        try { await db.SaveChangesAsync(ct); if (transaction is not null) await transaction.CommitAsync(ct); }
        catch (DbUpdateConcurrencyException)
        {
            if (transaction is not null) await transaction.RollbackAsync(ct);
            db.ChangeTracker.Clear();
            var actual = await db.Trips.AsNoTracking().SingleAsync(x => x.OwnerId == owner, ct);
            return (Failure(actual.Version, "version_conflict", "The trip changed. Re-read it and retry with the current version."), null);
        }
        return (new PhotoOperationResult(true, trip.Version, TripService.ToDescriptor(newRow), null, null), old?.ObjectKey);
    }

    private async Task<(PhotoOperationResult Result, string? ReplacedObjectKey)> CommitRemoveAsync(string placeId, long expectedVersion, PlacePhotoRow existing, CancellationToken ct)
    {
        await using var transaction = db.Database.ProviderName?.Contains("InMemory", StringComparison.OrdinalIgnoreCase) == true ? null : await db.Database.BeginTransactionAsync(ct);
        var trip = (await TripService.LockTripAsync(db, ownerAccessor.OwnerId, ct))!;
        if (trip.Version != expectedVersion) return (Failure(trip.Version, "version_conflict", "The trip changed. Re-read it and retry with the current version."), null);
        existing = await db.PlacePhotos.SingleAsync(x => x.OwnerId == ownerAccessor.OwnerId && x.PlaceId == placeId, ct);
        db.PhotoObjectDeletions.Add(new PhotoObjectDeletion { ObjectKey = existing.ObjectKey, NotBefore = DateTimeOffset.UtcNow });
        db.PlacePhotos.Remove(existing); trip.Version = expectedVersion + 1; trip.UpdatedAt = DateTimeOffset.UtcNow;
        try { await db.SaveChangesAsync(ct); if (transaction is not null) await transaction.CommitAsync(ct); }
        catch (DbUpdateConcurrencyException)
        {
            if (transaction is not null) await transaction.RollbackAsync(ct);
            db.ChangeTracker.Clear();
            var actual = await db.Trips.AsNoTracking().SingleAsync(x => x.OwnerId == ownerAccessor.OwnerId, ct);
            return (Failure(actual.Version, "version_conflict", "The trip changed. Re-read it and retry with the current version."), null);
        }
        return (new PhotoOperationResult(true, trip.Version, null, null, null), existing.ObjectKey);
    }

    private static PhotoOperationResult Failure(long version, string error, string message, PhotoDescriptor? photo = null) => new(false, version, photo, error, message);

}
