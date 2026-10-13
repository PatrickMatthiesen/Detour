// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CalendarControl from "./CalendarControl";
import type { CalendarStatus } from "../api";

const calendarApi = vi.hoisted(() => ({
  connectCalendar: vi.fn(),
  disconnectCalendar: vi.fn(),
  getCalendarStatus: vi.fn(),
  syncCalendar: vi.fn(),
}));

vi.mock("../api", () => calendarApi);

const connected: CalendarStatus = {
  configured: true,
  connected: true,
  calendarId: "separate-trip-calendar",
  lastSyncedVersion: 1,
  lastSyncedAt: null,
  error: null,
};

const disconnectedWithError: CalendarStatus = {
  ...connected,
  connected: false,
  error: "Calendar access needs attention.",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  window.history.replaceState(null, "", "/plan");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function flushEffects() {
  await act(async () => { await Promise.resolve(); });
}

describe("CalendarControl status polling", () => {
  it("continues polling after failed calendar creation while disconnected", async () => {
    calendarApi.getCalendarStatus
      .mockResolvedValueOnce({ ...disconnectedWithError, calendarId: null, error: "Calendar creation failed with status 429." })
      .mockResolvedValueOnce(connected);
    render(<CalendarControl />);
    await flushEffects();

    expect(screen.getByRole("status").textContent).toContain("Calendar creation failed with status 429.");
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(calendarApi.getCalendarStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Connected · Detour sends trip changes one way")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry sync" })).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears a temporary status transport error after the next successful poll", async () => {
    calendarApi.getCalendarStatus
      .mockResolvedValueOnce(connected)
      .mockRejectedValueOnce(new Error("Temporary status request failure."))
      .mockResolvedValueOnce(connected);
    render(<CalendarControl />);
    await flushEffects();

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByRole("status").textContent).toContain("Temporary status request failure.");

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(calendarApi.getCalendarStatus).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps the OAuth callback message after successful status refreshes", async () => {
    window.history.replaceState(null, "", "/plan?calendar=failed");
    calendarApi.getCalendarStatus.mockResolvedValue({ ...connected, configured: false, connected: false, calendarId: null });
    render(<CalendarControl />);
    await flushEffects();

    expect(screen.getByRole("status").textContent).toContain("Google Calendar connection did not finish.");
    expect(calendarApi.getCalendarStatus).toHaveBeenCalledTimes(1);
  });
});
