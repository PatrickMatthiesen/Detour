using Microsoft.EntityFrameworkCore;

namespace Detour.Api;

public sealed class PhotoCleanupWorker(IServiceScopeFactory scopes, ILogger<PhotoCleanupWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                timeout.CancelAfter(TimeSpan.FromSeconds(45));
                await DrainAsync(scope.ServiceProvider.GetRequiredService<TripDbContext>(),
                    scope.ServiceProvider.GetRequiredService<IPhotoObjectStore>(), timeout.Token);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogWarning(ex, "Photo cleanup failed; queued objects will be retried"); }
            try { await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }

    public static async Task DrainAsync(TripDbContext db, IPhotoObjectStore objects, CancellationToken ct)
    {
        var pending = await db.PhotoObjectDeletions.Where(x => x.NotBefore <= DateTimeOffset.UtcNow)
            .OrderBy(x => x.NotBefore).Take(50).ToArrayAsync(ct);
        foreach (var item in pending)
        {
            // Also protects against an ambiguous database commit after an upload.
            if (!await db.PlacePhotos.AnyAsync(x => x.ObjectKey == item.ObjectKey, ct))
                await objects.DeleteAsync(item.ObjectKey, ct);
            db.PhotoObjectDeletions.Remove(item);
            await db.SaveChangesAsync(ct);
        }
    }
}
