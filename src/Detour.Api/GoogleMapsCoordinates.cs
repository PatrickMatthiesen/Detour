using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.WebUtilities;

namespace Detour.Api;

public sealed partial class GoogleMapsCoordinates(HttpClient client, GooglePlacesClient? places = null)
{
    public readonly record struct Point(double Latitude, double Longitude, string? GooglePlaceId = null, string? Query = null);

    public static string? NormalizeUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return url;
        url = url.Trim();
        if (!url.Contains("://", StringComparison.Ordinal)
            && Uri.TryCreate("https://" + url, UriKind.Absolute, out var uri) && IsMapsUri(uri))
            return uri.AbsoluteUri;
        return url;
    }

    public static string? SearchQuery(string? url)
    {
        if (!Uri.TryCreate(NormalizeUrl(url), UriKind.Absolute, out var uri) || !IsMapsUri(uri)) return null;
        if (uri.AbsolutePath.TrimEnd('/') != "/maps/search" && uri.AbsolutePath.TrimEnd('/') != "/maps"
            && !(uri.Host.StartsWith("maps.google.", StringComparison.Ordinal) && uri.AbsolutePath == "/")) return null;
        var query = QueryHelpers.ParseQuery(uri.Query);
        if (query.ContainsKey("query_place_id")) return null;
        foreach (var key in new[] { "query", "q" })
        {
            if (!query.TryGetValue(key, out var value) || value.Count != 1) continue;
            var text = value.ToString().Trim();
            if (text.Length is > 0 and <= 2048 && text.Any(char.IsLetter)
                && !text.StartsWith("place_id:", StringComparison.OrdinalIgnoreCase)) return text;
        }
        return null;
    }

    public static bool IsValid(double? latitude, double? longitude) =>
        latitude is { } lat && longitude is { } lng && double.IsFinite(lat) && double.IsFinite(lng)
        && lat is >= -90 and <= 90 && lng is >= -180 and <= 180;

    public static Point? Parse(string? url)
    {
        if (!Uri.TryCreate(NormalizeUrl(url), UriKind.Absolute, out var uri) || !IsMapsUri(uri)) return null;
        var path = Uri.UnescapeDataString(uri.AbsolutePath);
        // Directions contain several coordinates, none of which is an unambiguous place pin.
        if (path.StartsWith("/maps/dir", StringComparison.OrdinalIgnoreCase)) return null;
        var query = QueryHelpers.ParseQuery(uri.Query);
        var data = path + (query.TryGetValue("data", out var encodedData) ? encodedData.ToString() : "");
        var pins = PlacePin().Matches(data);
        if (pins.Count == 1) return Pair(pins[0].Groups[1].Value, pins[0].Groups[2].Value);
        if (pins.Count > 1) return null;
        foreach (var key in new[] { "query", "q" })
        {
            if (!query.TryGetValue(key, out var value) || value.Count != 1) continue;
            var pair = value.ToString().Split(',');
            if (pair.Length == 2 && Pair(pair[0], pair[1]) is { } point) return point;
        }
        // @lat,lng,zoom, center and ll describe the camera, not the selected place.
        return null;
    }

    public async Task<Point?> ResolveAsync(string? url, CancellationToken cancellationToken)
    {
        if (Parse(url) is { } point) return point;
        if (SearchQuery(url) is { } query) return await SearchAsync(query, cancellationToken);
        if (!Uri.TryCreate(NormalizeUrl(url), UriKind.Absolute, out var uri) || !IsShortLink(uri)) return null;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(8));
        try
        {
            for (var hop = 0; hop < 5; hop++)
            {
                // The client disables automatic redirects; every destination is checked first.
                if (!IsMapsUri(uri)) return null;
                if (Parse(uri.AbsoluteUri) is { } resolved) return resolved;
                if (SearchQuery(uri.AbsoluteUri) is { } redirectedQuery) return await SearchAsync(redirectedQuery, timeout.Token);
                using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
                if ((int)response.StatusCode is not (301 or 302 or 303 or 307 or 308) || response.Headers.Location is not { } location) return null;
                uri = location.IsAbsoluteUri ? location : new Uri(uri, location);
            }
            if (Parse(uri.AbsoluteUri) is { } lastPoint) return lastPoint;
            return SearchQuery(uri.AbsoluteUri) is { } lastQuery ? await SearchAsync(lastQuery, timeout.Token) : null;
        }
        catch (HttpRequestException) { return null; }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return null; }
    }

    private async Task<Point?> SearchAsync(string query, CancellationToken ct)
    {
        if (places is null) return null;
        var result = await places.SearchAsync(query, ct);
        return new(result.Latitude, result.Longitude, result.GooglePlaceId, query);
    }

    private static Point? Pair(string latitude, string longitude) =>
        double.TryParse(latitude, NumberStyles.Float, CultureInfo.InvariantCulture, out var lat)
        && double.TryParse(longitude, NumberStyles.Float, CultureInfo.InvariantCulture, out var lng)
        && IsValid(lat, lng) ? new(lat, lng) : null;

    private static bool IsShortLink(Uri uri) => uri.Scheme == "https" && uri.IsDefaultPort && uri.UserInfo.Length == 0
        && (uri.Host == "maps.app.goo.gl" || uri.Host == "goo.gl" && uri.AbsolutePath.StartsWith("/maps/", StringComparison.Ordinal));

    private static bool IsMapsUri(Uri uri) => uri.Scheme == "https" && uri.IsDefaultPort && uri.UserInfo.Length == 0
        && (IsShortLink(uri) || uri.Host is "maps.google.com" or "maps.google.co.jp" or "maps.google.dk"
            && (uri.AbsolutePath is "/" or "/maps" || uri.AbsolutePath.StartsWith("/maps/", StringComparison.Ordinal))
            || uri.Host is "google.com" or "www.google.com" or "google.co.jp" or "www.google.co.jp" or "google.dk" or "www.google.dk"
            && (uri.AbsolutePath == "/maps" || uri.AbsolutePath.StartsWith("/maps/", StringComparison.Ordinal)));

    [GeneratedRegex(@"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)(?=!|/|$)")]
    private static partial Regex PlacePin();
}
