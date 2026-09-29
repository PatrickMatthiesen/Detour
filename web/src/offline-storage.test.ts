import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { clearOfflineTrip, readOfflineTrip, writeOfflineTrip } from "./offline-storage";
import type { AuthSession } from "./api";
import type { TripSnapshot } from "./types";

const databaseName = "detour-offline";
const storeName = "snapshots";
const currentTripKey = "current-trip";

const snapshot: TripSnapshot = {
  version: 12,
  trip: {
    id: "japan-2026",
    name: "Japan 2026",
    startDate: "2026-09-30",
    endDate: "2026-10-25",
    timeZone: "Asia/Tokyo",
    arrival: { airport: "HND", date: "2026-09-30", time: "15:20", localDateTime: "2026-09-30T15:20" },
    departure: { airport: "NRT", date: "2026-10-25", time: "11:00", localDateTime: "2026-10-25T11:00" },
  },
  places: [{ id: "place-1", name: "Senso-ji", city: "Tokyo", latitude: 35.7148, longitude: 139.7967 }],
  stays: [{ id: "stay-1", city: "Tokyo", name: "Hotel", checkIn: "2026-09-30", checkOut: "2026-10-03", bookingId: "booking-1" }],
  travelLegs: [{ id: "leg-1", from: "Tokyo", to: "Kyoto", date: "2026-10-03", mode: "train", durationMinutes: 130 }],
  activities: [{ id: "activity-1", placeId: "place-1", title: "Temple visit", date: "2026-10-01", startTime: "10:00", durationMinutes: 90 }],
  bookings: [{ id: "booking-1", kind: "stay", title: "Hotel", status: "confirmed", bookingNumber: "ABC123", pin: "4821", confirmationCode: "CONFIRM-42", notes: "Late arrival" }],
  tasks: [{ id: "task-1", title: "Buy tickets", dueDate: "2026-09-20", completed: false, scope: "trip", reminderAt: "2026-09-19T09:00:00Z" }],
  packingItems: [{ id: "packing-1", name: "Adapter", category: "electronics", quantity: 1, packed: true, bag: "carry-on", notes: "Type A" }],
};

const session = (userId: string, email: string): AuthSession => ({
  authenticated: true,
  userId,
  email,
  googleConfigured: true,
});

async function replaceStoredRecord(record: unknown): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(record, currentTripKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

afterEach(async () => {
  await clearOfflineTrip();
});

describe("offline trip storage", () => {
  it("round-trips the full snapshot, including booking PINs, without storing credentials", async () => {
    const result = await writeOfflineTrip(session("user-a", "a@example.test"), snapshot);

    expect(result.snapshot).toEqual(snapshot);
    expect(result.session).toEqual({ authenticated: true, userId: "user-a", email: "a@example.test", localDevelopment: false });
    expect(result.savedAt).toBeTruthy();
    expect(await readOfflineTrip()).toEqual(result);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const stored = await new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(storeName).objectStore(storeName).get(currentTripKey);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      expect(stored).not.toHaveProperty("session.accessToken");
      expect(stored).not.toHaveProperty("session.refreshToken");
      expect((stored as { snapshot: TripSnapshot }).snapshot.bookings[0].pin).toBe("4821");
    } finally {
      database.close();
    }
  });

  it("clears the saved snapshot", async () => {
    await writeOfflineTrip(session("user-a", "a@example.test"), snapshot);

    await clearOfflineTrip();

    expect(await readOfflineTrip()).toBeNull();
  });

  it("returns null for malformed and unsupported records", async () => {
    await writeOfflineTrip(session("user-a", "a@example.test"), snapshot);
    await replaceStoredRecord({ schemaVersion: 99, owner: "user:user-a", session: session("user-a", "a@example.test"), snapshot, savedAt: new Date().toISOString() });
    expect(await readOfflineTrip()).toBeNull();

    await replaceStoredRecord({ schemaVersion: 1, owner: "user:user-a", session: session("user-a", "a@example.test"), snapshot: { version: 1 }, savedAt: "invalid" });
    expect(await readOfflineTrip()).toBeNull();
  });

  it("keeps only the latest account's snapshot", async () => {
    await writeOfflineTrip(session("user-a", "a@example.test"), snapshot);
    const nextSnapshot = { ...snapshot, version: 13, trip: { ...snapshot.trip, name: "Different trip" } };

    await writeOfflineTrip(session("user-b", "b@example.test"), nextSnapshot);

    expect(await readOfflineTrip()).toMatchObject({
      session: { userId: "user-b", email: "b@example.test" },
      snapshot: { version: 13, trip: { name: "Different trip" } },
    });
  });

  it("stores the local-development session returned as unauthenticated", async () => {
    const localSession: AuthSession = { authenticated: false, localDevelopment: true };

    await writeOfflineTrip(localSession, snapshot);

    expect(await readOfflineTrip()).toMatchObject({
      session: { authenticated: false, userId: null, localDevelopment: true },
      snapshot: { version: 12 },
    });
  });

  it("does not replace a newer snapshot for the same owner", async () => {
    const owner = session("user-a", "a@example.test");
    await writeOfflineTrip(owner, { ...snapshot, version: 14 });

    await expect(writeOfflineTrip(owner, { ...snapshot, version: 13 })).rejects.toThrow(/newer offline trip snapshot/);

    expect(await readOfflineTrip()).toMatchObject({ snapshot: { version: 14 } });
  });

  it("allows version zero and lets a different trip replace it", async () => {
    const owner = session("user-a", "a@example.test");
    await writeOfflineTrip(owner, { ...snapshot, version: 12 });
    const differentTrip = {
      ...snapshot,
      version: 0,
      trip: { ...snapshot.trip, id: "another-trip", name: "Another trip" },
    };

    await writeOfflineTrip(owner, differentTrip);

    expect(await readOfflineTrip()).toMatchObject({
      snapshot: { version: 0, trip: { id: "another-trip" } },
    });
  });

  it("rejects unauthenticated sessions and preview snapshots", async () => {
    await expect(writeOfflineTrip({ authenticated: false, userId: "user-a" }, snapshot)).rejects.toThrow(/authenticated owner/);
    await expect(writeOfflineTrip(session("user-a", "a@example.test"), { ...snapshot, version: -1 })).rejects.toThrow(/confirmed server snapshot/);
  });
});
