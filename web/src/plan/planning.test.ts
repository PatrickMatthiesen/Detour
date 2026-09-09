import { describe, expect, it } from "vitest";
import { datesForTrip, daySummary } from "./planning";
import type { TripSnapshot } from "../types";

function snapshot(overrides: Partial<TripSnapshot> = {}): TripSnapshot {
  return {
    version: 1,
    trip: {
      id: "trip",
      name: "Trip",
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      timeZone: "Asia/Tokyo",
      ...overrides.trip,
    },
    places: [],
    stays: [],
    travelLegs: [],
    activities: [],
    bookings: [],
    tasks: [],
    packingItems: [],
    ...overrides,
  };
}

describe("datesForTrip", () => {
  it("returns an inclusive date-only range independent of the machine timezone", () => {
    expect(datesForTrip(snapshot({
      trip: {
        id: "trip",
        name: "Trip",
        startDate: "2026-10-24",
        endDate: "2026-10-26",
        timeZone: "America/Los_Angeles",
      },
    }))).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(datesForTrip(snapshot({
      trip: { id: "trip", name: "Trip", startDate: "2026-10-26", endDate: "2026-10-24" },
    }))).toEqual([]);
  });
});

describe("daySummary", () => {
  it("uses hotel-night city bases, adds transfer endpoints, and leaves checkout unallocated", () => {
    const state = snapshot({
      stays: [
        { id: "s1", city: "Tokyo", checkIn: "2026-10-01", checkOut: "2026-10-03" },
        { id: "s2", city: "Tokyo", checkIn: "2026-10-02", checkOut: "2026-10-04" },
        { id: "s3", city: "Kyoto", checkIn: "2026-10-04", checkOut: "2026-10-05" },
      ],
      travelLegs: [{ id: "leg", from: "Tokyo", to: "Kyoto", date: "2026-10-03", durationMinutes: 90 }],
    });

    expect(daySummary(state, "2026-10-02").cities).toEqual(["Tokyo"]);
    expect(daySummary(state, "2026-10-03").cities).toEqual(["Tokyo", "Kyoto"]);
    expect(daySummary(state, "2026-10-05").cities).toEqual([]);
  });

  it("falls back to place duration, counts unknowns, and includes timed booking occupancy", () => {
    const state = snapshot({
      places: [{ id: "museum", name: "Museum", city: "Tokyo", durationMinutes: 120 }],
      activities: [
        { id: "a1", placeId: "museum", date: "2026-10-02" },
        { id: "a2", placeId: null, date: "2026-10-02" },
      ],
      travelLegs: [{ id: "leg", from: "Tokyo", to: "Nagoya", date: "2026-10-02", durationMinutes: 60 }],
      bookings: [{
        id: "flight", kind: "flight", title: "Flight", status: "confirmed", date: "2026-10-02",
        start: "2026-10-02T00:00:00+09:00", end: "2026-10-02T23:00:00+09:00",
      }],
    });

    expect(daySummary(state, "2026-10-02")).toMatchObject({
      knownMinutes: 900,
      unknownDurations: 1,
      unknownItems: ["a2"],
      remainingMinutes: 0,
    });
  });

  it("maps timestamp bookings into the trip timezone while preserving date-only fields", () => {
    const state = snapshot({
      bookings: [
        {
          id: "midnight-flight", kind: "flight", title: "Midnight flight", status: "confirmed",
          date: "2026-10-01", start: "2026-10-01T23:30:00-07:00", end: "2026-10-02T02:00:00-07:00",
        },
        { id: "date-only", kind: "ticket", title: "Ticket", status: "confirmed", date: "2026-10-01" },
        { id: "date-only-range", kind: "ticket", title: "Date-only range", status: "confirmed", start: "2026-10-03", end: "2026-10-04" },
        { id: "wall-time", kind: "ticket", title: "Wall time", status: "confirmed", start: "2026-10-04T23:30:00", end: "2026-10-05T01:00:00" },
      ],
    });

    expect(daySummary(state, "2026-10-01").bookings.map((booking) => booking.id)).toEqual([
      "midnight-flight", "date-only",
    ]);
    expect(daySummary(state, "2026-10-02").bookings.map((booking) => booking.id)).toEqual([
      "midnight-flight",
    ]);
    expect(daySummary(state, "2026-10-03").bookings.map((booking) => booking.id)).toEqual(["date-only-range"]);
    expect(daySummary(state, "2026-10-04").bookings.map((booking) => booking.id)).toEqual([
      "date-only-range", "wall-time",
    ]);
    expect(daySummary(state, "2026-10-05").bookings.map((booking) => booking.id)).toEqual(["wall-time"]);
  });

  it("marks only confirmed accommodation bookings that cover the night", () => {
    const state = snapshot({
      stays: [{ id: "planned", city: "Tokyo", checkIn: "2026-10-02", checkOut: "2026-10-05" }],
      bookings: [
        {
          id: "confirmed", kind: "hotel", title: "Hotel", status: "confirmed",
          checkIn: "2026-10-02", checkOut: "2026-10-04",
        },
        {
          id: "planned", kind: "hotel", title: "Unconfirmed hotel", status: "planned",
          checkIn: "2026-10-04", checkOut: "2026-10-05",
        },
      ],
    });

    expect(daySummary(state, "2026-10-02").accommodationCovered).toBe(true);
    expect(daySummary(state, "2026-10-03").accommodationCovered).toBe(true);
    expect(daySummary(state, "2026-10-04").accommodationCovered).toBe(false);
    expect(daySummary(state, "2026-10-04").bookings.map((booking) => booking.id)).toEqual([
      "confirmed", "planned",
    ]);
  });

  it("detects only real timed activity overlaps and ignores unknown or invalid durations", () => {
    const state = snapshot({
      activities: [
        { id: "a", placeId: null, date: "2026-10-02", startTime: "10:00", durationMinutes: 60 },
        { id: "b", placeId: null, date: "2026-10-02", startTime: "11:00", durationMinutes: 30 },
        { id: "c", placeId: null, date: "2026-10-02", startTime: "11:15", durationMinutes: 30 },
        { id: "unknown", placeId: null, date: "2026-10-02", startTime: "11:20" },
        { id: "invalid", placeId: null, date: "2026-10-02", startTime: "25:00", durationMinutes: 120 },
      ],
    });

    expect(daySummary(state, "2026-10-02")).toMatchObject({ overlaps: true, unknownDurations: 1, conflicts: ["b", "c"] });
  });

  it("converts overnight booking offsets to trip-local dates and clips each day to 09:00–21:00", () => {
    const state = snapshot({
      bookings: [{
        id: "overnight", kind: "rail", title: "Overnight rail", status: "confirmed",
        start: "2026-10-01T20:00:00+09:00", end: "2026-10-02T10:00:00+09:00",
      }, {
        id: "walltime", kind: "ticket", title: "Walltime ticket", status: "confirmed",
        start: "2026-10-02T20:00:00", end: "2026-10-02T22:00:00",
      }],
    });

    expect(daySummary(state, "2026-10-01")).toMatchObject({ knownMinutes: 60, unknownDurations: 0 });
    expect(daySummary(state, "2026-10-02")).toMatchObject({ knownMinutes: 120, unknownDurations: 0 });
  });

  it("unions touching timed items without double-counting and reports named conflicts", () => {
    const state = snapshot({
      activities: [
        { id: "a", title: "Museum", placeId: null, date: "2026-10-02", startTime: "09:30", durationMinutes: 60 },
        { id: "b", title: "Lunch", placeId: null, date: "2026-10-02", startTime: "10:30", durationMinutes: 30 },
      ],
      bookings: [{
        id: "ticket", kind: "ticket", title: "Museum ticket", status: "confirmed", date: "2026-10-02",
        start: "2026-10-02T09:00:00+09:00", end: "2026-10-02T09:30:00+09:00",
      }],
    });

    expect(daySummary(state, "2026-10-02")).toMatchObject({
      knownMinutes: 120,
      overlaps: false,
      conflicts: [],
    });
  });

  it("includes activity and booking conflicts while ignoring cancelled timed items", () => {
    const state = snapshot({
      activities: [
        { id: "tour", title: "Guided tour", placeId: null, date: "2026-10-02", startTime: "10:00", durationMinutes: 60 },
        { id: "cancelled-activity", title: "Cancelled activity", placeId: null, date: "2026-10-02", startTime: "10:15", durationMinutes: 120, status: "cancelled" },
      ],
      bookings: [
        {
          id: "reservation", kind: "ticket", title: "Museum reservation", status: "confirmed", date: "2026-10-02",
          start: "2026-10-02T10:30:00+09:00", end: "2026-10-02T11:30:00+09:00",
        },
        {
          id: "cancelled-booking", kind: "ticket", title: "Cancelled booking", status: "cancelled", date: "2026-10-02",
        },
      ],
    });

    expect(daySummary(state, "2026-10-02")).toMatchObject({
      knownMinutes: 90,
      unknownDurations: 0,
      overlaps: true,
      conflicts: ["Guided tour", "Museum reservation"],
    });
  });

  it("counts untimed durations and unknown nonhotel bookings once per day while excluding hotels", () => {
    const state = snapshot({
      activities: [{ id: "a", title: "Temple", placeId: null, date: "2026-10-02", durationMinutes: 90 }],
      travelLegs: [{ id: "leg", from: "Tokyo", to: "Kyoto", date: "2026-10-02" }],
      bookings: [
        { id: "unknown", kind: "ticket", title: "Open ticket", status: "confirmed", date: "2026-10-02" },
        { id: "hotel", kind: "hotel", title: "Hotel", status: "confirmed", date: "2026-10-02" },
      ],
    });

    expect(daySummary(state, "2026-10-02")).toMatchObject({
      knownMinutes: 90,
      unknownDurations: 2,
      unknownItems: ["Tokyo → Kyoto", "Open ticket"],
    });
  });
});
