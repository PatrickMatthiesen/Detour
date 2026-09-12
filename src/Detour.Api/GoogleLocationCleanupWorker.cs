using Microsoft.EntityFrameworkCore;

namespace Detour.Api;

public sealed class GoogleLocationCleanupWorker(IServiceScopeFactory scopes, ILogger<GoogleLocationCleanupWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                await PruneAsync(scope.ServiceProvider.GetRequiredService<TripDbContext>(), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogWarning(ex, "Expired Google coordinates could not be cleared"); }
            try { await Task.Delay(TimeSpan.FromHours(1), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
        }
    }

    public static async Task PruneAsync(TripDbContext db, CancellationToken ct = default)
    {
        var expired = db.GooglePlaceLocations.Where(x => x.ExpiresAt <= DateTimeOffset.UtcNow && (x.Latitude != null || x.Longitude != null));
        if (db.Database.IsRelational())
            await expired.ExecuteUpdateAsync(setters => setters.SetProperty(x => x.Latitude, (double?)null)
                .SetProperty(x => x.Longitude, (double?)null).SetProperty(x => x.Revision, Guid.NewGuid()), ct);
        else
        {
            foreach (var row in await expired.ToArrayAsync(ct))
            {
                row.Latitude = row.Longitude = null;
                row.Revision = Guid.NewGuid();
            }
            await db.SaveChangesAsync(ct);
        }
    }
}
