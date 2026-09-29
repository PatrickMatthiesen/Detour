// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDownloadAnimation } from "./use-download-animation";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("keeps a fast download visible for a full cycle", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ busy }) => useDownloadAnimation(busy), { initialProps: { busy: true } });
  act(() => vi.advanceTimersByTime(50));
  rerender({ busy: false });
  act(() => vi.advanceTimersByTime(2349));
  expect(result.current.animating).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.animating).toBe(false);
});

it("continues animating while a longer download is still running", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ busy }) => useDownloadAnimation(busy), { initialProps: { busy: true } });
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current.animating).toBe(true);
  rerender({ busy: false });
  act(() => vi.runOnlyPendingTimers());
  expect(result.current.animating).toBe(false);
});

it("shows a retry even when requests complete in the same render batch", () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useDownloadAnimation(false));
  act(() => result.current.start());
  act(() => vi.advanceTimersByTime(2399));
  expect(result.current.animating).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.animating).toBe(false);
});
