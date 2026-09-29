import { describe, expect, it } from "vitest";
import { dateParts, formatDateTime, longDate, shortDate, weekday } from "./format";

describe("date formatting", () => {
  it("formats date-only values with en-GB calendar conventions", () => {
    expect(shortDate("2026-09-30")).toBe("30 Sept");
    expect(longDate("2026-09-30")).toBe("Wednesday 30 September");
    expect(weekday("2026-09-30")).toBe("Wed");
    expect(dateParts("2026-09-30")).toMatchObject({ weekday: "Wednesday", month: "Sept", day: "30" });
  });

  it("does not shift date-only values when the process timezone changes", () => {
    expect(shortDate("2026-01-01T00:00:00-08:00")).toBe("1 Jan");
  });

  it("keeps wall times and converts offset timestamps in the requested timezone", () => {
    expect(formatDateTime("2026-09-30T08:15")).toBe("Wednesday 30 September at 08:15");
    expect(formatDateTime("2026-09-30T23:15:00Z", "Asia/Tokyo")).toBe("1 Oct, 08:15");
  });
});
