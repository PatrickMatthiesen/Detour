import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthSession, HttpError, type AuthSession } from "./api";
import { clearOfflineTrip, readOfflineTrip, type OfflineTrip } from "./offline-storage";
import { loadTripSession } from "./offline-session";

vi.mock("./api", async importOriginal => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, getAuthSession: vi.fn() };
});

vi.mock("./offline-storage", () => ({
  clearOfflineTrip: vi.fn(),
  readOfflineTrip: vi.fn(),
}));

const alice: AuthSession = { authenticated: true, userId: "alice", email: "alice@example.test" };
const cachedTrip: OfflineTrip = {
  session: alice,
  snapshot: {
    version: 7,
    trip: { id: "trip-1", name: "Saved trip", startDate: "2026-10-01", endDate: "2026-10-05" },
    places: [], stays: [], travelLegs: [], activities: [], bookings: [], tasks: [], packingItems: [],
  },
  savedAt: "2026-09-28T12:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readOfflineTrip).mockResolvedValue(cachedTrip);
  vi.mocked(clearOfflineTrip).mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("loadTripSession", () => {
  it("uses the cached trip when the auth request fails because of a network error", async () => {
    vi.mocked(getAuthSession).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(loadTripSession()).resolves.toEqual({ session: alice, cached: cachedTrip, offline: true });
    expect(clearOfflineTrip).not.toHaveBeenCalled();
  });

  it.each([401, 403])("clears cached data and rejects an authorization failure (%i)", async status => {
    const error = new HttpError(status, `Auth endpoint returned ${status}`);
    vi.mocked(getAuthSession).mockRejectedValue(error);

    await expect(loadTripSession()).rejects.toBe(error);
    expect(clearOfflineTrip).toHaveBeenCalledOnce();
  });

  it("clears cached data when a different account signs in", async () => {
    const bob: AuthSession = { authenticated: true, userId: "bob" };
    vi.mocked(getAuthSession).mockResolvedValue(bob);

    await expect(loadTripSession()).resolves.toEqual({ session: bob, cached: null, offline: false });
    expect(clearOfflineTrip).toHaveBeenCalledOnce();
  });

  it("clears cached data for an unauthenticated session", async () => {
    const signedOut: AuthSession = { authenticated: false, userId: null };
    vi.mocked(getAuthSession).mockResolvedValue(signedOut);

    await expect(loadTripSession()).resolves.toEqual({ session: signedOut, cached: null, offline: false });
    expect(clearOfflineTrip).toHaveBeenCalledOnce();
  });
});
