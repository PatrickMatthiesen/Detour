import { describe, expect, it } from "vitest";
import { localPreview } from "../data";
import { defaultCity, defaultPlanDate, tripDate } from "./current-day";

const trip = () => ({
  ...structuredClone(localPreview),
  trip: { ...localPreview.trip, startDate: "2026-10-01", endDate: "2026-10-05", timeZone: "Asia/Tokyo", arrival: null },
  stays: [
    { id: "tokyo", city: "Tokyo", checkIn: "2026-10-01", checkOut: "2026-10-03" },
    { id: "kyoto", city: "Kyoto", checkIn: "2026-10-03", checkOut: "2026-10-06" },
  ],
  travelLegs: [], activities: [], bookings: [],
});

describe("current trip day", () => {
  it("changes day at Japan midnight rather than UTC midnight", () => {
    expect(tripDate("Asia/Tokyo", new Date("2026-10-02T14:59:59Z"))).toBe("2026-10-02");
    expect(tripDate("Asia/Tokyo", new Date("2026-10-02T15:00:00Z"))).toBe("2026-10-03");
    expect(tripDate("America/Los_Angeles", new Date("2026-10-02T15:00:00Z"))).toBe("2026-10-02");
  });
  it("defaults to today throughout the inclusive trip range", () => {
    expect(defaultPlanDate(trip(), "2026-10-03")).toBe("2026-10-03");
    expect(defaultPlanDate(trip(), "2026-10-05")).toBe("2026-10-05");
  });
  it("keeps a valid planning default outside the trip", () => {
    expect(defaultPlanDate(trip(), "2026-09-30")).toBe("2026-10-01");
    expect(defaultPlanDate(trip(), "2026-10-06")).toBe("2026-10-01");
  });
  it("selects the new city on checkout day", () => {
    expect(defaultCity(trip(), "2026-10-02")).toBe("Tokyo");
    expect(defaultCity(trip(), "2026-10-03")).toBe("Kyoto");
  });
});
