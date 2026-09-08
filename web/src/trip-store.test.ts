import { describe, expect, it, vi } from "vitest";
import { localPreview } from "./data";
import { TripMutationQueue } from "./trip-store";
import type { TripSnapshot } from "./types";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe("TripMutationQueue", () => {
  it("rebases each queued edit onto the latest server version", async () => {
    const initial = structuredClone(localPreview);
    initial.version = 1;
    const first = deferred<TripSnapshot>();
    const second = deferred<TripSnapshot>();
    const save = vi
      .fn<(snapshot: TripSnapshot) => Promise<TripSnapshot>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let visible = initial;
    const queue = new TripMutationQueue(initial, save, (next) => {
      visible = next;
    });

    queue.enqueue((current) => ({
      ...current,
      trip: { ...current.trip, name: "First edit" },
    }));
    queue.enqueue((current) => ({
      ...current,
      trip: { ...current.trip, name: `${current.trip.name} + second edit` },
    }));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].version).toBe(1);
    expect(visible.trip.name).toBe("First edit + second edit");

    first.resolve({ ...save.mock.calls[0][0], version: 2 });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0].version).toBe(2);
    expect(save.mock.calls[1][0].trip.name).toBe("First edit + second edit");

    second.resolve({ ...save.mock.calls[1][0], version: 3 });
    await vi.waitFor(() => expect(visible.version).toBe(3));
  });

  it("surfaces a failure, reverts unsaved state, and cancels dependent edits", async () => {
    const initial = structuredClone(localPreview);
    initial.version = 4;
    const request = deferred<TripSnapshot>();
    const save = vi.fn(() => request.promise);
    let visible = initial;
    let error = "";
    const queue = new TripMutationQueue(initial, save, (next, nextError) => {
      visible = next;
      error = nextError;
    });

    queue.enqueue((current) => ({ ...current, version: 40 }));
    queue.enqueue((current) => ({ ...current, version: 41 }));
    request.reject(new Error("Another change was saved. Refresh first."));

    await vi.waitFor(() => expect(error).toContain("Another change"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(visible.version).toBe(4);
    expect(queue.enqueue((current) => ({ ...current, version: 99 }))).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not let background data replace optimistic edits", () => {
    const initial = structuredClone(localPreview);
    const request = deferred<TripSnapshot>();
    let visible = initial;
    const queue = new TripMutationQueue(initial, () => request.promise, (next) => {
      visible = next;
    });

    queue.enqueue((current) => ({ ...current, version: 12 }));
    queue.replaceConfirmed({ ...initial, version: 99 });

    expect(visible.version).toBe(12);
  });
});
