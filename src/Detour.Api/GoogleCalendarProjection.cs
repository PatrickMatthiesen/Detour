using System.Globalization;
using System.Net;
using System.Text.Json.Nodes;

namespace Detour.Api;

/// <summary>Projects plan records only. Saved place ideas are never scheduled implicitly.</summary>
public static class GoogleCalendarProjection
{
    public static Dictionary<string, JsonObject> Build(TripSnapshot snapshot)
    {
        var events = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        var zone = snapshot.Trip.TimeZone;
        if (string.IsNullOrWhiteSpace(zone) || !TimeZoneInfo.TryFindSystemTimeZoneById(zone, out _))
            throw new ArgumentException("Set a valid trip time zone before syncing Google Calendar.");

        foreach (var activity in snapshot.Activities.Where(x => !Cancelled(x.Status)))
        {
            var place = snapshot.Places.Find(x => x.Id == activity.PlaceId);
            var location = activity.Location ?? (place is null ? null : $"{place.Name}, {place.City}");
            var maps = activity.GoogleMapsUrl ?? place?.GoogleMapsUrl ?? Search(location);
            var body = Event(string.IsNullOrWhiteSpace(activity.Title) ? place?.Name ?? "Activity" : activity.Title, activity.Notes, activity.Status, location, maps);
            When(body, activity.Date, activity.StartTime, activity.DurationMinutes ?? (activity.Kind == "activity" ? place?.DurationMinutes : null), zone);
            body["reminders"] = new JsonObject
            {
                ["useDefault"] = false,
                ["overrides"] = activity.ReminderMinutes is { } minutes
                    ? new JsonArray(new JsonObject { ["method"] = "popup", ["minutes"] = minutes }) : new JsonArray()
            };
            events.Add($"activity:{activity.Id}", body);
        }
        foreach (var leg in snapshot.TravelLegs)
        {
            var directions = Directions(leg.From, leg.To, leg.Mode);
            var notes = Join(leg.Notes, leg.Estimated ? "Journey duration is an estimate." : null);
            var body = Event($"{leg.From} → {leg.To}", notes, "planned", leg.To, directions);
            When(body, leg.Date, leg.StartTime, leg.DurationMinutes, zone);
            events.Add($"travel:{leg.Id}", body);
        }
        foreach (var booking in snapshot.Bookings.Where(x => !Cancelled(x.Status)))
        {
            var body = Event(booking.Title, booking.Notes, booking.Status, booking.Location, Search(booking.Location));
            // Confirmation codes, booking numbers and PINs are deliberately not copied.
            if (booking.Start is { } start)
            {
                Timed(body, start, booking.End is { } end && end > start ? end : null, zone);
            }
            else if (booking.CheckIn is { } checkIn)
            {
                AllDay(body, checkIn, booking.CheckOut);
            }
            else if (booking.Date is { } date) AllDay(body, date);
            else continue; // An undated booking has no calendar representation.
            events.Add($"booking:{booking.Id}", body);
        }
        foreach (var stay in snapshot.Stays.Where(x => !Cancelled(x.Status)))
        {
            if (!string.IsNullOrEmpty(stay.BookingId)
                && snapshot.Bookings.Any(booking => booking.Id == stay.BookingId && RepresentsStayInterval(booking, stay))) continue;
            var title = string.IsNullOrWhiteSpace(stay.Name) ? $"Stay in {stay.City}" : stay.Name;
            var body = Event(title, Join(stay.Notes, "Planned city stay; not a hotel reservation."), stay.Status, stay.City, Search(stay.City));
            AllDay(body, stay.CheckIn, stay.CheckOut);
            events.Add($"stay:{stay.Id}", body);
        }
        Anchor("arrival", "Arrive", snapshot.Trip.Arrival);
        Anchor("departure", "Depart", snapshot.Trip.Departure);
        return events;

        void Anchor(string key, string label, FlightAnchor? anchor)
        {
            if (anchor is null) return;
            var body = Event($"{label} {anchor.Airport}", anchor.Raw, "planned", anchor.Airport, Search(anchor.Airport));
            if (anchor.LocalDateTime is { } instant) Timed(body, instant, null, zone);
            else if (anchor.Date is { } date) AllDay(body, date);
            else return;
            events.Add($"anchor:{key}", body);
        }
    }

