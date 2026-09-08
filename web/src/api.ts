import type { TripSnapshot } from "./types";
let csrfToken = "";

export interface AuthSession {
  authenticated: boolean;
  userId?: string | null;
  email?: string | null;
  googleConfigured?: boolean;
  localDevelopment?: boolean;
}

export async function getAuthSession(): Promise<AuthSession> {
  const response = await fetch("/auth/me", { credentials: "same-origin" });
  if (!response.ok)
    throw new Error(`Auth endpoint returned ${response.status}`);
  return response.json() as Promise<AuthSession>;
}

export async function loadSession(): Promise<void> {
  try {
    const response = await fetch("/auth/csrf", {
      credentials: "same-origin",
    });
    if (!response.ok) return;
    const session = (await response.json()) as { token?: string };
    csrfToken = session.token || "";
  } catch {
    // Local auth-less development remains read-only until the API is available.
  }
}

export async function getTrip(): Promise<TripSnapshot> {
  const response = await fetch("/api/trip");
  if (!response.ok) throw new Error(`Trip API returned ${response.status}`);
  return response.json() as Promise<TripSnapshot>;
}

export async function saveTrip(snapshot: TripSnapshot): Promise<TripSnapshot> {
  if (!csrfToken) await loadSession();
  const response = await fetch("/api/trip", {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "If-Match": String(snapshot.version),
      ...(csrfToken ? { "X-CSRF-TOKEN": csrfToken } : {}),
    },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "Another change was saved. Refresh to see it before editing."
        : `Trip API returned ${response.status}`,
    );
  return response.json() as Promise<TripSnapshot>;
}

export function previewTrip(): TripSnapshot {
  return {
    version: 0,
    trip: {
      id: "japan-2026",
      name: "Japan 2026",
      startDate: "2026-09-30",
      endDate: "2026-10-25",
      timeZone: "Asia/Tokyo",
    },
    places: [],
    stays: [],
    travelLegs: [],
    activities: [],
    bookings: [],
    tasks: [],
    packingItems: [],
  };
}

export async function logout(): Promise<void> {
  if (!csrfToken) await loadSession();
  const response = await fetch("/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    headers: csrfToken ? { "X-CSRF-TOKEN": csrfToken } : undefined,
  });
  if (!response.ok) throw new Error(`Logout returned ${response.status}`);
  csrfToken = "";
}
