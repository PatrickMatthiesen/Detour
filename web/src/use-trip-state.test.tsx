// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { getTrip, loadSession, saveTrip, type AuthSession } from "./api";
import { localPreview } from "./data";
import { useTripState } from "./use-trip-state";
import { TripEditingContext } from "./trip-editing";
import PackingView from "./prepare/PackingView";
import { clearOfflineTrip, writeOfflineTrip, type OfflineTrip } from "./offline-storage";
import type { TripSnapshot } from "./types";

vi.mock("./api", async importOriginal => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    getTrip: vi.fn(), loadSession: vi.fn(), saveTrip: vi.fn(),
    previewTrip: () => structuredClone(localPreview),
  };
});
vi.mock("./offline-storage", () => ({ writeOfflineTrip: vi.fn(), clearOfflineTrip: vi.fn() }));

const savedTrip = () => ({ ...structuredClone(localPreview), version: 1,
  packingItems: [{ id: "test-item", name: "Raincoat", category: "Clothes", quantity: 1, packed: false }],
});
const identity = (trip: TripSnapshot) => trip;
const ownerSession: AuthSession = { authenticated: true, userId: "test-owner", email: "owner@example.test" };
const offlineTrip = (snapshot = savedTrip()): OfflineTrip => ({
  session: ownerSession, snapshot, savedAt: "2026-09-28T12:00:00.000Z",
});
function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}
function queryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.resetAllMocks();
  setOnline(true);
  // JSDOM has no top layer; browser checks cover native focus containment.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  vi.mocked(loadSession).mockResolvedValue(undefined);
  vi.mocked(getTrip).mockResolvedValue(savedTrip());
  vi.mocked(writeOfflineTrip).mockImplementation(async (session, snapshot) => ({
    session, snapshot: structuredClone(snapshot), savedAt: "2026-09-29T12:00:00.000Z",
  }));
  vi.mocked(clearOfflineTrip).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); setOnline(true); });

