using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Detour.Api;

public sealed class DetourCalendarOptions
{
    public const string AuthenticationScheme = "GoogleCalendar";
    public const string TemporaryCookieScheme = "GoogleCalendar.Temporary";
    public const string Scope = "https://www.googleapis.com/auth/calendar.app.created";

    public string? ClientId { get; set; }
    public string? ClientSecret { get; set; }
    public bool Configured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret);
}

public sealed class CalendarReauthorizationException(string message) : Exception(message);
public sealed class CalendarRemoteException(string message, bool transient = false, bool outcomeUncertain = false) : Exception(message)
{
    public bool Transient { get; } = transient;
    public bool OutcomeUncertain { get; } = outcomeUncertain;
}

public interface IGoogleCalendarClient
{
    Task<string> RefreshAccessTokenAsync(string refreshToken, CancellationToken cancellationToken);
    Task<string> CreateCalendarAsync(string accessToken, CancellationToken cancellationToken);
    Task UpsertEventAsync(string accessToken, string calendarId, string eventId, JsonObject body, CancellationToken cancellationToken);
    Task DeleteEventAsync(string accessToken, string calendarId, string eventId, CancellationToken cancellationToken);
}

public sealed class GoogleCalendarClient(IHttpClientFactory clients, DetourCalendarOptions options) : IGoogleCalendarClient
{
    private const string ApiBase = "https://www.googleapis.com/calendar/v3";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<string> RefreshAccessTokenAsync(string refreshToken, CancellationToken cancellationToken)
    {
        if (!options.Configured) throw new CalendarRemoteException("Google Calendar is not configured.");
        using var response = await SendWithRetryAsync(() =>
        {
            var request = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token")
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["client_id"] = options.ClientId!,
                    ["client_secret"] = options.ClientSecret!,
                    ["refresh_token"] = refreshToken,
                    ["grant_type"] = "refresh_token"
                })
            };
            return request;
        }, cancellationToken);
        if (response.StatusCode == HttpStatusCode.BadRequest)
        {
            var error = await ReadErrorCodeAsync(response, cancellationToken);
            if (error is "invalid_grant" or "invalid_client")
                throw new CalendarReauthorizationException("Google Calendar access expired. Reconnect Google Calendar in Detour.");
        }
        await EnsureSuccessAsync(response, "refresh Google Calendar access", cancellationToken);
        var payload = await response.Content.ReadFromJsonAsync<JsonObject>(JsonOptions, cancellationToken);
        var token = payload?["access_token"]?.GetValue<string>();
        return !string.IsNullOrWhiteSpace(token)
            ? token
            : throw new CalendarRemoteException("Google did not return an access token. Reconnect Google Calendar in Detour.");
    }

    public async Task<string> CreateCalendarAsync(string accessToken, CancellationToken cancellationToken)
    {
        HttpResponseMessage response;
        try
        {
            using var request = Authorized(
                HttpMethod.Post,
                $"{ApiBase}/calendars",
                accessToken,
                new JsonObject { ["summary"] = "Detour trips", ["description"] = "Calendar managed by Detour." });
            response = await clients.CreateClient("google-calendar").SendAsync(request, cancellationToken);
        }
        catch (Exception ex) when (ex is HttpRequestException || ex is TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new CalendarRemoteException("Google Calendar creation had an uncertain network result. Disconnect before reconnecting so Detour does not create duplicates.", transient: true, outcomeUncertain: true);
        }
        using (response)
        {
            await EnsureSuccessAsync(response, "create the Detour calendar", cancellationToken, creationRequest: true);
            string? id;
            try
            {
                var payload = await response.Content.ReadFromJsonAsync<JsonObject>(JsonOptions, cancellationToken);
                id = payload?["id"]?.GetValue<string>();
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException)
            {
                throw new CalendarRemoteException("Google returned an unreadable calendar creation result. Disconnect before reconnecting so Detour does not create duplicates.", transient: true, outcomeUncertain: true);
            }
            return !string.IsNullOrWhiteSpace(id)
                ? id
                : throw new CalendarRemoteException("Google created a calendar without returning its ID. Disconnect before reconnecting so Detour does not create duplicates.", transient: true, outcomeUncertain: true);
        }
    }

    public async Task UpsertEventAsync(string accessToken, string calendarId, string eventId, JsonObject body, CancellationToken cancellationToken)
    {
        var insert = (JsonObject)body.DeepClone();
        insert["id"] = eventId;
        var calendar = Uri.EscapeDataString(calendarId);
        using var response = await SendWithRetryAsync(() => Authorized(
            HttpMethod.Post,
            $"{ApiBase}/calendars/{calendar}/events",
            accessToken,
            insert), cancellationToken);
        if (response.StatusCode == HttpStatusCode.Conflict)
        {
            using var update = await SendWithRetryAsync(() => Authorized(
                HttpMethod.Put,
                $"{ApiBase}/calendars/{calendar}/events/{Uri.EscapeDataString(eventId)}",
                accessToken,
                (JsonObject)body.DeepClone()), cancellationToken);
            await EnsureSuccessAsync(update, "update a Detour calendar event", cancellationToken);
            return;
        }
        await EnsureSuccessAsync(response, "create a Detour calendar event", cancellationToken);
    }

    public async Task DeleteEventAsync(string accessToken, string calendarId, string eventId, CancellationToken cancellationToken)
    {
        var calendar = Uri.EscapeDataString(calendarId);
        using var response = await SendWithRetryAsync(() => Authorized(
            HttpMethod.Delete,
            $"{ApiBase}/calendars/{calendar}/events/{Uri.EscapeDataString(eventId)}",
            accessToken), cancellationToken);
        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone) return;
        await EnsureSuccessAsync(response, "delete a stale Detour calendar event", cancellationToken);
    }

    private async Task<HttpResponseMessage> SendWithRetryAsync(Func<HttpRequestMessage> request, CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            HttpResponseMessage response;
            try
            {
                using var message = request();
                response = await clients.CreateClient("google-calendar").SendAsync(message, cancellationToken);
            }
            catch (Exception ex) when (attempt < 2 && (ex is HttpRequestException or TimeoutException || ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
            {
                await Task.Delay(TimeSpan.FromMilliseconds(200 * (1 << attempt)), cancellationToken);
                continue;
            }
            var code = response.StatusCode == HttpStatusCode.Forbidden
                ? await ReadErrorCodeAsync(response, cancellationToken)
                : null;
            if (attempt < 2 && IsTransient(response.StatusCode, code))
            {
                response.Dispose();
                await Task.Delay(TimeSpan.FromMilliseconds(200 * (1 << attempt)), cancellationToken);
                continue;
            }
            return response;
        }
    }

    private static HttpRequestMessage Authorized(HttpMethod method, string url, string accessToken, JsonObject? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        if (body is not null) request.Content = JsonContent.Create(body, options: JsonOptions);
        return request;
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, string action, CancellationToken cancellationToken, bool creationRequest = false)
    {
        if (response.IsSuccessStatusCode) return;
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            throw new CalendarReauthorizationException("Google Calendar access expired. Reconnect Google Calendar in Detour.");
        var code = await ReadErrorCodeAsync(response, cancellationToken);
        if (response.StatusCode == HttpStatusCode.Forbidden && code is "insufficientPermissions" or "insufficient_scope")
            throw new CalendarReauthorizationException("Google Calendar permission is missing. Reconnect and approve calendar access.");
        throw new CalendarRemoteException($"Could not {action}. Google returned {(int)response.StatusCode}.",
            transient: IsTransient(response.StatusCode, code),
            outcomeUncertain: creationRequest && (response.StatusCode == HttpStatusCode.RequestTimeout || (int)response.StatusCode >= 500));
    }

    private static bool IsTransient(HttpStatusCode status, string? code = null)
        => status is HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests || (int)status >= 500
            || status == HttpStatusCode.Forbidden && code is "rateLimitExceeded" or "userRateLimitExceeded";

    private static async Task<string?> ReadErrorCodeAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            var payload = JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            return payload?["error"] is JsonValue value ? value.GetValue<string>()
                : payload?["error"]?["errors"]?[0]?["reason"]?.GetValue<string>();
        }
        catch (JsonException) { return null; }
        catch (InvalidOperationException) { return null; }
    }
}
