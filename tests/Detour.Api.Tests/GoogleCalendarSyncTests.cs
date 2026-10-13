using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using Detour.Api;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Detour.Api.Tests;

public sealed class GoogleCalendarSyncTests
{
    [Theory]
    [InlineData(null, "secret")]
    [InlineData("client", null)]
    public async Task Persisted_connection_is_unavailable_when_deployment_credentials_are_missing(string? clientId, string? clientSecret)
    {
        await using var db = CreateDb();
        db.GoogleCalendarConnections.Add(new GoogleCalendarConnectionRow
        {
            OwnerId = "owner-1", GoogleSubject = "google-subject-1",
            CalendarId = "detour-calendar", EncryptedRefreshToken = "stored-credential",
            GrantedScopes = DetourCalendarOptions.Scope, LastSyncedVersion = 7
        });
        await db.SaveChangesAsync();
        var google = new FakeGoogleCalendarClient();
        Assert.True((await CreateService(db, google).GetStatusAsync("owner-1")).Connected);
        var unconfigured = new DetourCalendarService(db, new CalendarOwnerLock(),
            new EphemeralDataProtectionProvider(), google,
            new DetourCalendarOptions { ClientId = clientId, ClientSecret = clientSecret });

        var status = await unconfigured.GetStatusAsync("owner-1");

        Assert.False(status.Configured);
        Assert.False(status.Connected);
        Assert.Equal("detour-calendar", status.CalendarId);
        Assert.Equal(7, status.LastSyncedVersion);
        Assert.Single(db.GoogleCalendarConnections);
    }

