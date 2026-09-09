import { describe, expect, it } from "vitest";
import type { Stay, TripSnapshot } from "../types";
import { editStayRoute, reorderStayRoute, reviewStayRoute, shiftDate } from "./stay-editing";

const stay = (id: string, city: string, checkIn: string, checkOut: string, extra: Partial<Stay> = {}): Stay => ({
  id, city, checkIn, checkOut, ...extra,
});

function snapshot(overrides: Partial<TripSnapshot> = {}): TripSnapshot {
  return {
    version: 1,
    trip: { id: "trip", name: "Trip", startDate: "2026-10-01", endDate: "2026-10-10", timeZone: "Asia/Tokyo" },
    places: [], stays: [], travelLegs: [], activities: [], bookings: [], tasks: [], packingItems: [],
    ...overrides,
  };
}

describe("stay editing", () => {
  it("shifts date-only values without local timezone effects", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDate("invalid", 1)).toBe("invalid");
  });

  it("adds and replaces without mutating the source route", () => {
    const original = [stay("a", "Tokyo", "2026-10-01", "2026-10-03")];
    const edited = stay("a", "Osaka", "2026-10-02", "2026-10-05");
    const result = editStayRoute(original, edited, false);
    expect(result).toEqual([edited]);
    expect(original).toEqual([stay("a", "Tokyo", "2026-10-01", "2026-10-03")]);
    expect(result).not.toBe(original);
    expect(editStayRoute(original, stay("b", "Kyoto", "2026-10-04", "2026-10-06"), false).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("shifts later stays only when requested and preserves their durations", () => {
    const route = [
      stay("a", "Tokyo", "2026-10-01", "2026-10-03"),
      stay("b", "Kyoto", "2026-10-03", "2026-10-06"),
      stay("c", "Osaka", "2026-10-07", "2026-10-08"),
    ];
    const edited = stay("a", "Tokyo", "2026-10-01", "2026-10-04");
    expect(editStayRoute(route, edited, false).map((item) => [item.id, item.checkIn, item.checkOut])).toEqual([
      ["a", "2026-10-01", "2026-10-04"], ["b", "2026-10-03", "2026-10-06"], ["c", "2026-10-07", "2026-10-08"],
    ]);
    expect(editStayRoute(route, edited, true).map((item) => [item.id, item.checkIn, item.checkOut])).toEqual([
      ["a", "2026-10-01", "2026-10-04"], ["b", "2026-10-04", "2026-10-07"], ["c", "2026-10-08", "2026-10-09"],
    ]);
    expect(route[1].checkIn).toBe("2026-10-03");
  });

  it("reorders adjacent stays while retaining durations, gap, and outer bounds", () => {
    const route = [
      stay("a", "Tokyo", "2026-10-01", "2026-10-03"),
      stay("b", "Kyoto", "2026-10-05", "2026-10-08"),
      stay("c", "Osaka", "2026-10-10", "2026-10-12"),
    ];
    const result = reorderStayRoute(route, "b", -1);
    expect(result.map((item) => [item.id, item.checkIn, item.checkOut])).toEqual([
      ["b", "2026-10-01", "2026-10-04"], ["a", "2026-10-06", "2026-10-08"], ["c", "2026-10-10", "2026-10-12"],
    ]);
    expect(route[0].checkIn).toBe("2026-10-01");
    expect(reorderStayRoute(route, "a", -1).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("reports strict date, city, night, bounds, and overlap errors", () => {
    const result = reviewStayRoute(snapshot({ stays: [stay("old", "Tokyo", "2026-10-01", "2026-10-03")] }), [
      stay("bad", " ", "2026-02-30", "2026-10-01"),
      stay("base", "Tokyo", "2026-10-01", "2026-10-03"),
      stay("overlap", "Kyoto", "2026-10-02", "2026-10-04"),
      stay("outside", "Osaka", "2026-10-09", "2026-10-11"),
    ]);
    expect(result.errors.join(" ")).toMatch(/invalid check-in|needs a city|at least one night|ends after the trip|overlap/);
    expect(result.errors.some((error) => error.includes("overlap"))).toBe(true);
  });

  it("keeps repeated city identity quiet while showing a name-only change", () => {
    const current = stay("a", "Tokyo", "2026-10-01", "2026-10-03", { name: "Old hotel" });
    const result = reviewStayRoute(snapshot({ stays: [current] }), [
      stay("a", "Tokyo", "2026-10-01", "2026-10-03", { name: "New hotel" }),
    ]);
    expect(result.changes).toEqual(["Tokyo name: Old hotel → New hotel."]);
    expect(result.warnings).toEqual([]);
  });

  it("reviews activities, fixed linked bookings, travel boundaries, unallocated nights, and uncovered nights", () => {
    const result = reviewStayRoute(snapshot({
      stays: [stay("a", "Tokyo", "2026-10-01", "2026-10-04", { bookingId: "hotel" })],
      places: [{ id: "museum", name: "Museum", city: "Tokyo" }],
      activities: [{ id: "activity", placeId: "museum", title: "Museum", date: "2026-10-02" }],
      travelLegs: [{ id: "leg", from: "Tokyo", to: "Kyoto", date: "2026-10-04", mode: "train", durationMinutes: 90 }],
      bookings: [{ id: "hotel", kind: "hotel", title: "Tokyo Hotel", status: "confirmed", location: "Tokyo", checkIn: "2026-10-01", checkOut: "2026-10-04" }],
    }), [stay("b", "Kyoto", "2026-10-05", "2026-10-07")]);
    expect(result.changes.some((change) => change.startsWith("Removed stay in Tokyo"))).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/Scheduled activity.*Museum|Travel leg.*Tokyo.*Kyoto|Confirmed booking.*Tokyo Hotel|Unallocated route nights|Uncovered accommodation nights/);
  });

  it("flags new adjacent city links that have no recorded travel leg", () => {
    const result = reviewStayRoute(snapshot({ stays: [stay("a", "Tokyo", "2026-10-01", "2026-10-03")] }), [
      stay("a", "Tokyo", "2026-10-01", "2026-10-03"),
      stay("b", "Kyoto", "2026-10-03", "2026-10-05"),
    ]);
    expect(result.warnings.some((warning) => warning.includes("Route link needs planning: Tokyo → Kyoto"))).toBe(true);
  });
});


describe("route review guarantees", () => {
  it("distinguishes repeated Tokyo stays and never changes fixed records", () => {
    const original = snapshot({stays:[stay("z", "Tokyo", "2026-10-01", "2026-10-03"),stay("a", "Tokyo", "2026-10-07", "2026-10-09")],bookings:[{id:"hotel",kind:"hotel",title:"Hotel",status:"confirmed",checkIn:"2026-10-07",checkOut:"2026-10-09"}],activities:[{id:"act",placeId:null,title:"Visit",date:"2026-10-07"}],travelLegs:[{id:"leg",from:"Kyoto",to:"Tokyo",date:"2026-10-07"}]});
    const before = structuredClone(original);
    const proposed = editStayRoute(original.stays,{...original.stays[1],checkIn:"2026-10-08"},false);
    const review = reviewStayRoute(original,proposed);
    expect(proposed[0]).toEqual(original.stays[0]);
    expect(original).toEqual(before);
    expect(review.warnings.some(w=>w.includes('Hotel') && w.includes('fixed'))).toBe(true);
    expect(review.warnings.some(w=>w.includes('Visit') && w.includes('unassigned'))).toBe(true);
  });
  it("formats fixed booking instants in the trip timezone with no invented end", () => {
    const original = snapshot({stays:[stay("a","Tokyo","2026-10-01","2026-10-03")],bookings:[{id:"flight",kind:"flight",title:"Arrival",status:"confirmed",date:"2026-10-01",start:"2026-10-01T17:05:00+02:00"}]});
    const review = reviewStayRoute(original,editStayRoute(original.stays,{...original.stays[0],city:"Kyoto"},false));
    const warning = review.warnings.find(w=>w.includes('Arrival'))!;
    expect(warning).toContain('2 Oct, 00:05');
    expect(warning).not.toContain('?');
  });
  it("rejects both zero-night stays and overlaps independently", () => {
    expect(reviewStayRoute(snapshot(),[stay("a","Tokyo","2026-10-01","2026-10-01")]).errors.some(e=>e.includes('at least one night'))).toBe(true);
    expect(reviewStayRoute(snapshot(),[stay("a","Tokyo","2026-10-01","2026-10-04"),stay("b","Kyoto","2026-10-03","2026-10-05")]).errors.some(e=>e.includes('overlap'))).toBe(true);
  });
});
