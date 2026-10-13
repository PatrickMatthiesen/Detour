using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace Detour.Api;

public sealed class CalendarOwnerLock
{
    private readonly ConcurrentDictionary<string, SemaphoreSlim> locks = new(StringComparer.Ordinal);
    public async Task<IDisposable> AcquireAsync(string ownerId, CancellationToken cancellationToken)
    {
        var gate = locks.GetOrAdd(ownerId, _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken);
        return new Releaser(gate);
    }

    private sealed class Releaser(SemaphoreSlim gate) : IDisposable
    {
        public void Dispose() => gate.Release();
    }
}

public sealed record CalendarConnectionStatus(
    bool Configured,
    bool Connected,
    string? CalendarId,
    long? LastSyncedVersion,
    DateTimeOffset? LastSyncedAt,
    string? Error);

public sealed class DetourCalendarService(
    TripDbContext db,
    CalendarOwnerLock ownerLock,
    IDataProtectionProvider dataProtection,
    IGoogleCalendarClient google,
    DetourCalendarOptions options)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly IDataProtector tokenProtector = dataProtection.CreateProtector("Detour.GoogleCalendar.RefreshToken.v1");

    public async Task<CalendarConnectionStatus> GetStatusAsync(string ownerId, CancellationToken cancellationToken = default)
    {
        var row = await db.GoogleCalendarConnections.AsNoTracking().SingleOrDefaultAsync(x => x.OwnerId == ownerId, cancellationToken);
        return ToStatus(row);
    }

    public async Task CompleteAuthorizationAsync(
        string ownerId,
        string googleSubject,
        string refreshToken,
        string accessToken,
        string grantedScopes,
        CancellationToken cancellationToken = default)
    {
        if (!options.Configured) throw new InvalidOperationException("Google Calendar is not configured.");
        if (!HasCalendarScope(grantedScopes))
            throw new CalendarReauthorizationException("Google Calendar permission was not granted. Reconnect and approve calendar access.");
        if (string.IsNullOrWhiteSpace(refreshToken))
            throw new CalendarReauthorizationException("Google did not provide offline access. Reconnect and approve calendar access.");
        if (string.IsNullOrWhiteSpace(googleSubject)) throw new CalendarReauthorizationException("Google did not identify the connected account.");
        if (!await db.Users.AsNoTracking().AnyAsync(x => x.Id == ownerId, cancellationToken))
            throw new UnauthorizedAccessException();

        using var held = await ownerLock.AcquireAsync(ownerId, cancellationToken);
        var row = await db.GoogleCalendarConnections.SingleOrDefaultAsync(x => x.OwnerId == ownerId, cancellationToken);
        if (row is null)
        {
            row = new GoogleCalendarConnectionRow
            {
                OwnerId = ownerId,
                GoogleSubject = googleSubject
            };
            db.GoogleCalendarConnections.Add(row);
        }
        else if (!string.Equals(row.GoogleSubject, googleSubject, StringComparison.Ordinal))
        {
            throw new CalendarReauthorizationException("This Detour connection belongs to another Google account. Disconnect it before connecting a different account.");
        }
        row.EncryptedRefreshToken = tokenProtector.Protect(refreshToken);
        row.GrantedScopes = grantedScopes;
        row.ReauthorizationRequired = false;
        row.Error = null;
        row.FailureCount = 0;
        row.NextAttemptAt = null;
        row.SyncRequestedAt = DateTimeOffset.UtcNow;
        row.UpdatedAt = DateTimeOffset.UtcNow;
        row.Revision = Guid.NewGuid();
        await db.SaveChangesAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(row.CalendarId))
            await CreateCalendarOnceAsync(row, accessToken, cancellationToken);
    }

    public async Task<CalendarConnectionStatus> RequestSyncAsync(string ownerId, CancellationToken cancellationToken = default)
    {
        using var held = await ownerLock.AcquireAsync(ownerId, cancellationToken);
        var row = await db.GoogleCalendarConnections.SingleOrDefaultAsync(x => x.OwnerId == ownerId, cancellationToken);
        if (row is null) return ToStatus(null);
        row.SyncRequestedAt = DateTimeOffset.UtcNow;
        row.NextAttemptAt = null;
        row.Error = row.ReauthorizationRequired ? row.Error : null;
        row.UpdatedAt = DateTimeOffset.UtcNow;
        row.Revision = Guid.NewGuid();
        await db.SaveChangesAsync(cancellationToken);
        return ToStatus(row);
    }

    public async Task DisconnectAsync(string ownerId, CancellationToken cancellationToken = default)
    {
        using var held = await ownerLock.AcquireAsync(ownerId, cancellationToken);
        var connection = await db.GoogleCalendarConnections.SingleOrDefaultAsync(x => x.OwnerId == ownerId, cancellationToken);
        var events = await db.GoogleCalendarManagedEvents.Where(x => x.OwnerId == ownerId).ToArrayAsync(cancellationToken);
        if (connection is not null) db.GoogleCalendarConnections.Remove(connection);
        if (events.Length > 0) db.GoogleCalendarManagedEvents.RemoveRange(events);
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task SyncOwnerAsync(string ownerId, CancellationToken cancellationToken = default)
    {
        using var held = await ownerLock.AcquireAsync(ownerId, cancellationToken);
        db.ChangeTracker.Clear();
        var connection = await db.GoogleCalendarConnections.SingleOrDefaultAsync(x => x.OwnerId == ownerId, cancellationToken);
        if (connection is null || connection.ReauthorizationRequired) return;
        var trip = await db.Trips.AsNoTracking().SingleOrDefaultAsync(x => x.OwnerId == ownerId, cancellationToken);
        if (trip is null) return;
        if (connection.LastSyncedVersion == trip.Version && connection.SyncRequestedAt is null) return;
        if (connection.NextAttemptAt is { } next && next > DateTimeOffset.UtcNow) return;

        try
        {
            var refreshToken = tokenProtector.Unprotect(connection.EncryptedRefreshToken);
            var accessToken = await google.RefreshAccessTokenAsync(refreshToken, cancellationToken);
            if (string.IsNullOrWhiteSpace(connection.CalendarId))
                await CreateCalendarOnceAsync(connection, accessToken, cancellationToken);

            var snapshot = JsonSerializer.Deserialize<TripSnapshot>(trip.Json, JsonOptions)
                ?? throw new InvalidOperationException("The saved trip could not be read.");
            snapshot.Version = trip.Version;
            var projected = GoogleCalendarProjection.Build(snapshot);
            var tracked = await db.GoogleCalendarManagedEvents
                .Where(x => x.OwnerId == ownerId)
                .ToDictionaryAsync(x => x.LocalKey, StringComparer.Ordinal, cancellationToken);

            foreach (var (localKey, body) in projected)
            {
                var eventId = StableEventId(localKey);
                await google.UpsertEventAsync(accessToken, connection.CalendarId!, eventId, body, cancellationToken);
                if (!tracked.TryGetValue(localKey, out var managed))
                {
                    db.GoogleCalendarManagedEvents.Add(new GoogleCalendarManagedEventRow
                    {
                        OwnerId = ownerId,
                        LocalKey = localKey,
                        GoogleEventId = eventId
                    });
                }
                else if (!string.Equals(managed.GoogleEventId, eventId, StringComparison.Ordinal))
                {
                    managed.GoogleEventId = eventId;
                }
            }

            foreach (var stale in tracked.Values.Where(x => !projected.ContainsKey(x.LocalKey)))
            {
                await google.DeleteEventAsync(accessToken, connection.CalendarId!, stale.GoogleEventId, cancellationToken);
                db.GoogleCalendarManagedEvents.Remove(stale);
            }

            connection.LastSyncedVersion = trip.Version;
            connection.LastSyncedAt = DateTimeOffset.UtcNow;
            connection.SyncRequestedAt = null;
            connection.NextAttemptAt = null;
            connection.FailureCount = 0;
            connection.Error = null;
            connection.ReauthorizationRequired = false;
            connection.UpdatedAt = DateTimeOffset.UtcNow;
            connection.Revision = Guid.NewGuid();
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (CalendarReauthorizationException ex)
        {
            await RecordFailureAsync(connection, ex.Message, true, cancellationToken);
        }
        catch (CryptographicException)
        {
            await RecordFailureAsync(connection, "The saved Google Calendar credential can no longer be decrypted. Reconnect Google Calendar in Detour.", true, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            await RecordFailureAsync(connection, "Google Calendar timed out. Detour will retry automatically.", false, cancellationToken);
        }
        catch (Exception ex) when (ex is CalendarRemoteException or HttpRequestException or TimeoutException or JsonException or ArgumentException or InvalidOperationException)
        {
            var message = ex is CalendarRemoteException remote ? remote.Message : $"Calendar sync failed: {ex.Message}";
            await RecordFailureAsync(connection, message, false, cancellationToken);
        }
    }

    private async Task RecordFailureAsync(GoogleCalendarConnectionRow connection, string error, bool reauthorizationRequired, CancellationToken cancellationToken)
    {
        connection.Error = error.Length <= 1000 ? error : error[..1000];
        connection.ReauthorizationRequired = reauthorizationRequired;
        connection.FailureCount++;
        connection.NextAttemptAt = reauthorizationRequired
            ? null
            : DateTimeOffset.UtcNow.AddMinutes(Math.Min(60, 1 << Math.Min(connection.FailureCount - 1, 5)));
        connection.UpdatedAt = DateTimeOffset.UtcNow;
        connection.Revision = Guid.NewGuid();
        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task CreateCalendarOnceAsync(GoogleCalendarConnectionRow connection, string accessToken, CancellationToken cancellationToken)
    {
        if (connection.CalendarCreationAttempted)
            throw new CalendarRemoteException("Detour could not confirm whether Google created the calendar. Disconnect before reconnecting so Detour does not create duplicates.");
        connection.CalendarCreationAttempted = true;
        connection.UpdatedAt = DateTimeOffset.UtcNow;
        connection.Revision = Guid.NewGuid();
        await db.SaveChangesAsync(cancellationToken);
        try
        {
            connection.CalendarId = await google.CreateCalendarAsync(accessToken, cancellationToken);
            connection.Error = null;
            connection.UpdatedAt = DateTimeOffset.UtcNow;
            connection.Revision = Guid.NewGuid();
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (CalendarRemoteException ex)
        {
            if (!ex.Transient) connection.CalendarCreationAttempted = false;
            connection.Error = ex.Message;
            connection.UpdatedAt = DateTimeOffset.UtcNow;
            connection.Revision = Guid.NewGuid();
            await db.SaveChangesAsync(cancellationToken);
            throw;
        }
        catch (CalendarReauthorizationException ex)
        {
            connection.CalendarCreationAttempted = false;
            connection.ReauthorizationRequired = true;
            connection.Error = ex.Message;
            connection.UpdatedAt = DateTimeOffset.UtcNow;
            connection.Revision = Guid.NewGuid();
            await db.SaveChangesAsync(cancellationToken);
            throw;
        }
    }

    private CalendarConnectionStatus ToStatus(GoogleCalendarConnectionRow? row) => new(
        options.Configured,
        row is not null && !row.ReauthorizationRequired && !string.IsNullOrWhiteSpace(row.CalendarId),
        row?.CalendarId,
        row?.LastSyncedVersion,
        row?.LastSyncedAt,
        row?.Error);

    internal static bool HasCalendarScope(string? scopes)
        => (scopes ?? "").Split([' ', ','], StringSplitOptions.RemoveEmptyEntries).Contains(DetourCalendarOptions.Scope, StringComparer.Ordinal);

    internal static string StableEventId(string localKey)
        => "detour" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(localKey))).ToLowerInvariant();
}
