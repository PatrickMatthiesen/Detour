using System.ComponentModel;
using System.Text.Json.Serialization;

namespace Detour.Api;

// Omitted/null properties preserve existing values. clearFields explicitly clears nullable fields.
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class PlaceChanges
{
    private PhotoInput? photo;

    public string? Name { get; set; }
    public string? City { get; set; }
    public string? Area { get; set; }
    public string? Category { get; set; }
    public string? Description { get; set; }
    public string? Tips { get; set; }
    public string? Notes { get; set; }
    [Description("Original source provenance. Preserve unless explicitly correcting it.")]
    public string? SourceUrl { get; set; }
    public string? GoogleMapsUrl { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public int? DurationMinutes { get; set; }
    public string? Priority { get; set; }
    public string? Status { get; set; }
    public bool? Selected { get; set; }
    public bool? ReservationRequired { get; set; }
    public string? OpeningHours { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.Never)]
    [Description("Photo change. Omit to preserve the current photo, use null to remove it, or provide a public image URL and optional attribution to import and replace it.")]
    public PhotoInput? Photo
    {
        get => photo;
        set
        {
            photo = value;
            PhotoSpecified = true;
        }
    }

    [JsonIgnore]
    public bool PhotoSpecified { get; private set; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class PhotoInput
{
    [Description("Direct public HTTP(S) image URL. Private, local, credential-bearing, and non-standard-port URLs are rejected.")]
    public required string Url { get; set; }

    [Description("HTTP(S) page where the image came from, retained for attribution.")]
    public string? SourceUrl { get; set; }

    [Description("Image author or photographer, when known.")]
    public string? Author { get; set; }

    [Description("Short display caption.")]
    public string? Caption { get; set; }

    [Description("One of place, neighbourhood, or illustrative. Defaults to place.")]
    public string? Kind { get; set; }

    [Description("Image license, when known.")]
    public string? License { get; set; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class BookingChanges
{
    public string? Kind { get; set; }
    public string? Title { get; set; }
    public string? Status { get; set; }
    public string? ConfirmationCode { get; set; }
    public string? Provider { get; set; }
    public string? Url { get; set; }
    public DateOnly? Date { get; set; }
    public DateOnly? CheckIn { get; set; }
    public DateOnly? CheckOut { get; set; }
    public DateTimeOffset? Start { get; set; }
    public DateTimeOffset? End { get; set; }
    public string? Location { get; set; }
    public string? Notes { get; set; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class TripTaskChanges
{
    public string? Title { get; set; }
    public DateOnly? DueDate { get; set; }
    public bool? Completed { get; set; }
    [Description("Task timing: before or during. Use before for Before departure.")]
    public string? Scope { get; set; }
    public string? RelatedId { get; set; }
    public DateTimeOffset? ReminderAt { get; set; }
    public string? Notes { get; set; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class PackingItemChanges
{
    public string? Name { get; set; }
    public string? Category { get; set; }
    public int? Quantity { get; set; }
    public bool? Packed { get; set; }
    public string? Bag { get; set; }
    public string? Notes { get; set; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class ActivityChanges
{
    public string? PlaceId { get; set; }
    public string? Title { get; set; }
    public DateOnly? Date { get; set; }
    public TimeOnly? StartTime { get; set; }
    public int? DurationMinutes { get; set; }
    public string? Status { get; set; }
    public string? Notes { get; set; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class StayChanges
{
    public string? City { get; set; }
    public DateOnly? CheckIn { get; set; }
    public DateOnly? CheckOut { get; set; }
    public string? Name { get; set; }
    public string? Status { get; set; }
    public string? BookingId { get; set; }
    public string? Notes { get; set; }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed class TravelLegChanges
{
    public string? From { get; set; }
    public string? To { get; set; }
    public DateOnly? Date { get; set; }
    public int? DurationMinutes { get; set; }
    public string? Mode { get; set; }
    public bool? Estimated { get; set; }
    public string? Notes { get; set; }
}

[JsonConverter(typeof(JsonStringEnumConverter<EditOperation>))]
public enum EditOperation { create, update, delete }

[JsonConverter(typeof(JsonStringEnumConverter<TripSection>))]
public enum TripSection { summary, places, bookings, tasks, packingItems, activities, stays, travelLegs, all }
