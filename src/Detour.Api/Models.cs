namespace Detour.Api;

public sealed class TripSnapshot
{
    public long Version { get; set; }
    public TripDocument Trip { get; set; } = new();
    public List<Place> Places { get; set; } = [];
    public List<Stay> Stays { get; set; } = [];
    public List<TravelLeg> TravelLegs { get; set; } = [];
    public List<Activity> Activities { get; set; } = [];
    public List<Booking> Bookings { get; set; } = [];
    public List<TripTask> Tasks { get; set; } = [];
    public List<PackingItem> PackingItems { get; set; } = [];
}

public sealed class TripDocument
{
    public string Id { get; set; } = "japan-2026";
    public string Name { get; set; } = "Japan 2026";
    public DateOnly StartDate { get; set; } = new(2026, 9, 30);
    public DateOnly EndDate { get; set; } = new(2026, 10, 25);
    public string TimeZone { get; set; } = "Asia/Tokyo";
    public FlightAnchor? Arrival { get; set; }
    public FlightAnchor? Departure { get; set; }
}

public sealed class FlightAnchor
{
    public string Airport { get; set; } = "";
    public DateTimeOffset? LocalDateTime { get; set; }
    public DateOnly? Date { get; set; }
    public string Raw { get; set; } = "";
}

public sealed class Place
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public string City { get; set; } = "";
    public string? Area { get; set; }
    public string Category { get; set; } = "other";
    public string Description { get; set; } = "";
    public string Tips { get; set; } = "";
    public string Notes { get; set; } = "";
    public string SourceUrl { get; set; } = "";
    public string? GoogleMapsUrl { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)]
    public bool CoordinatesFromGoogle { get; set; }
    // A one-shot request from the place editor, never stored with trip data.
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)]
    public bool ResolveCoordinates { get; set; }
    public int? DurationMinutes { get; set; }
    public string Priority { get; set; } = "nice";
    public string Status { get; set; } = "candidate";
    public bool Selected { get; set; }
    public bool? ReservationRequired { get; set; }
    public string? OpeningHours { get; set; }
    private PhotoDescriptor? photo;
    public PhotoDescriptor? Photo { get => photo; set { photo = value; PhotoSpecified = true; } }
    [System.Text.Json.Serialization.JsonIgnore]
    public bool PhotoSpecified { get; private set; }
}

public sealed record PhotoDescriptor(
    Guid Id,
    string Url,
    string? SourceUrl,
    string? Author,
    string? Caption,
    string Kind,
    string? License);

public sealed class Stay
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string City { get; set; } = "";
    public DateOnly CheckIn { get; set; }
    public DateOnly CheckOut { get; set; }
    public string Name { get; set; } = "";
    public string Status { get; set; } = "planned";
    public string? BookingId { get; set; }
    public string Notes { get; set; } = "";
}

public sealed class Activity
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string? PlaceId { get; set; }
    public string? Title { get; set; }
    public DateOnly Date { get; set; }
    public TimeOnly? StartTime { get; set; }
    public int? DurationMinutes { get; set; }
    public string Status { get; set; } = "planned";
    public string Notes { get; set; } = "";
}

public sealed class TravelLeg
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string From { get; set; } = "";
    public string To { get; set; } = "";
    public DateOnly Date { get; set; }
    public int? DurationMinutes { get; set; }
    public string Mode { get; set; } = "other";
    public bool Estimated { get; set; } = true;
    public string Notes { get; set; } = "";
}

public sealed class Booking
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Kind { get; set; } = "other";
    public string Title { get; set; } = "";
    public string Status { get; set; } = "planned";
    public string? ConfirmationCode { get; set; }
    public string? Provider { get; set; }
    public string? Url { get; set; }
    public DateOnly? Date { get; set; }
    public DateOnly? CheckIn { get; set; }
    public DateOnly? CheckOut { get; set; }
    public DateTimeOffset? Start { get; set; }
    public DateTimeOffset? End { get; set; }
    public string? Location { get; set; }
    public string Notes { get; set; } = "";
}

public sealed class TripTask
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Title { get; set; } = "";
    public DateOnly? DueDate { get; set; }
    public bool Completed { get; set; }
    public string Scope { get; set; } = "trip";
    public string? RelatedId { get; set; }
    public DateTimeOffset? ReminderAt { get; set; }
    public string Notes { get; set; } = "";
}

public sealed class PackingItem
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "";
    public string Category { get; set; } = "other";
    public int Quantity { get; set; } = 1;
    public bool Packed { get; set; }
    public string? Bag { get; set; }
    public string Notes { get; set; } = "";
}

public abstract record ReplaceResult
{
    public sealed record Success(TripSnapshot Snapshot) : ReplaceResult;
    public sealed record Conflict(TripSnapshot Snapshot) : ReplaceResult;
    public sealed record Invalid(string? Message = null) : ReplaceResult;
    public sealed record PhotoFailed(string Message) : ReplaceResult;
}
