using System.Text.Json;
using System.Text.RegularExpressions;

namespace Detour.Api;

internal static class StayCityValidator
{
    private static readonly Lazy<HashSet<string>> KnownCities = new(LoadKnownCities);
    private static readonly HashSet<string> UnmappedPlaceholders = new(StringComparer.OrdinalIgnoreCase)
    {
        "",
        "other",
        "unknown city"
    };
    private static readonly Regex MultipleDestinations = new(
        @"[/\\;]|\s(?:&|\+)\s|\b(?:and|or)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static void Validate(TripSnapshot snapshot, TripSnapshot previous)
    {
        foreach (var stay in snapshot.Stays)
        {
            var previousStay = previous.Stays.FirstOrDefault(candidate => candidate.Id == stay.Id);
            var previousCity = previousStay?.City?.Trim();
            var cityChanged = previousStay is null || !string.Equals(previousCity, stay.City, StringComparison.Ordinal);
            var currentlyResolved = IsResolved(stay.City, snapshot.Places);

            if (cityChanged && !currentlyResolved)
                throw new ArgumentException(ResolutionMessage(stay.City));

            if (!cityChanged && IsResolved(previousCity!, previous.Places) && !currentlyResolved)
                throw new ArgumentException($"Stay city '{stay.City}' would lose its map location. Add a saved place in that city with valid coordinates before removing its last mapped place.");
        }
    }

    private static bool IsResolved(string? city, IEnumerable<Place> places) =>
        city is not null && !UnmappedPlaceholders.Contains(city) && !MultipleDestinations.IsMatch(city)
        && (KnownCities.Value.Contains(city)
        || places.Any(place =>
            string.Equals(place.City, city, StringComparison.Ordinal)
            && GoogleMapsCoordinates.IsValid(place.Latitude, place.Longitude)));

    private static string ResolutionMessage(string city) =>
        $"Stay city '{city}' must name one map city or city area. Put extra destinations in the stay name or notes. For an unknown city, add a saved place in that city with valid coordinates first.";

    private static HashSet<string> LoadKnownCities()
    {
        const string resourceName = "Detour.Api.city-centers.json";
        using var stream = typeof(StayCityValidator).Assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Embedded resource '{resourceName}' was not found.");
        var centers = JsonSerializer.Deserialize<Dictionary<string, double[]>>(stream)
            ?? throw new InvalidOperationException($"Embedded resource '{resourceName}' is empty.");
        return centers.Keys.ToHashSet(StringComparer.Ordinal);
    }
}