    private static JsonObject Event(string title, string? notes, string? status, string? location, string? maps)
    {
        var description = WebUtility.HtmlEncode(Join(notes, $"Plan status: {status ?? "planned"}", "Managed by Detour. Edit the plan in Detour to update this event."));
        if (!string.IsNullOrWhiteSpace(maps))
            description += $"\n<a href=\"{WebUtility.HtmlEncode(maps)}\">Open Google Maps</a>";
        return new JsonObject
        {
            ["summary"] = title,
            ["description"] = description,
            ["location"] = location ?? "",
            ["status"] = status?.Equals("confirmed", StringComparison.OrdinalIgnoreCase) == true ? "confirmed" : "tentative",
            ["reminders"] = new JsonObject { ["useDefault"] = false, ["overrides"] = new JsonArray() }
        };
    }

    private static void When(JsonObject body, DateOnly date, TimeOnly? time, int? duration, string zone)
    {
        if (time is null) { AllDay(body, date); return; }
        var local = date.ToDateTime(time.Value, DateTimeKind.Unspecified);
        var tz = TimeZoneInfo.FindSystemTimeZoneById(zone);
        if (tz.IsInvalidTime(local) || tz.IsAmbiguousTime(local))
            throw new ArgumentException("A plan time falls in a daylight-saving transition. Choose an unambiguous time before syncing.");
        var start = new DateTimeOffset(local, tz.GetUtcOffset(local));
        Timed(body, start, duration is > 0 ? start.AddMinutes(duration.Value) : null, zone);
    }

    private static void Timed(JsonObject body, DateTimeOffset start, DateTimeOffset? end, string zone)
    {
        body["start"] = new JsonObject { ["dateTime"] = start.ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture), ["timeZone"] = zone };
        body["end"] = new JsonObject { ["dateTime"] = (end ?? start.AddMinutes(1)).ToString("yyyy-MM-dd'T'HH:mm:sszzz", CultureInfo.InvariantCulture), ["timeZone"] = zone };
        if (end is null)
        {
            body["description"] = body["description"]!.GetValue<string>() + "\nDuration unknown; shown as a one-minute calendar marker.";
            body["transparency"] = "transparent";
        }
        else body["transparency"] = "opaque";
    }

    private static void AllDay(JsonObject body, DateOnly start, DateOnly? end = null)
    {
        if (end is { } explicitEnd && explicitEnd <= start)
            throw new ArgumentException("A calendar stay or booking must end after its start date.");
        body["start"] = new JsonObject { ["date"] = start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) };
        body["end"] = new JsonObject { ["date"] = (end ?? start.AddDays(1)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) };
        body["transparency"] = "transparent";
        body["description"] = body["description"]!.GetValue<string>() + "\nDate-only plan; clock time is not set.";
    }

    private static bool Cancelled(string? status) => status?.Equals("cancelled", StringComparison.OrdinalIgnoreCase) == true || status?.Equals("canceled", StringComparison.OrdinalIgnoreCase) == true;
    private static bool RepresentsStayInterval(Booking booking, Stay stay)
    {
        var kind = booking.Kind?.Trim() ?? "";
        var accommodation = kind.Equals("hotel", StringComparison.OrdinalIgnoreCase)
            || kind.Equals("accommodation", StringComparison.OrdinalIgnoreCase)
            || kind.Equals("lodging", StringComparison.OrdinalIgnoreCase)
            || kind.Equals("hostel", StringComparison.OrdinalIgnoreCase)
            || kind.Equals("ryokan", StringComparison.OrdinalIgnoreCase)
            || kind.Equals("guesthouse", StringComparison.OrdinalIgnoreCase)
            || kind.Equals("apartment", StringComparison.OrdinalIgnoreCase)
            || kind.Equals("airbnb", StringComparison.OrdinalIgnoreCase);
        return !Cancelled(booking.Status)
            && accommodation
            && booking.Start is null
            && booking.CheckIn is { } checkIn
            && booking.CheckOut is { } checkOut
            && checkOut > checkIn
            && checkIn == stay.CheckIn
            && checkOut == stay.CheckOut;
    }
    private static string Join(params string?[] lines) => string.Join("\n\n", lines.Where(x => !string.IsNullOrWhiteSpace(x)));
    private static string? Search(string? query) => string.IsNullOrWhiteSpace(query) ? null : $"https://www.google.com/maps/search/?api=1&query={Uri.EscapeDataString(query)}";
    private static string Directions(string origin, string destination, string? mode)
    {
        var travelMode = mode switch { "walk" or "walking" => "walking", "car" or "driving" => "driving", "bike" or "bicycling" => "bicycling", "train" or "bus" or "transit" => "transit", _ => null };
        return $"https://www.google.com/maps/dir/?api=1&origin={Uri.EscapeDataString(origin)}&destination={Uri.EscapeDataString(destination)}" + (travelMode is null ? "" : $"&travelmode={travelMode}");
    }
}
