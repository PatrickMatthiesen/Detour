using Microsoft.EntityFrameworkCore;

namespace Detour.Api;

public sealed class GoogleCalendarSyncWorker(IServiceScopeFactory scopes, ILogger<GoogleCalendarSyncWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex)
            {
                logger.LogError(ex, "Google Calendar background sync cycle failed.");
            }
            await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
        }
    }

    internal async Task RunOnceAsync(CancellationToken cancellationToken)
    {
        string[] owners;
        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TripDbContext>();
            var now = DateTimeOffset.UtcNow;
            owners = await db.GoogleCalendarConnections.AsNoTracking()
                .Where(x => !x.ReauthorizationRequired && (x.NextAttemptAt == null || x.NextAttemptAt <= now))
                .Where(x => x.FailureCount == 0 || x.NextAttemptAt != null)
                .Where(x => x.SyncRequestedAt != null || db.Trips.Any(t => t.OwnerId == x.OwnerId && t.Version != x.LastSyncedVersion))
                .Select(x => x.OwnerId)
                .ToArrayAsync(cancellationToken);
        }
        foreach (var owner in owners)
        {
            using var scope = scopes.CreateScope();
            await scope.ServiceProvider.GetRequiredService<DetourCalendarService>().SyncOwnerAsync(owner, cancellationToken);
        }
    }
}
