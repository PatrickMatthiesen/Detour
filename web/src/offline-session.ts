import { getAuthSession, HttpError, type AuthSession } from "./api";
import { clearOfflineTrip, readOfflineTrip, type OfflineTrip } from "./offline-storage";

export interface TripSession {
  session: AuthSession;
  cached: OfflineTrip | null;
  offline: boolean;
}

export function sessionOwner(session: AuthSession) {
  return session.localDevelopment ? "local-development" : session.userId;
}

export async function loadTripSession(): Promise<TripSession> {
  const cached = await readOfflineTrip().catch(() => null);
  let session: AuthSession;
  try {
    session = await getAuthSession();
  } catch (error) {
    // An explicit authorization rejection must never reopen private cached data.
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      await clearOfflineTrip();
      throw error;
    }
    if (cached && (error instanceof TypeError || error instanceof DOMException ||
      error instanceof HttpError && error.status >= 500)) {
      return { session: cached.session, cached, offline: true };
    }
    throw error;
  }
  const permitted = session.authenticated || session.localDevelopment;
  const sameOwner = permitted && sessionOwner(session) === (cached && sessionOwner(cached.session));
  if (cached && !sameOwner) await clearOfflineTrip();
  return { session, cached: sameOwner ? cached : null, offline: false };
}
