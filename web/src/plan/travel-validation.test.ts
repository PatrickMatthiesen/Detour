import { describe, expect, it } from "vitest";
import type { TravelLeg } from "../types";
import { validateTravel } from "./TravelEditor";

const leg = (overrides: Partial<TravelLeg> = {}): TravelLeg => ({
  id: "leg-1",
  from: "Tokyo",
  to: "Kyoto",
  date: "2026-10-08",
  durationMinutes: 140,
  mode: "train",
  estimated: true,
  ...overrides,
});

describe("validateTravel", () => {
  it("accepts a complete journey and an unknown duration", () => {
    expect(validateTravel(leg())).toEqual([]);
    expect(validateTravel(leg({ durationMinutes: null }))).toEqual([]);
  });

  it("rejects missing or whitespace-only endpoints", () => {
    const errors = validateTravel(leg({ from: "  ", to: "\t" }));
    expect(errors).toContain("Origin is required.");
    expect(errors).toContain("Destination is required.");
  });

  it("rejects missing and invalid calendar dates", () => {
    expect(validateTravel(leg({ date: "" }))).toContain("Date is required.");
    expect(validateTravel(leg({ date: "2026-02-30" }))).toContain("Date must be a valid date (YYYY-MM-DD).");
  });

  it("requires a positive whole number when duration is provided", () => {
    expect(validateTravel(leg({ durationMinutes: 0 }))).toContain("Duration must be a positive whole number of minutes.");
    expect(validateTravel(leg({ durationMinutes: 12.5 }))).toContain("Duration must be a positive whole number of minutes.");
  });
});
