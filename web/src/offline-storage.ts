import type { AuthSession } from "./api";
import type { TripSnapshot } from "./types";

export interface OfflineTrip {
  session: AuthSession;
  snapshot: TripSnapshot;
  savedAt: string;
}

interface StoredOfflineTrip {
  schemaVersion: number;
  owner: string;
  session: AuthSession;
  snapshot: TripSnapshot;
  savedAt: string;
}

const DATABASE_NAME = "detour-offline";
const DATABASE_VERSION = 1;
const STORE_NAME = "snapshots";
const CURRENT_TRIP_KEY = "current-trip";
const RECORD_SCHEMA_VERSION = 1;

function ownerFor(session: AuthSession): string | null {
  if (
    session.authenticated &&
    typeof session.userId === "string" &&
    session.userId.length > 0
  ) {
    return `user:${session.userId}`;
  }
  return session.localDevelopment ? "local-development" : null;
}

function minimalSession(session: AuthSession): AuthSession {
  return {
    authenticated: session.authenticated,
    userId: session.userId ?? null,
    email: session.email ?? null,
    localDevelopment: session.localDevelopment === true,
  };
}

function isTripSnapshot(value: unknown): value is TripSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<TripSnapshot>;
  const trip = snapshot.trip;
  const collections = [
    snapshot.places,
    snapshot.stays,
    snapshot.travelLegs,
    snapshot.activities,
    snapshot.bookings,
    snapshot.tasks,
    snapshot.packingItems,
  ];
  return (
    typeof snapshot.version === "number" &&
    Number.isFinite(snapshot.version) &&
    !!trip &&
    typeof trip === "object" &&
    typeof trip.id === "string" &&
    typeof trip.name === "string" &&
    typeof trip.startDate === "string" &&
    typeof trip.endDate === "string" &&
    collections.every(
      (collection) =>
        Array.isArray(collection) &&
        collection.every((item) => !!item && typeof item === "object"),
    )
  );
}

function isStoredSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AuthSession>;
  return (
    typeof session.authenticated === "boolean" &&
    (session.userId === undefined || session.userId === null || typeof session.userId === "string") &&
    (session.email === undefined || session.email === null || typeof session.email === "string") &&
    (session.localDevelopment === undefined || typeof session.localDevelopment === "boolean") &&
    ownerFor(session as AuthSession) !== null
  );
}

function isStoredOfflineTrip(value: unknown): value is StoredOfflineTrip {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredOfflineTrip>;
  const session = record.session;
  return (
    record.schemaVersion === RECORD_SCHEMA_VERSION &&
    typeof record.owner === "string" &&
    isStoredSession(session) &&
    ownerFor(session) === record.owner &&
    isTripSnapshot(record.snapshot) &&
    record.snapshot.version >= 0 &&
    typeof record.savedAt === "string" &&
    Number.isFinite(Date.parse(record.savedAt))
  );
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
    request.onblocked = () => reject(new Error("Offline storage upgrade is blocked."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Offline storage transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Offline storage transaction was aborted."));
  });
}

export async function readOfflineTrip(): Promise<OfflineTrip | null> {
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionComplete(transaction);
    const request = transaction.objectStore(STORE_NAME).get(CURRENT_TRIP_KEY);
    const value: unknown = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
    await done;
    if (!isStoredOfflineTrip(value)) return null;

    return {
      session: minimalSession(value.session),
      snapshot: value.snapshot,
      savedAt: value.savedAt,
    };
  } catch {
    return null;
  } finally {
    database?.close();
  }
}

export async function writeOfflineTrip(
  session: AuthSession,
  snapshot: TripSnapshot,
): Promise<OfflineTrip> {
  const owner = ownerFor(session);
  if (!owner) {
    throw new Error("Offline trip storage requires an authenticated owner.");
  }
  if (!isTripSnapshot(snapshot) || snapshot.version < 0) {
    throw new Error("Offline trip storage requires a confirmed server snapshot.");
  }

  const record: StoredOfflineTrip = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    owner,
    session: minimalSession(session),
    snapshot: structuredClone(snapshot),
    savedAt: new Date().toISOString(),
  };

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionComplete(transaction);
    const store = transaction.objectStore(STORE_NAME);
    let staleVersion = false;
    const currentRequest = store.get(CURRENT_TRIP_KEY);
    currentRequest.onsuccess = () => {
      const current: unknown = currentRequest.result;
      staleVersion =
        isStoredOfflineTrip(current) &&
        current.owner === owner &&
        current.snapshot.trip.id === snapshot.trip.id &&
        current.snapshot.version > snapshot.version;
      if (!staleVersion) store.put(record, CURRENT_TRIP_KEY);
    };
    await done;
    if (staleVersion) {
      throw new Error("A newer offline trip snapshot is already stored.");
    }
    return {
      session: record.session,
      snapshot: record.snapshot,
      savedAt: record.savedAt,
    };
  } finally {
    database.close();
  }
}

export async function clearOfflineTrip(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionComplete(transaction);
    transaction.objectStore(STORE_NAME).delete(CURRENT_TRIP_KEY);
    await done;
  } finally {
    database.close();
  }
}