describe("trip editing recovery", () => {
  it("stays blocked after a failed reload with cached data, then saves against a fresh version", async () => {
    vi.mocked(saveTrip).mockRejectedValueOnce(new Error("Save failed"));
    const { result } = renderHook(useTripState, { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.canEdit).toBe(true));
    act(() => { expect(result.current.mutate(identity)).toBe(true); });
    await waitFor(() => expect(result.current.canEdit).toBe(false));
    expect(result.current.apiError).toBe("Save failed");
    expect(result.current.mutate(identity)).toBe(false);

    vi.mocked(getTrip).mockRejectedValueOnce(new Error("Still offline"));
    await act(async () => { await result.current.retry(); });
    expect(result.current.canEdit).toBe(false);
    expect(result.current.apiError).toBe("Still offline");
    expect(result.current.snapshot.version).toBe(1);
    expect(result.current.mutate(identity)).toBe(false);
    expect(saveTrip).toHaveBeenCalledTimes(1);

    let completeReload!: (trip: TripSnapshot) => void;
    vi.mocked(getTrip).mockImplementationOnce(() => new Promise(resolve => { completeReload = resolve; }));
    let reloading!: Promise<void>;
    act(() => { reloading = result.current.retry(); });
    await waitFor(() => expect(result.current.recovering).toBe(true));
    expect(result.current.mutate(identity)).toBe(false);
    await act(async () => { completeReload({ ...savedTrip(), version: 8 }); await reloading; });
    expect(result.current.canEdit).toBe(true);
    expect(result.current.apiError).toBe("");
    vi.mocked(saveTrip).mockImplementationOnce(async trip => ({ ...trip, version: 9 }));
    act(() => { expect(result.current.mutate(identity)).toBe(true); });
    await waitFor(() => expect(result.current.snapshot.version).toBe(9));
    expect(vi.mocked(saveTrip).mock.calls[1][0].version).toBe(8);
  });

  it("disables actual packing mutations after failure while retaining browsing and recovery", async () => {
    vi.mocked(saveTrip).mockRejectedValueOnce(new Error("Save failed"));
    function Page() {
      const state = useTripState();
      return <TripEditingContext.Provider value={{ canEdit: state.canEdit, reason: state.reason }}>
        <button onClick={state.retry}>Reload saved trip</button>
        <PackingView snapshot={state.snapshot} update={state.mutate}/>
      </TripEditingContext.Provider>;
    }
    render(<Page/>, { wrapper: queryWrapper() });
    const toggle = await screen.findByRole("button", { name: "Mark Raincoat packed" });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(toggle);
    await waitFor(() => expect((screen.getByRole("button", { name: "Mark Raincoat packed" }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole("button", { name: "Delete Raincoat" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^All/ }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /^Unpacked/ }));
    expect(screen.getByText("Raincoat")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload saved trip" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Mark Raincoat packed" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("does not accept edits before the first successful trip load", async () => {
    vi.mocked(getTrip).mockRejectedValueOnce(new Error("Offline"));
    const { result } = renderHook(useTripState, { wrapper: queryWrapper() });
    expect(result.current.mutate(identity)).toBe(false);
    await waitFor(() => expect(result.current.apiState).toBe("offline"));
    expect(result.current.hasSnapshot).toBe(false);
    expect(result.current.canEdit).toBe(false);
    expect(saveTrip).not.toHaveBeenCalled();
  });

  it("allows editing a successfully loaded trip whose version is zero", async () => {
    const firstTrip = { ...structuredClone(localPreview), version: 0 };
    vi.mocked(getTrip).mockResolvedValue(firstTrip);
    const { result } = renderHook(() => useTripState({ session: ownerSession, cached: null, offline: false }), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.hasSnapshot).toBe(true));
    expect(result.current.snapshot).toEqual(firstTrip);
    expect(result.current.apiState).toBe("live");
    expect(result.current.canEdit).toBe(true);
    expect(result.current.mutate(identity)).toBe(true);
  });

  it("shows a cached trip while offline and keeps it read-only", () => {
    const cached = offlineTrip();
    const { result } = renderHook(() => useTripState({ session: ownerSession, cached, offline: true }), { wrapper: queryWrapper() });

    expect(result.current.snapshot).toEqual(cached.snapshot);
    expect(result.current.apiState).toBe("offline");
    expect(result.current.canEdit).toBe(false);
    expect(result.current.mutate(identity)).toBe(false);
    expect(getTrip).not.toHaveBeenCalled();
    expect(saveTrip).not.toHaveBeenCalled();
  });

  it("blocks mutations as soon as the browser reports a disconnect", async () => {
    const { result } = renderHook(() => useTripState({ session: ownerSession, cached: null, offline: false }), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.canEdit).toBe(true));

    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    await waitFor(() => expect(result.current.apiState).toBe("offline"));
    expect(result.current.mutate(identity)).toBe(false);
    expect(saveTrip).not.toHaveBeenCalled();
  });

  it("persists only server-confirmed snapshots and never stores a failed optimistic edit", async () => {
    const serverTrip = { ...savedTrip(), trip: { ...savedTrip().trip, name: "Server confirmed" }, version: 4 };
    vi.mocked(getTrip).mockResolvedValue(serverTrip);
    let finishSave!: (snapshot: TripSnapshot) => void;
    vi.mocked(saveTrip).mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    const { result } = renderHook(() => useTripState({ session: ownerSession, cached: null, offline: false }), { wrapper: queryWrapper() });
    await waitFor(() => expect(writeOfflineTrip).toHaveBeenCalledOnce());
    expect(writeOfflineTrip).toHaveBeenLastCalledWith(ownerSession, serverTrip);

    act(() => { expect(result.current.mutate(trip => ({ ...trip, trip: { ...trip.trip, name: "Optimistic draft" } }))).toBe(true); });
    await waitFor(() => expect(result.current.snapshot.trip.name).toBe("Optimistic draft"));
    expect(writeOfflineTrip).toHaveBeenCalledTimes(1);

    await act(async () => { finishSave(serverTrip); });
    await waitFor(() => expect(writeOfflineTrip).toHaveBeenCalledTimes(2));
    expect(writeOfflineTrip).toHaveBeenLastCalledWith(ownerSession, serverTrip);

    vi.mocked(saveTrip).mockRejectedValueOnce(new Error("Rejected edit"));
    act(() => { expect(result.current.mutate(trip => ({ ...trip, trip: { ...trip.trip, name: "Failed draft" } }))).toBe(true); });
    await waitFor(() => expect(result.current.apiError).toBe("Rejected edit"));
    expect(result.current.snapshot.trip.name).toBe("Server confirmed");
    expect(writeOfflineTrip).toHaveBeenCalledTimes(2);
    expect(writeOfflineTrip).not.toHaveBeenCalledWith(ownerSession, expect.objectContaining({ trip: expect.objectContaining({ name: "Failed draft" }) }));
  });

  it("keeps live editing available when offline storage fails", async () => {
    vi.mocked(writeOfflineTrip).mockRejectedValue(new Error("IndexedDB unavailable"));
    vi.mocked(saveTrip).mockImplementation(async trip => ({ ...trip, version: trip.version + 1 }));
    const { result } = renderHook(() => useTripState({ session: ownerSession, cached: null, offline: false }), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.apiState).toBe("live"));
    await waitFor(() => expect(result.current.storageError).toContain("could not save"));
    expect(result.current.canEdit).toBe(true);

    act(() => { expect(result.current.mutate(identity)).toBe(true); });
    await waitFor(() => expect(result.current.snapshot.version).toBe(2));
    expect(result.current.canEdit).toBe(true);
    expect(result.current.storageError).toContain("could not save");
  });

  it("keeps a draft open when an edit is rejected and exposes recovery inside the dialog", () => {
    const update = vi.fn(() => false);
    const reload = vi.fn();
    const view = render(<TripEditingContext.Provider value={{ canEdit: true, reason: "" }}>
      <PackingView snapshot={savedTrip()} update={update}/>
    </TripEditingContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Edit Raincoat" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Waterproof coat" } });
    fireEvent.click(screen.getByRole("button", { name: "Save item" }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Waterproof coat");
    view.rerender(<TripEditingContext.Provider value={{ canEdit: false, reason: "Editing paused", reload }}>
      <PackingView snapshot={savedTrip()} update={update}/>
    </TripEditingContext.Provider>);
    expect((screen.getByRole("button", { name: "Save item" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Waterproof coat");
    fireEvent.click(screen.getByRole("button", { name: "Reload saved trip" }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
