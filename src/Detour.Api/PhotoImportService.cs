namespace Detour.Api;

// Upload before taking the trip lock; publish its metadata with the place edit.
public sealed class PhotoImportService(TripDbContext db, PhotoDownloader downloader, IPhotoObjectStore objects)
{
    public async Task<PlacePhotoRow> StageAsync(string owner, Place place, CancellationToken ct)
    {
        var photo = place.Photo!;
        var kind = string.IsNullOrWhiteSpace(photo.Kind) ? "place" : photo.Kind.Trim().ToLowerInvariant();
        if (kind is not ("place" or "neighbourhood" or "illustrative"))
            throw new PhotoImportException("invalid_photo", "Photo kind must be place, neighbourhood, or illustrative.");
        if (photo.SourceUrl?.Length > 2048 || photo.Author?.Length > 500 || photo.Caption?.Length > 500 || photo.License?.Length > 500)
            throw new PhotoImportException("invalid_photo", "Photo metadata is too long.");
        if (!string.IsNullOrWhiteSpace(photo.SourceUrl)) PhotoDownloader.ValidateUri(photo.SourceUrl);
        using var downloaded = await downloader.DownloadAsync(photo.Url, ct);
        var now = DateTimeOffset.UtcNow;
        var id = Guid.NewGuid();
        var row = new PlacePhotoRow
        {
            Id = id, OwnerId = owner, PlaceId = place.Id,
            ObjectKey = $"places/{owner}/{place.Id}/{id:N}.jpg",
            ContentType = downloaded.ContentType, Length = downloaded.Length,
            SourceUrl = photo.SourceUrl, Author = photo.Author, Caption = photo.Caption,
            Kind = kind, License = photo.License, CreatedAt = now, UpdatedAt = now
        };
        db.PhotoObjectDeletions.Add(new PhotoObjectDeletion { ObjectKey = row.ObjectKey, NotBefore = now.AddHours(1) });
        await db.SaveChangesAsync(ct);
        await objects.PutAsync(row.ObjectKey, downloaded.Content, downloaded.ContentType, downloaded.Length, ct);
        return row;
    }
}
