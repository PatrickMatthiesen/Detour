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

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Explicit_non_later_checkout_is_rejected_instead_of_expanding_the_stay(int nights)
    {
        var start = new DateOnly(2026, 10, 8);
        var snapshot = new TripSnapshot
        {
            Stays = [new Stay { Id = "stay", City = "Kyoto", CheckIn = start, CheckOut = start.AddDays(nights) }]
        };
        Assert.Throws<ArgumentException>(() => GoogleCalendarProjection.Build(snapshot));
    }

    [Fact]
    public void Booking_without_checkout_keeps_a_single_date_marker()
    {
        var snapshot = new TripSnapshot
        {
            Bookings = [new Booking { Id = "hotel", Kind = "hotel", CheckIn = new(2026, 10, 8) }]
        };
        var body = GoogleCalendarProjection.Build(snapshot)["booking:hotel"];
        Assert.Equal("2026-10-08", body["start"]!["date"]!.GetValue<string>());
        Assert.Equal("2026-10-09", body["end"]!["date"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("2026-10-08T12:00:00+09:00")]
    [InlineData("2026-10-08T11:59:00+09:00")]
    [InlineData("2026-10-08T03:00:00+00:00")]
    public void Explicit_non_later_timed_booking_end_is_rejected(string end)
    {
        var snapshot = new TripSnapshot
        {
            Bookings = [new Booking { Id = "flight", Start = DateTimeOffset.Parse("2026-10-08T12:00:00+09:00"), End = DateTimeOffset.Parse(end) }]
        };
        Assert.Throws<ArgumentException>(() => GoogleCalendarProjection.Build(snapshot));
    }

    [Fact]
    public void Timed_booking_without_end_remains_an_explicit_unknown_duration_marker()
    {
        var snapshot = new TripSnapshot
        {
            Bookings = [new Booking { Id = "flight", Start = DateTimeOffset.Parse("2026-10-08T12:00:00+09:00") }]
        };
        var body = GoogleCalendarProjection.Build(snapshot)["booking:flight"];
        Assert.Equal("2026-10-08T12:01:00+09:00", body["end"]!["dateTime"]!.GetValue<string>());
        Assert.Contains("Duration unknown", body["description"]!.GetValue<string>());
    }

    [Fact]
    public void Stay_is_suppressed_only_by_a_matching_active_accommodation_interval()
    {
        var checkIn = new DateOnly(2026, 10, 8);
        var checkOut = new DateOnly(2026, 10, 11);
        var trip = new TripSnapshot
        {
            Bookings =
            [
                new Booking { Id = "matching", Kind = "hotel", CheckIn = checkIn, CheckOut = checkOut },
                new Booking
                {
                    Id = "timed-hotel", Kind = "hotel", CheckIn = checkIn, CheckOut = checkOut,
                    Start = new DateTimeOffset(2026, 10, 9, 13, 0, 0, TimeSpan.FromHours(9)),
                    End = new DateTimeOffset(2026, 10, 9, 14, 0, 0, TimeSpan.FromHours(9))
                },
                new Booking { Id = "date-only", Kind = "hotel", Date = checkIn },
                new Booking { Id = "mismatch", Kind = "accommodation", CheckIn = checkIn.AddDays(1), CheckOut = checkOut },
                new Booking { Id = "timed-train", Kind = "train", Start = new DateTimeOffset(2026, 10, 8, 12, 0, 0, TimeSpan.FromHours(9)) },
                new Booking { Id = "cancelled", Kind = "hotel", Status = "cancelled", CheckIn = checkIn, CheckOut = checkOut },
                new Booking { Id = "undated", Kind = "hotel" }
            ],
            Stays =
            [
                new Stay { Id = "matching-stay", BookingId = "matching", City = "Kyoto", CheckIn = checkIn, CheckOut = checkOut },
                new Stay { Id = "timed-hotel-stay", BookingId = "timed-hotel", City = "Osaka", CheckIn = checkIn, CheckOut = checkOut },
                new Stay { Id = "date-only-stay", BookingId = "date-only", City = "Kyoto", CheckIn = checkIn, CheckOut = checkOut },
                new Stay { Id = "mismatch-stay", BookingId = "mismatch", City = "Kyoto", CheckIn = checkIn, CheckOut = checkOut },
                new Stay { Id = "timed-train-stay", BookingId = "timed-train", City = "Kyoto", CheckIn = checkIn, CheckOut = checkOut },
                new Stay { Id = "cancelled-stay", BookingId = "cancelled", City = "Kyoto", CheckIn = checkIn, CheckOut = checkOut },
                new Stay { Id = "undated-stay", BookingId = "undated", City = "Kyoto", CheckIn = checkIn, CheckOut = checkOut }
            ]
        };

        var events = GoogleCalendarProjection.Build(trip);

        Assert.Contains("booking:matching", events.Keys);
        Assert.DoesNotContain("stay:matching-stay", events.Keys);
        Assert.Contains("stay:timed-hotel-stay", events.Keys);
        Assert.Equal("2026-10-08", events["stay:timed-hotel-stay"]["start"]!["date"]!.GetValue<string>());
        Assert.Equal("2026-10-11", events["stay:timed-hotel-stay"]["end"]!["date"]!.GetValue<string>());
        Assert.Equal("Osaka", events["stay:timed-hotel-stay"]["location"]!.GetValue<string>());
        Assert.Contains("stay:date-only-stay", events.Keys);
        Assert.Contains("stay:mismatch-stay", events.Keys);
        Assert.Contains("stay:timed-train-stay", events.Keys);
        Assert.Contains("stay:cancelled-stay", events.Keys);
        Assert.Contains("stay:undated-stay", events.Keys);
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
