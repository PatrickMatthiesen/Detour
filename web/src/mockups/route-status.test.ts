import { describe, expect, it } from "vitest";
import type { Booking, Stay, TripSnapshot } from "../types";
import { buildRouteStops, STATUS_COLORS, summarizeCityStops } from "./route-status";

function snapshot(stays: Stay[] = [], bookings: Booking[] = []): TripSnapshot {
  return {
    version: 1,
    trip: { id: "japan", name: "Japan", startDate: "2026-10-01", endDate: "2026-10-31" },
    places: [],
    stays,
    travelLegs: [],
    activities: [],
    bookings,
    tasks: [],
    packingItems: [],
  };
}

function stay(id: string, city: string, checkIn: string, checkOut: string, extra: Partial<Stay> = {}): Stay {
  return { id, city, checkIn, checkOut, ...extra };
}

function booking(id: string, city: string | null, checkIn: string, checkOut: string, extra: Partial<Booking> = {}): Booking {
  return { id, kind: "hotel", title: `${city ?? "Unspecified"} hotel`, status: "confirmed", location: city, checkIn, checkOut, ...extra };
}

describe("buildRouteStops", () => {
  it("returns no route for a missing trip and exposes the fixed status palette", () => {
    expect(buildRouteStops(null)).toEqual([]);
    expect(STATUS_COLORS).toEqual({
      saved: "#64748b",
      picked: "#b94f3f",
      partial: "#996b17",
      booked: "#287052",
    });
  });

  it("requires an exact city match and booking dates that overlap the stay", () => {
    const stops = buildRouteStops(snapshot(
      [stay("tokyo", "Tokyo", "2026-10-01", "2026-10-05")],
      [
        booking("wrong-city", "Kyoto", "2026-10-01", "2026-10-05", { title: "Tokyo hotel package" }),
        booking("wrong-dates", "Tokyo", "2026-10-06", "2026-10-08"),
        booking("not-accommodation", "Tokyo", "2026-10-01", "2026-10-05", { kind: "train" }),
      ],
    ));

    expect(stops).toEqual([expect.objectContaining({
      city: "Tokyo",
      status: "picked",
      bookedNights: 0,
      totalNights: 4,
      label: "Not booked",
      detail: "0 of 4 nights booked",
    })]);
  });

  it("treats checkout as exclusive and reports partial coverage", () => {
    const [stop] = buildRouteStops(snapshot(
      [stay("tokyo", "Tokyo", "2026-10-01", "2026-10-05")],
      [booking("hotel", "Tokyo", "2026-10-02", "2026-10-04")],
    ));

    expect(stop).toMatchObject({
      status: "partial",
      bookedNights: 2,
      totalNights: 4,
      label: "Partly booked",
      detail: "2 of 4 nights booked",
    });
  });

  it("leaves a stay picked when a matching booking checks out as the stay begins", () => {
    const [stop] = buildRouteStops(snapshot(
      [stay("tokyo", "Tokyo", "2026-10-01", "2026-10-05")],
      [booking("earlier-hotel", "Tokyo", "2026-09-28", "2026-10-01")],
    ));

    expect(stop).toMatchObject({ status: "picked", bookedNights: 0, totalNights: 4 });
  });

  it("deduplicates overlapping confirmed accommodation bookings", () => {
    const [stop] = buildRouteStops(snapshot(
      [stay("nikko", "Nikkō", "2026-10-01", "2026-10-05")],
      [
        booking("first", " nikko ", "2026-10-01", "2026-10-04", { kind: "ryokan" }),
        booking("second", "NIKKŌ", "2026-10-03", "2026-10-05", { kind: "accommodation" }),
      ],
    ));

    expect(stop).toMatchObject({ status: "booked", bookedNights: 4, totalNights: 4, label: "Booked" });
  });

  it("merges only contiguous or overlapping adjacent visits to the same city", () => {
    const stops = buildRouteStops(snapshot([
      stay("late", "Tokyo", "2026-10-09", "2026-10-11"),
      stay("first", "Tokyo", "2026-10-01", "2026-10-04"),
      stay("overlap", "Tokyo", "2026-10-03", "2026-10-05"),
      stay("contiguous", "Tokyo", "2026-10-05", "2026-10-07"),
      stay("kyoto", "Kyoto", "2026-10-07", "2026-10-09"),
    ]));

    expect(stops.map(({ city, checkIn, checkOut, totalNights }) => ({ city, checkIn, checkOut, totalNights }))).toEqual([
      { city: "Tokyo", checkIn: "2026-10-01", checkOut: "2026-10-07", totalNights: 6 },
      { city: "Kyoto", checkIn: "2026-10-07", checkOut: "2026-10-09", totalNights: 2 },
      { city: "Tokyo", checkIn: "2026-10-09", checkOut: "2026-10-11", totalNights: 2 },
    ]);
  });

  it("excludes both cancelled and canceled stays and accepts only confirmed bookings", () => {
    const stops = buildRouteStops(snapshot(
      [
        stay("cancelled", "Kyoto", "2026-10-01", "2026-10-03", { status: "cancelled" }),
        stay("canceled", "Osaka", "2026-10-01", "2026-10-03", { status: "canceled" }),
        stay("active", "Tokyo", "2026-10-03", "2026-10-05"),
      ],
      [
        booking("cancelled-booking", "Tokyo", "2026-10-03", "2026-10-05", { status: "cancelled" }),
        booking("canceled-booking", "Tokyo", "2026-10-03", "2026-10-05", { status: "canceled" }),
      ],
    ));

    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ city: "Tokyo", status: "picked", bookedNights: 0 });
  });

  it("does not mark missing, impossible, reversed, or zero-night dates as booked", () => {
    const malformed = [
      stay("missing", "Tokyo", "", "2026-10-03"),
      stay("impossible", "Kyoto", "2026-02-30", "2026-03-02"),
      stay("reversed", "Osaka", "2026-10-05", "2026-10-03"),
      stay("zero", "Nagoya", "2026-10-05", "2026-10-05"),
    ];
    const stops = buildRouteStops(snapshot(malformed, [booking("hotel", "Nagoya", "2026-10-04", "2026-10-06")]));

    expect(stops).toHaveLength(4);
    expect(stops.every((stop) => stop.status === "picked" && stop.bookedNights === 0 && stop.totalNights === 0)).toBe(true);
    expect(stops.every((stop) => stop.detail === "Stay dates need checking")).toBe(true);
  });

  it("trusts linked bookings with no location or a full address", () => {
    const accepted = buildRouteStops(snapshot(
      [stay("tokyo", "Tokyo", "2026-10-01", "2026-10-03", { bookingId: "linked" })],
      [booking("linked", null, "2026-10-01", "2026-10-03")],
    ));
    const fullAddress = buildRouteStops(snapshot(
      [stay("tokyo", "Tokyo", "2026-10-01", "2026-10-03", { bookingId: "linked" })],
      [booking("linked", "144-0033 Tokyo, Ota Ward, Haneda 5-1", "2026-10-01", "2026-10-03")],
    ));

    expect(accepted[0]).toMatchObject({ status: "booked", bookedNights: 2 });
    expect(fullAddress[0]).toMatchObject({ status: "booked", bookedNights: 2 });
  });

  it("rejects a linked booking whose location is exactly another known stay city", () => {
    const rejected = buildRouteStops(snapshot(
      [
        stay("tokyo", "Tokyo", "2026-10-01", "2026-10-03", { bookingId: "linked" }),
        stay("kyoto", "Kyoto", "2026-10-05", "2026-10-07"),
      ],
      [booking("linked", "Kyoto", "2026-10-01", "2026-10-03")],
    ));

    expect(rejected[0]).toMatchObject({ status: "picked", bookedNights: 0 });
  });
});

