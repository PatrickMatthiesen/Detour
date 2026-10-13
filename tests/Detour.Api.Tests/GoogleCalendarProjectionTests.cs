using Detour.Api;

namespace Detour.Api.Tests;

public sealed class GoogleCalendarProjectionTests
{
    [Fact]
    public void Operational_event_keeps_local_time_notes_maps_and_reminder()
    {
        var trip = new TripSnapshot
        {
            Activities = [new Activity { Id = "checkout", Kind = "check-out", Title = "Check out", Date = new(2026, 10, 8), StartTime = new(10, 0), DurationMinutes = 15, Notes = "Leave bags at reception <ask first>", Location = "Hotel in Kyoto", GoogleMapsUrl = "https://www.google.com/maps/search/?api=1&query=hotel", ReminderMinutes = 30 }]
        };
        var body = GoogleCalendarProjection.Build(trip)["activity:checkout"];
        Assert.Equal("2026-10-08T10:00:00+09:00", body["start"]!["dateTime"]!.GetValue<string>());
        Assert.Equal("2026-10-08T10:15:00+09:00", body["end"]!["dateTime"]!.GetValue<string>());
        Assert.Equal("Asia/Tokyo", body["start"]!["timeZone"]!.GetValue<string>());
        Assert.Contains("Leave bags at reception &lt;ask first&gt;", body["description"]!.GetValue<string>());
        Assert.Contains("Open Google Maps", body["description"]!.GetValue<string>());
        Assert.Equal(30, body["reminders"]!["overrides"]![0]!["minutes"]!.GetValue<int>());
    }

    [Fact]
    public void Saved_places_and_cancelled_records_are_not_calendar_events()
    {
        var trip = new TripSnapshot
        {
            Places = [new Place { Id = "idea", Name = "Idea", City = "Tokyo", Selected = true }],
            Activities = [new Activity { Id = "cancelled", Title = "Skip", Date = new(2026, 10, 8), Status = "Cancelled" }],
            Bookings = [new Booking { Id = "cancelled", Title = "Skip", Date = new(2026, 10, 8), Status = "canceled" }]
        };
        Assert.Empty(GoogleCalendarProjection.Build(trip));
    }

    [Fact]
    public void Departure_linked_to_a_place_keeps_its_title_and_does_not_inherit_visit_duration()
    {
        var trip = new TripSnapshot
        {
            Places = [new Place { Id = "museum", Name = "Museum", City = "Tokyo", DurationMinutes = 90 }],
            Activities = [new Activity { Id = "leave", PlaceId = "museum", Title = "Leave for lunch", Kind = "departure", Date = new(2026, 10, 8), StartTime = new(12, 0) }]
        };
        var body = GoogleCalendarProjection.Build(trip)["activity:leave"];
        Assert.Equal("Leave for lunch", body["summary"]!.GetValue<string>());
        Assert.Contains("Duration unknown", body["description"]!.GetValue<string>());
        Assert.Equal("2026-10-08T12:01:00+09:00", body["end"]!["dateTime"]!.GetValue<string>());
    }

    [Fact]
    public void Date_only_hotel_uses_exclusive_checkout_and_omits_duplicate_linked_stay_and_secrets()
    {
        var trip = new TripSnapshot
        {
            Bookings = [new Booking { Id = "hotel", Title = "Hotel", Kind = "hotel", CheckIn = new(2026, 10, 8), CheckOut = new(2026, 10, 11), BookingNumber = "SECRET", Pin = "PIN", ConfirmationCode = "CODE" }],
            Stays = [new Stay { Id = "stay", City = "Kyoto", BookingId = "hotel", CheckIn = new(2026, 10, 8), CheckOut = new(2026, 10, 11) }]
        };
        var events = GoogleCalendarProjection.Build(trip);
        var body = Assert.Single(events).Value;
        Assert.Equal("2026-10-11", body["end"]!["date"]!.GetValue<string>());
        Assert.Null(body["start"]!["dateTime"]);
        Assert.DoesNotContain("SECRET", body.ToJsonString());
        Assert.DoesNotContain("PIN", body.ToJsonString());
        Assert.DoesNotContain("CODE", body.ToJsonString());
    }

    [Fact]
    public void Unknown_duration_is_an_explicit_marker_and_untimed_activity_stays_date_only()
    {
        var trip = new TripSnapshot
        {
            Activities = [new Activity { Id = "leave", Title = "Leave", Date = new(2026, 10, 8), StartTime = new(23, 59) }, new Activity { Id = "later", Title = "Later", Date = new(2026, 10, 8), DurationMinutes = 60 }]
        };
        var events = GoogleCalendarProjection.Build(trip);
        Assert.Equal("2026-10-09T00:00:00+09:00", events["activity:leave"]["end"]!["dateTime"]!.GetValue<string>());
        Assert.Contains("Duration unknown", events["activity:leave"]["description"]!.GetValue<string>());
        Assert.Equal("transparent", events["activity:leave"]["transparency"]!.GetValue<string>());
        Assert.Equal("2026-10-08", events["activity:later"]["start"]!["date"]!.GetValue<string>());
        Assert.Null(events["activity:later"]["start"]!["dateTime"]);
    }

    [Fact]
    public void Journey_has_directions_and_booking_preserves_actual_offset()
    {
        var trip = new TripSnapshot
        {
            TravelLegs = [new TravelLeg { Id = "train", From = "Tokyo station", To = "Kyoto station", Date = new(2026, 10, 8), StartTime = new(12, 0), DurationMinutes = 140, Mode = "train" }],
            Bookings = [new Booking { Id = "flight", Title = "Flight", Start = DateTimeOffset.Parse("2026-10-01T20:00:00+02:00"), End = DateTimeOffset.Parse("2026-10-02T12:00:00+09:00") }]
        };
        var events = GoogleCalendarProjection.Build(trip);
        Assert.Contains("destination=Kyoto%20station", events["travel:train"]["description"]!.GetValue<string>());
        Assert.Contains("travelmode=transit", events["travel:train"]["description"]!.GetValue<string>());
        Assert.Equal("2026-10-01T20:00:00+02:00", events["booking:flight"]["start"]!["dateTime"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("2026-03-29", 2, 30)]
    [InlineData("2026-10-25", 2, 30)]
    public void Does_not_guess_a_time_during_daylight_saving_transitions(string date, int hour, int minute)
    {
        var trip = new TripSnapshot
        {
            Trip = new TripDocument { TimeZone = "Europe/Copenhagen" },
            Activities = [new Activity { Id = "step", Title = "Step", Date = DateOnly.Parse(date), StartTime = new(hour, minute) }]
        };
        Assert.Throws<ArgumentException>(() => GoogleCalendarProjection.Build(trip));
    }

    [Theory]
    [InlineData("wrong", null, null)]
    [InlineData("departure", -1, null)]
    [InlineData("departure", 40321, null)]
    [InlineData("departure", 10, "javascript:alert(1)")]
    [InlineData("departure", 10, "https://user:password@example.test")]
    public void Invalid_event_fields_are_rejected(string kind, int? reminder, string? url)
    {
        var activity = new Activity { Title = "Leave", Date = new(2026, 10, 8), Kind = kind, ReminderMinutes = reminder, GoogleMapsUrl = url };
        Assert.NotNull(CalendarEventValidation.ValidateActivity(activity, new TripSnapshot()));
    }
}
