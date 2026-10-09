// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTripToday } from "./current-day";

afterEach(() => { vi.useRealTimers(); });

describe("trip clock", () => {
  it("refreshes across midnight and when a suspended app regains focus", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T14:59:59Z"));
    const { result, unmount } = renderHook(() => useTripToday("Asia/Tokyo"));
    expect(result.current).toBe("2026-10-02");
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current).toBe("2026-10-03");
    vi.setSystemTime(new Date("2026-10-03T15:00:00Z"));
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(result.current).toBe("2026-10-04");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