describe("summarizeCityStops", () => {
  it("marks mixed separated visits amber and reports visit and night coverage", () => {
    const stops = buildRouteStops(snapshot(
      [
        stay("one", "Tokyo", "2026-10-01", "2026-10-05"),
        stay("two", "Tokyo", "2026-10-08", "2026-10-12"),
        stay("three", "Tokyo", "2026-10-15", "2026-10-17"),
      ],
      [
        booking("one-hotel", "Tokyo", "2026-10-01", "2026-10-05"),
        booking("two-hotel", "Tokyo", "2026-10-08", "2026-10-12"),
      ],
    ));

    expect(summarizeCityStops(stops).Tokyo).toEqual({
      status: "partial",
      label: "Partly booked",
      detail: "2 of 3 stays booked · 8 of 10 nights booked",
    });
  });

  it("keeps a city picked when none of its visits has a known night", () => {
    const stops = buildRouteStops(snapshot([stay("unknown", "Tokyo", "", "")]));
    expect(summarizeCityStops(stops).Tokyo).toEqual({
      status: "picked",
      label: "Not booked",
      detail: "0 of 1 stays booked · 0 of 0 nights booked",
    });
  });

  it("publishes one aggregate under every display spelling of an aliased city", () => {
    const stops = buildRouteStops(snapshot(
      [
        stay("latin", "Nikko", "2026-10-01", "2026-10-03"),
        stay("macron", "Nikkō", "2026-10-05", "2026-10-07"),
      ],
      [booking("ryokan", "Nikkō", "2026-10-01", "2026-10-03")],
    ));
    const summary = summarizeCityStops(stops);

    expect(summary.Nikko).toEqual({
      status: "partial",
      label: "Partly booked",
      detail: "1 of 2 stays booked · 2 of 4 nights booked",
    });
    expect(summary["Nikkō"]).toEqual(summary.Nikko);
  });
});
