import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTrip, HttpError, loadSession, previewTrip, saveTrip, type AuthSession } from "./api";
import { clearOfflineTrip, writeOfflineTrip, type OfflineTrip } from "./offline-storage";
import { TripMutationQueue, type TripMutate } from "./trip-store";
import type { TripSnapshot } from "./types";

export function useTripState(options?: { session: AuthSession; cached: OfflineTrip | null; offline: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = options ? ["trip", options.session.localDevelopment ? "local-development" : options.session.userId] : ["trip"];
  const [snapshot, setSnapshot] = useState<TripSnapshot>(() => options?.cached?.snapshot ?? previewTrip());
  const [hasSnapshot, setHasSnapshot] = useState(!!options?.cached);
  const [savedAt, setSavedAt] = useState(options?.cached?.savedAt ?? "");
  const [offlineSnapshot, setOfflineSnapshot] = useState(options?.cached?.snapshot ?? null);
  const [storageError, setStorageError] = useState("");
  const [connected, setConnected] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setConnected(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const persist = async (confirmed: TripSnapshot) => {
    if (!options) return;
    try {
      const record = await writeOfflineTrip(options.session, confirmed);
      setSavedAt(record.savedAt);
      setOfflineSnapshot(record.snapshot);
      setStorageError("");
    } catch {
      setStorageError("This device could not save the latest trip for offline use.");
    }
  };
  const [saveError, setSaveError] = useState("");
  const [recovering, setRecovering] = useState(false);
  const recoveryRef = useRef(false);
  const storeRef = useRef<TripMutationQueue | null>(null);
  if (!storeRef.current) {
    storeRef.current = new TripMutationQueue(snapshot, async next => {
      const saved = await saveTrip(next);
      await persist(saved);
      queryClient.setQueryData(queryKey, saved);
      return saved;
    }, (next, error) => {
      setSnapshot(next);
      setSaveError(error);
    });
  }
  const query = useQuery({
    queryKey,
    queryFn: async () => { await loadSession(); return getTrip(); },
    enabled: !options?.offline,
    networkMode: "always",
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const apiState = options?.offline || !connected ? "offline" : query.isPending ? "loading" : query.isError ? "offline" : "live";
  const apiError = query.isError ? query.error.message : saveError;
  useEffect(() => {
    if (query.error instanceof HttpError && [401, 403].includes(query.error.status)) {
      void clearOfflineTrip().catch(() => setStorageError("Could not remove the saved trip from this device."));
    }
  }, [query.error]);
  useEffect(() => {
    if (query.isSuccess && query.data) {
      setHasSnapshot(true);
      storeRef.current?.replaceConfirmed(query.data);
      void persist(query.data);
    }
  }, [query.isSuccess, query.data]);
  const canEdit = apiState === "live" && hasSnapshot && !recovering && storeRef.current.canEdit;
  const reason = recovering ? "Reloading the saved trip. Editing is paused."
    : "Changes cannot be saved. Reload the saved trip to resume editing.";
  const mutate = useCallback<TripMutate>(updater => {
    if (!canEdit || !navigator.onLine || recoveryRef.current) return false;
    return storeRef.current?.enqueue(updater) ?? false;
  }, [canEdit]);
  const retry = async () => {
    if (recoveryRef.current) return;
    recoveryRef.current = true;
    setRecovering(true);
    try {
      const result = await query.refetch();
      // Failed refetches can still carry cached data. Never unlock using it.
      if (result.isSuccess && result.data) storeRef.current?.reset(result.data);
    } finally {
      recoveryRef.current = false;
      setRecovering(false);
    }
  };
  const offlineCurrent = !!offlineSnapshot && JSON.stringify(offlineSnapshot) === JSON.stringify(snapshot);
  return { snapshot, hasSnapshot, mutate, apiState, apiError, retry, canEdit, reason, recovering, savedAt, storageError, offlineCurrent };
}
