import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Commitment } from "./PlanPage";
import type { Booking } from "../types";
import { localPreview } from "../data";
import { daySummary } from "./planning";

const booking: Booking = {
  id: "hotel",
  kind: "hotel",
  title: "Henn na Hotel",
  status: "confirmed",
  checkIn: "2026-10-01",
  checkOut: "2026-10-02",
};

describe("Plan commitments", () => {
  it("labels a lodging commitment on its checkout date without changing its date details", () => {
    const html = renderToStaticMarkup(<Commitment booking={booking} date="2026-10-02" onEdit={() => {}} />);
    expect(html).toContain("Checking out today");
    expect(html).toContain("Check-in 1 Oct");
    expect(html).toContain("check-out 2 Oct");
  });

  it("keeps normal accommodation wording before checkout", () => {
    const html = renderToStaticMarkup(<Commitment booking={booking} date="2026-10-01" onEdit={() => {}} />);
    expect(html).toContain("Accommodation");
    expect(html).not.toContain("Checking out today");
  });

  it("keeps checkout visible without counting it as accommodation for the next night", () => {
    const trip = { ...structuredClone(localPreview), bookings: [booking] };
    const checkout = daySummary(trip, "2026-10-02");
    expect(checkout.bookings).toEqual([booking]);
    expect(checkout.accommodationCovered).toBe(false);
    trip.bookings.push({ ...booking, id: "next-hotel", checkIn: "2026-10-02", checkOut: "2026-10-04" });
    expect(daySummary(trip, "2026-10-02").accommodationCovered).toBe(true);
    trip.bookings[1].status = "cancelled";
    expect(daySummary(trip, "2026-10-02").accommodationCovered).toBe(false);
    expect(daySummary(trip, "2026-10-02").bookings).toEqual([booking]);
  });

  it("uses the trip timezone for timestamp-based checkout labels", () => {
    const html = renderToStaticMarkup(<Commitment booking={{ ...booking, checkOut: "2026-10-01T23:00:00Z" }} date="2026-10-02" timeZone="Asia/Tokyo" onEdit={() => {}} />);
    expect(html).toContain("Checking out today");
    expect(html).toContain("check-out 2 Oct, 08:00");
  });
});
