using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Configuration;

namespace Detour.Api;

public sealed class GooglePlacesClient(HttpClient client, IConfiguration configuration)
{
    private static readonly Uri SearchEndpoint = new("https://places.googleapis.com/v1/places:searchText");
    private const string FieldMask = "places.id,places.location,nextPageToken";
    private const int PageSize = 2;
    private const int MaxResponseBytes = 64 * 1024;
    private const int MaxQueryLength = 2048;
    private const int MaxPlaceIdLength = 500;
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(8);

    public async Task<GooglePlacesResult> SearchAsync(string query, CancellationToken cancellationToken = default)
    {
        var apiKey = configuration["GoogleMaps:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey))
            throw Failure("Google Places lookup is not configured. Set GoogleMaps:ApiKey.");
        if (string.IsNullOrWhiteSpace(query))
            throw new ArgumentException("A place search query is required.", nameof(query));
        if (query.Length > MaxQueryLength)
            throw new ArgumentException("The place search query is too long. Provide a specific Google Maps link or verified coordinates.", nameof(query));

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(RequestTimeout);

        using var request = new HttpRequestMessage(HttpMethod.Post, SearchEndpoint)
        {
            Content = JsonContent.Create(new { textQuery = query, pageSize = PageSize })
        };
        request.Headers.TryAddWithoutValidation("X-Goog-Api-Key", apiKey);
        request.Headers.TryAddWithoutValidation("X-Goog-FieldMask", FieldMask);

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw Failure("Google Places lookup timed out. Provide a specific Google Maps link or verified coordinates.");
        }
        catch (HttpRequestException)
        {
            throw Failure("Google Places lookup could not reach Google. Provide a specific Google Maps link or verified coordinates.");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
                throw Failure(StatusFailure(response.StatusCode));

            try
            {
                await response.Content.LoadIntoBufferAsync(MaxResponseBytes, timeout.Token);
                var payload = await response.Content.ReadFromJsonAsync<SearchResponse>(cancellationToken: timeout.Token);
                if (payload?.Places is not { } places || places.Count == 0)
                    throw Failure("Google Places returned no matching place. Provide a specific Google Maps link or verified coordinates.");
                if (places.Count != 1 || !string.IsNullOrWhiteSpace(payload.NextPageToken))
                    throw Failure("Google Places returned multiple possible places. Provide a specific Google Maps link or verified coordinates.");

                var place = places[0];
                if (string.IsNullOrWhiteSpace(place?.Id) || place.Id.Length > MaxPlaceIdLength
                    || place.Location is not { } location
                    || location.Latitude is not { } latitude || location.Longitude is not { } longitude
                    || !GoogleMapsCoordinates.IsValid(latitude, longitude))
                    throw Failure("Google Places returned an incomplete place. Provide a specific Google Maps link or verified coordinates.");

                return new GooglePlacesResult(place.Id, latitude, longitude);
            }
            catch (JsonException)
            {
                throw Failure("Google Places returned an invalid response. Provide a specific Google Maps link or verified coordinates.");
            }
            catch (HttpRequestException)
            {
                throw Failure("Google Places returned an invalid response. Provide a specific Google Maps link or verified coordinates.");
            }
            catch (InvalidOperationException)
            {
                throw Failure("Google Places returned an invalid response. Provide a specific Google Maps link or verified coordinates.");
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw Failure("Google Places lookup timed out. Provide a specific Google Maps link or verified coordinates.");
            }
        }
    }

    private static string StatusFailure(HttpStatusCode statusCode) => statusCode switch
    {
        HttpStatusCode.Forbidden => "Google Places rejected the request. Check the API key and Places API access, or provide a specific Google Maps link or verified coordinates.",
        HttpStatusCode.TooManyRequests => "Google Places quota is unavailable. Provide a specific Google Maps link or verified coordinates.",
        _ => "Google Places lookup failed. Provide a specific Google Maps link or verified coordinates."
    };

    private static ArgumentException Failure(string message) => new(message);

    private sealed record SearchResponse(
        [property: JsonPropertyName("places")] IReadOnlyList<PlaceResponse?>? Places,
        [property: JsonPropertyName("nextPageToken")] string? NextPageToken);

    private sealed record PlaceResponse(
        [property: JsonPropertyName("id")] string? Id,
        [property: JsonPropertyName("location")] LocationResponse? Location);

    private sealed record LocationResponse(
        [property: JsonPropertyName("latitude")] double? Latitude,
        [property: JsonPropertyName("longitude")] double? Longitude);
}

public sealed record GooglePlacesResult(string GooglePlaceId, double Latitude, double Longitude);
