namespace Detour.Api;

public static class CalendarEventValidation
{
    public static string? ValidateActivity(Activity activity, TripSnapshot snapshot)
    {
        if (activity.Kind is not ("activity" or "check-in" or "check-out" or "departure" or "task"))
            return "Activity kind must be activity, check-in, check-out, departure, or task.";
        if (activity.ReminderMinutes is < 0 or > 40320)
            return "Activity reminderMinutes must be between 0 and 40320.";
        if (activity.Date == default) return "Activity date is required.";
        if (string.IsNullOrWhiteSpace(activity.PlaceId) && string.IsNullOrWhiteSpace(activity.Title))
            return "Activity title is required when placeId is not supplied.";
        if (!string.IsNullOrWhiteSpace(activity.PlaceId) && !snapshot.Places.Any(x => x.Id == activity.PlaceId))
            return "Activity placeId must identify an existing place.";
        if (!string.IsNullOrWhiteSpace(activity.GoogleMapsUrl) &&
            (!Uri.TryCreate(activity.GoogleMapsUrl, UriKind.Absolute, out var uri) ||
             uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo) || activity.GoogleMapsUrl.Length > 2048))
            return "Activity googleMapsUrl must be an HTTP(S) URL without credentials, at most 2048 characters.";
        return null;
    }
}