    [Fact]
    public void Calendar_oauth_uses_a_separate_callback_scope_and_offline_consent()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDataProtection();
        services.AddAuthentication();
        services.AddDetourCalendar(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Auth:Google:ClientId"] = "calendar-client",
            ["Auth:Google:ClientSecret"] = "calendar-secret"
        }).Build());
        using var provider = services.BuildServiceProvider();

        var options = provider.GetRequiredService<IOptionsMonitor<GoogleOptions>>().Get(DetourCalendarOptions.AuthenticationScheme);
        var challenge = DetourCalendarExtensions.CreateChallengeProperties("owner-1");

        Assert.Equal("/signin-google-calendar", options.CallbackPath);
        Assert.Contains(DetourCalendarOptions.Scope, options.Scope);
        Assert.Equal("offline", options.AccessType);
        Assert.Equal("offline", challenge.AccessType);
        Assert.Equal("consent", challenge.Prompt);
        Assert.Equal("/plan?calendar=connected", challenge.RedirectUri);
    }

    [Theory]
    [InlineData("", DetourCalendarOptions.Scope, "offline access")]
    [InlineData("refresh", "openid email", "permission was not granted")]
    public async Task Authorization_rejects_missing_refresh_token_or_calendar_scope(string refreshToken, string scopes, string expected)
    {
        await using var db = CreateDb();
        db.Users.Add(new ApplicationUser { Id = "owner-1", UserName = "owner@example.test" });
        await db.SaveChangesAsync();
        var google = new FakeGoogleCalendarClient();
        var service = CreateService(db, google);

        var error = await Assert.ThrowsAsync<CalendarReauthorizationException>(() =>
            service.CompleteAuthorizationAsync("owner-1", "google-subject-1", refreshToken, "access", scopes));

        Assert.Contains(expected, error.Message);
        Assert.Empty(db.GoogleCalendarConnections);
        Assert.Equal(0, google.CreateCalendarCalls);
    }

    [Fact]
    public async Task Sync_upserts_projected_events_and_deletes_only_tracked_stale_events()
    {
        await using var db = CreateDb();
        db.Users.Add(new ApplicationUser { Id = "owner-1", UserName = "owner@example.test" });
        var snapshot = SnapshotWithActivity("activity-1");
        db.Trips.Add(new TripDocumentRow
        {
            Id = Guid.NewGuid(), OwnerId = "owner-1", Version = 1,
            Json = JsonSerializer.Serialize(snapshot, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            UpdatedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
        var google = new FakeGoogleCalendarClient();
        var service = CreateService(db, google);

        await service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh-secret", "access", DetourCalendarOptions.Scope);
        await service.SyncOwnerAsync("owner-1");

        var managed = Assert.Single(db.GoogleCalendarManagedEvents);
        Assert.Equal("activity:activity-1", managed.LocalKey);
        Assert.Equal(Assert.Single(google.Upserts).EventId, managed.GoogleEventId);
        Assert.DoesNotContain("refresh-secret", db.GoogleCalendarConnections.Single().EncryptedRefreshToken);

        var row = db.Trips.Single();
        row.Version = 2;
        row.Json = JsonSerializer.Serialize(new TripSnapshot
        {
            Trip = new TripDocument { TimeZone = "Asia/Tokyo" }
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await db.SaveChangesAsync();
        google.RemoteEventIds.Add("unrelated-google-event");

        await service.SyncOwnerAsync("owner-1");

        Assert.Empty(db.GoogleCalendarManagedEvents);
        Assert.Single(google.Deletes, managed.GoogleEventId);
        Assert.Contains("unrelated-google-event", google.RemoteEventIds);
        Assert.Equal(2, db.GoogleCalendarConnections.Single().LastSyncedVersion);
    }

    [Fact]
    public async Task Reconnect_with_a_different_google_subject_is_rejected_without_touching_events()
    {
        await using var db = CreateDb();
        db.Users.Add(new ApplicationUser { Id = "owner-1", UserName = "owner@example.test" });
        await db.SaveChangesAsync();
        var google = new FakeGoogleCalendarClient();
        var service = CreateService(db, google);
        await service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh-one", "access", DetourCalendarOptions.Scope);
        var originalCalendar = db.GoogleCalendarConnections.Single().CalendarId;

        var error = await Assert.ThrowsAsync<CalendarReauthorizationException>(() =>
            service.CompleteAuthorizationAsync("owner-1", "google-subject-2", "refresh-two", "access", DetourCalendarOptions.Scope));

        Assert.Contains("Disconnect", error.Message);
        Assert.Equal("google-subject-1", db.GoogleCalendarConnections.Single().GoogleSubject);
        Assert.Equal(originalCalendar, db.GoogleCalendarConnections.Single().CalendarId);
        Assert.Empty(google.Deletes);
        Assert.Equal(1, google.CreateCalendarCalls);
    }

    [Fact]
    public async Task Refresh_rejection_marks_connection_for_reauthorization()
    {
        await using var db = CreateDb();
        db.Users.Add(new ApplicationUser { Id = "owner-1", UserName = "owner@example.test" });
        db.Trips.Add(new TripDocumentRow
        {
            Id = Guid.NewGuid(), OwnerId = "owner-1", Version = 1,
            Json = JsonSerializer.Serialize(SnapshotWithActivity("activity-1"), new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            UpdatedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
        var google = new FakeGoogleCalendarClient();
        var service = CreateService(db, google);
        await service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh-secret", "access", DetourCalendarOptions.Scope);
        google.RefreshError = new CalendarReauthorizationException("Reconnect Google Calendar in Detour.");

        await service.SyncOwnerAsync("owner-1");

        var status = await service.GetStatusAsync("owner-1");
        Assert.False(status.Connected);
        Assert.Contains("Reconnect", status.Error);
        Assert.True(db.GoogleCalendarConnections.Single().ReauthorizationRequired);
    }

    [Fact]
    public async Task Network_timeout_records_retry_state_without_requiring_new_consent()
    {
        await using var db = CreateDb();
        db.Users.Add(new ApplicationUser { Id = "owner-1", UserName = "owner@example.test" });
        db.Trips.Add(new TripDocumentRow
        {
            Id = Guid.NewGuid(), OwnerId = "owner-1", Version = 1,
            Json = JsonSerializer.Serialize(SnapshotWithActivity("activity-1"), new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            UpdatedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
        var google = new FakeGoogleCalendarClient();
        var service = CreateService(db, google);
        await service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh-secret", "access", DetourCalendarOptions.Scope);
        google.RefreshError = new TaskCanceledException("HTTP timeout");
        await service.SyncOwnerAsync("owner-1");
        var connection = db.GoogleCalendarConnections.Single();
        Assert.False(connection.ReauthorizationRequired);
        Assert.True(connection.NextAttemptAt > DateTimeOffset.UtcNow);
        Assert.Contains("timed out", connection.Error);
        Assert.Null(connection.LastSyncedVersion);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.NotFound)]
    public async Task Permanent_sync_error_pauses_automatic_work_until_manual_retry(HttpStatusCode statusCode)
    {
        var dbName = Guid.NewGuid().ToString();
        var dataProtection = new EphemeralDataProtectionProvider();
        var google = new FakeGoogleCalendarClient
        {
            UpsertError = new CalendarRemoteException($"Google returned {(int)statusCode}.")
        };
        var services = CreateCalendarServiceProvider(dbName, dataProtection, google);
        await using var provider = services.BuildServiceProvider();
        await SeedCalendarTripAsync(provider, "owner-1");
        await using (var scope = provider.CreateAsyncScope())
        {
            var service = scope.ServiceProvider.GetRequiredService<DetourCalendarService>();
            await service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh", "access", DetourCalendarOptions.Scope);
            await service.SyncOwnerAsync("owner-1");
            await service.SyncOwnerAsync("owner-1");
        }

        var paused = await GetCalendarConnectionAsync(provider);
        Assert.False(paused.ReauthorizationRequired);
        Assert.True(paused.FailureCount > 0);
        Assert.Null(paused.NextAttemptAt);
        Assert.Contains(((int)statusCode).ToString(), paused.Error);
        Assert.Contains("Retry sync", paused.Error);
        Assert.Equal(1, google.RefreshCalls);
        Assert.Single(google.Upserts);

        var worker = new GoogleCalendarSyncWorker(
            provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<GoogleCalendarSyncWorker>.Instance);
        await worker.RunOnceAsync(CancellationToken.None);
        Assert.Equal(1, google.RefreshCalls);
        Assert.Single(google.Upserts);

        google.UpsertError = null;
        await using (var scope = provider.CreateAsyncScope())
        {
            var service = scope.ServiceProvider.GetRequiredService<DetourCalendarService>();
            await service.RequestSyncAsync("owner-1");
            var retryRequested = await service.GetStatusAsync("owner-1");
            Assert.Null(retryRequested.Error);
            await service.SyncOwnerAsync("owner-1");
        }

        var recovered = await GetCalendarConnectionAsync(provider);
        Assert.Equal(0, recovered.FailureCount);
        Assert.Null(recovered.NextAttemptAt);
        Assert.Null(recovered.Error);
        Assert.Equal(2, google.RefreshCalls);
        Assert.Equal(2, google.Upserts.Count);
    }

    [Fact]
    public async Task Transient_sync_error_keeps_automatic_retry_scheduled()
    {
        await using var db = CreateDb();
        db.Users.Add(new ApplicationUser { Id = "owner-1", UserName = "owner@example.test" });
        db.Trips.Add(new TripDocumentRow
        {
            Id = Guid.NewGuid(), OwnerId = "owner-1", Version = 1,
            Json = JsonSerializer.Serialize(SnapshotWithActivity("activity-1"), new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            UpdatedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
        var google = new FakeGoogleCalendarClient();
        var service = CreateService(db, google);
        await service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh-secret", "access", DetourCalendarOptions.Scope);
        google.UpsertError = new CalendarRemoteException("Google returned 429.", transient: true);

        await service.SyncOwnerAsync("owner-1");

        var connection = db.GoogleCalendarConnections.Single();
        Assert.Equal(1, connection.FailureCount);
        Assert.True(connection.NextAttemptAt > DateTimeOffset.UtcNow);
        Assert.False(connection.ReauthorizationRequired);
        Assert.Contains("429", connection.Error);
    }

    [Fact]
    public async Task Ambiguous_calendar_creation_is_not_repeated_automatically()
    {
        await using var db = CreateDb();
        db.Users.Add(new ApplicationUser { Id = "owner-1", UserName = "owner@example.test" });
        db.Trips.Add(new TripDocumentRow
        {
            Id = Guid.NewGuid(), OwnerId = "owner-1", Version = 1,
            Json = JsonSerializer.Serialize(SnapshotWithActivity("activity-1"), new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            UpdatedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
        var google = new FakeGoogleCalendarClient
        {
            CreateError = new CalendarRemoteException("Uncertain create result.", transient: true, outcomeUncertain: true)
        };
        var service = CreateService(db, google);

        await Assert.ThrowsAsync<CalendarRemoteException>(() =>
            service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh", "access", DetourCalendarOptions.Scope));
        await service.SyncOwnerAsync("owner-1");

        Assert.Equal(1, google.CreateCalendarCalls);
        var connection = db.GoogleCalendarConnections.Single();
        Assert.True(connection.CalendarCreationAttempted);
        Assert.Null(connection.CalendarId);
        Assert.Contains("Disconnect", connection.Error);
    }

    [Fact]
    public async Task Google_client_treats_gone_as_an_idempotent_delete()
    {
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.Gone));
        var client = new GoogleCalendarClient(
            new StaticHttpClientFactory(handler),
            new DetourCalendarOptions { ClientId = "client", ClientSecret = "secret" });

        await client.DeleteEventAsync("access", "calendar@example.test", "event-id", CancellationToken.None);

        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Delete, request.Method);
        Assert.Contains("calendar%40example.test/events/event-id", request.Url);
        Assert.Equal("Bearer", request.AuthorizationScheme);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{")]
    [InlineData("{\"id\":123}")]
    public async Task Calendar_creation_without_confirmed_id_is_ambiguous_and_blocks_a_second_create(string responseBody)
    {
        await using var db = CreateDb();
        db.Users.Add(new ApplicationUser { Id = "owner-1", UserName = "owner@example.test" });
        await db.SaveChangesAsync();
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(responseBody, System.Text.Encoding.UTF8, "application/json")
        });
        var options = new DetourCalendarOptions { ClientId = "client", ClientSecret = "secret" };
        var google = new GoogleCalendarClient(new StaticHttpClientFactory(handler), options);
        var service = new DetourCalendarService(db, new CalendarOwnerLock(), new EphemeralDataProtectionProvider(), google, options);

        await Assert.ThrowsAsync<CalendarRemoteException>(() =>
            service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh", "access", DetourCalendarOptions.Scope));
        await Assert.ThrowsAsync<CalendarRemoteException>(() =>
            service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh", "access", DetourCalendarOptions.Scope));
        var status = await service.GetStatusAsync("owner-1");

        Assert.Single(handler.Requests);
        Assert.True(db.GoogleCalendarConnections.Single().CalendarCreationAttempted);
        Assert.Null(db.GoogleCalendarConnections.Single().CalendarId);
        Assert.False(status.Connected);
        Assert.Contains("Disconnect", status.Error);
    }

    [Fact]
    public async Task Calendar_creation_rate_limit_is_retryable_and_successful_reconnect_does_not_create_again()
    {
        await using var db = CreateDb();
        db.Users.Add(new ApplicationUser { Id = "owner-1", UserName = "owner@example.test" });
        await db.SaveChangesAsync();
        var responses = new Queue<HttpResponseMessage>(
        [
            new HttpResponseMessage(HttpStatusCode.TooManyRequests),
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"id\":\"detour-calendar\"}", System.Text.Encoding.UTF8, "application/json")
            }
        ]);
        var handler = new RecordingHandler(_ => responses.Dequeue());
        var options = new DetourCalendarOptions { ClientId = "client", ClientSecret = "secret" };
        var google = new GoogleCalendarClient(new StaticHttpClientFactory(handler), options);
        var service = new DetourCalendarService(db, new CalendarOwnerLock(), new EphemeralDataProtectionProvider(), google, options);

        var rejected = await Assert.ThrowsAsync<CalendarRemoteException>(() =>
            service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh", "access", DetourCalendarOptions.Scope));
        var afterRejection = await service.GetStatusAsync("owner-1");
        var connection = db.GoogleCalendarConnections.Single();
        Assert.True(rejected.Transient);
        Assert.False(rejected.OutcomeUncertain);
        Assert.False(connection.CalendarCreationAttempted);
        Assert.Null(connection.CalendarId);
        Assert.Contains("429", afterRejection.Error);

        await service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh", "access", DetourCalendarOptions.Scope);
        await service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh", "access", DetourCalendarOptions.Scope);
        var recovered = await service.GetStatusAsync("owner-1");

        Assert.True(recovered.Connected);
        Assert.Equal("detour-calendar", recovered.CalendarId);
        Assert.Null(recovered.Error);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Fact]
    public async Task Calendar_creation_server_error_is_transient_but_outcome_uncertain_and_not_retried()
    {
        await using var db = CreateDb();
        db.Users.Add(new ApplicationUser { Id = "owner-1", UserName = "owner@example.test" });
        await db.SaveChangesAsync();
        var handler = new RecordingHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var options = new DetourCalendarOptions { ClientId = "client", ClientSecret = "secret" };
        var google = new GoogleCalendarClient(new StaticHttpClientFactory(handler), options);
        var service = new DetourCalendarService(db, new CalendarOwnerLock(), new EphemeralDataProtectionProvider(), google, options);

        var error = await Assert.ThrowsAsync<CalendarRemoteException>(() =>
            service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh", "access", DetourCalendarOptions.Scope));
        Assert.True(error.Transient);
        Assert.True(error.OutcomeUncertain);
        await Assert.ThrowsAsync<CalendarRemoteException>(() =>
            service.CompleteAuthorizationAsync("owner-1", "google-subject-1", "refresh", "access", DetourCalendarOptions.Scope));

        var status = await service.GetStatusAsync("owner-1");
        Assert.False(status.Connected);
        Assert.Null(status.CalendarId);
        Assert.Contains("Disconnect", status.Error);
        Assert.True(db.GoogleCalendarConnections.Single().CalendarCreationAttempted);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task Google_client_updates_with_the_same_id_after_insert_conflict()
    {
        var responses = new Queue<HttpStatusCode>([HttpStatusCode.Conflict, HttpStatusCode.OK]);
        var handler = new RecordingHandler(_ => new HttpResponseMessage(responses.Dequeue())
        {
            Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json")
        });
        var client = new GoogleCalendarClient(
            new StaticHttpClientFactory(handler),
            new DetourCalendarOptions { ClientId = "client", ClientSecret = "secret" });

        await client.UpsertEventAsync("access", "calendar", "detour12345", new JsonObject { ["summary"] = "Trip" }, CancellationToken.None);

        Assert.Equal([HttpMethod.Post, HttpMethod.Put], handler.Requests.Select(x => x.Method));
        Assert.Contains("\"id\":\"detour12345\"", handler.Requests[0].Body);
        Assert.DoesNotContain("\"id\"", handler.Requests[1].Body);
        Assert.EndsWith("/events/detour12345", handler.Requests[1].Url);
    }

    private static TripSnapshot SnapshotWithActivity(string id) => new()
    {
        Trip = new TripDocument { TimeZone = "Asia/Tokyo" },
        Activities =
        [
            new Activity
            {
                Id = id,
                Title = "Tea ceremony",
                Date = new DateOnly(2026, 10, 4),
                StartTime = new TimeOnly(14, 0),
                DurationMinutes = 60
            }
        ]
    };

    private static TripDbContext CreateDb()
    {
        var options = new DbContextOptionsBuilder<TripDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new TripDbContext(options);
    }

    private static DetourCalendarService CreateService(TripDbContext db, IGoogleCalendarClient google)
        => new(db, new CalendarOwnerLock(), new EphemeralDataProtectionProvider(), google,
            new DetourCalendarOptions { ClientId = "client", ClientSecret = "secret" });

    private static ServiceCollection CreateCalendarServiceProvider(string dbName, IDataProtectionProvider dataProtection, FakeGoogleCalendarClient google)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<TripDbContext>(options => options.UseInMemoryDatabase(dbName));
        services.AddSingleton(dataProtection);
        services.AddSingleton(new CalendarOwnerLock());
        services.AddSingleton<IGoogleCalendarClient>(google);
        services.AddSingleton(new DetourCalendarOptions { ClientId = "client", ClientSecret = "secret" });
        services.AddScoped<DetourCalendarService>();
        return services;
    }

    private static async Task SeedCalendarTripAsync(IServiceProvider provider, string ownerId)
    {
        await using var scope = provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<TripDbContext>();
        db.Users.Add(new ApplicationUser { Id = ownerId, UserName = "owner@example.test" });
        db.Trips.Add(new TripDocumentRow
        {
            Id = Guid.NewGuid(), OwnerId = ownerId, Version = 1,
            Json = JsonSerializer.Serialize(SnapshotWithActivity("activity-1"), new JsonSerializerOptions(JsonSerializerDefaults.Web)),
            UpdatedAt = DateTimeOffset.UtcNow
        });
        await db.SaveChangesAsync();
    }

    private static async Task<GoogleCalendarConnectionRow> GetCalendarConnectionAsync(IServiceProvider provider)
    {
        await using var scope = provider.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<TripDbContext>().GoogleCalendarConnections.SingleAsync();
    }

    private sealed class FakeGoogleCalendarClient : IGoogleCalendarClient
    {
        public List<(string EventId, JsonObject Body)> Upserts { get; } = [];
        public List<string> Deletes { get; } = [];
        public HashSet<string> RemoteEventIds { get; } = [];
        public Exception? RefreshError { get; set; }
        public Exception? CreateError { get; set; }
        public Exception? UpsertError { get; set; }
        public int CreateCalendarCalls { get; private set; }
        public int RefreshCalls { get; private set; }

        public Task<string> RefreshAccessTokenAsync(string refreshToken, CancellationToken cancellationToken)
        {
            RefreshCalls++;
            return RefreshError is null ? Task.FromResult("access") : Task.FromException<string>(RefreshError);
        }

        public Task<string> CreateCalendarAsync(string accessToken, CancellationToken cancellationToken)
        {
            CreateCalendarCalls++;
            return CreateError is null ? Task.FromResult("detour-calendar") : Task.FromException<string>(CreateError);
        }

        public Task UpsertEventAsync(string accessToken, string calendarId, string eventId, JsonObject body, CancellationToken cancellationToken)
        {
            Upserts.Add((eventId, (JsonObject)body.DeepClone()));
            if (UpsertError is not null) return Task.FromException(UpsertError);
            RemoteEventIds.Add(eventId);
            return Task.CompletedTask;
        }

        public Task DeleteEventAsync(string accessToken, string calendarId, string eventId, CancellationToken cancellationToken)
        {
            Deletes.Add(eventId);
            RemoteEventIds.Remove(eventId);
            return Task.CompletedTask;
        }
    }

    private sealed class StaticHttpClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    private sealed class RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) : HttpMessageHandler
    {
        public List<CapturedRequest> Requests { get; } = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(new CapturedRequest(
                request.Method,
                request.RequestUri!.ToString(),
                request.Headers.Authorization?.Scheme,
                request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken)));
            return responder(request);
        }
    }

    private sealed record CapturedRequest(HttpMethod Method, string Url, string? AuthorizationScheme, string Body);
}
