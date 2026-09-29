import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  redirect,
  RouterProvider,
  useLocation,
} from "@tanstack/react-router";
import { logout } from "./api";
import { Check, Download, WifiOff } from "lucide-react";
import { LoginScreen } from "./LoginScreen";
import { DetourIcon } from "./DetourIcon";
import PreparePage from "./prepare/PreparePage";
import { PlacesExplorer } from "./places/PlacesExplorer";
import { validatePlacesSearch } from "./places/places-search";
import { displayPlaces } from "./places/displayPlaces";
import { shortDate } from "./format";
import PlanPage from "./plan/PlanPage";
import "./detour.css";
import { useTripState } from "./use-trip-state";
import { TripEditingContext } from "./trip-editing";
import { AddPlaceModal, EditPlaceModal } from "./places/PlaceModals";
import "./styles.css";
import { loadTripSession, sessionOwner, type TripSession } from "./offline-session";
import { clearOfflineTrip } from "./offline-storage";
import { registerServiceWorker } from "./register-service-worker";
import { useDownloadAnimation } from "./use-download-animation";

function DetourApp() {
  const [loaded, setLoaded] = useState<TripSession | null>(null);
  const [failed, setFailed] = useState(false);
  const checkSession = useCallback(() => {
    setFailed(false);
    loadTripSession().then(setLoaded).catch(() => setFailed(true));
  }, []);
  useEffect(checkSession, [checkSession]);
  useEffect(() => {
    window.addEventListener("online", checkSession);
    return () => window.removeEventListener("online", checkSession);
  }, [checkSession]);
  if (failed) return <LoginScreen mode="error" onRetry={checkSession}/>;
  if (!loaded) return <LoginScreen mode="loading"/>;
  const { session } = loaded;
  if (!session.authenticated && !session.localDevelopment) return <LoginScreen mode="login" googleConfigured={session.googleConfigured}/>;
  return <AuthenticatedDetourApp key={`${sessionOwner(session)}-${loaded.offline}`} loaded={loaded} reconnect={checkSession}/>;
}
function AuthenticatedDetourApp({loaded, reconnect}: {loaded: TripSession; reconnect: () => void}) {
  const { session } = loaded;
  const [sessionError, setSessionError] = useState("");
  const [shellStatus, setShellStatus] = useState<"preparing" | "ready" | "error">("preparing");
  const prepareOffline = useCallback(() => {
    setShellStatus("preparing");
    void registerServiceWorker(setShellStatus)
      .then(registration => { if (!registration) setShellStatus("error"); });
  }, []);
  useEffect(() => {
    prepareOffline();
    void navigator.storage?.persist?.().catch(() => {});
  }, [prepareOffline]);
  const state = useTripState(loaded);
  const { pathname } = useLocation();
  const [adding, setAdding] = useState(false);
  const { snapshot } = state;
  const offlineReady = shellStatus === "ready" && state.offlineCurrent && !state.storageError && !state.recovering;
  const offlineDownloading = state.apiState !== "offline" && !state.storageError &&
    (shellStatus === "preparing" || state.recovering || !state.offlineCurrent);
  const { animating: downloadAnimating, start: startDownloadAnimation } = useDownloadAnimation(offlineDownloading);
  const offlineLabel = state.storageError ? "Offline download failed. Click to retry."
    : state.apiState === "offline" ? "Offline. Browsing saved trip. Click to reconnect."
    : offlineReady ? "Up to date for offline use."
    : shellStatus === "error" ? "Trip saved; offline reopening unavailable here. Click to retry."
    : "Saving for offline use…";
  const OfflineIcon = state.apiState === "offline" ? WifiOff : !downloadAnimating && offlineReady ? Check : Download;
  const header = <header className="detour-nav">
    <Link to="/" className="detour-brand"><DetourIcon/>Detour</Link>
    <span className="detour-trip">{snapshot.trip.name}<small>{shortDate(snapshot.trip.startDate)} – {shortDate(snapshot.trip.endDate)}</small></span>
    <nav aria-label="Main navigation">
      <Link to="/" aria-current={pathname === "/" ? "page" : undefined}>Places</Link>
      <Link to="/plan" aria-current={pathname === "/plan" ? "page" : undefined}>Plan</Link>
      <Link to="/preparation" aria-current={pathname === "/preparation" ? "page" : undefined}>Prepare</Link>
    </nav>
    <button type="button" className={`detour-offline-button${offlineReady && !downloadAnimating && state.apiState !== "offline" ? " is-ready" : ""}${state.offlineCurrent && !state.storageError && !downloadAnimating && state.apiState !== "offline" ? " is-settled" : ""}${downloadAnimating ? " is-downloading" : ""}`}
      aria-label={offlineLabel} aria-busy={offlineDownloading} title={offlineLabel} onClick={() => {
        startDownloadAnimation();
        prepareOffline();
        if (loaded.offline) reconnect();
        else void state.retry();
      }}><OfflineIcon size={18} aria-hidden="true"/></button>
    {session?.authenticated && !session.localDevelopment && <button className="detour-account" onClick={()=>logout().then(()=>clearOfflineTrip()).then(()=>window.location.reload()).catch(error=>setSessionError(String(error)))}>Sign out</button>}
  </header>;
  if (state.apiError.includes("401") || state.apiError.includes("403")) return <LoginScreen mode="login" expired/>;
  const selected = new Set(snapshot.places.filter(p => p.selected).map(p => p.id));
  return <TripEditingContext.Provider value={{ canEdit: state.canEdit, reason: state.reason, recovering: state.recovering, reload: state.retry }}><div className="detour-app">
    {sessionError && <div role="alert">{sessionError}</div>}
    {state.apiError && <div className="detour-save-error" role="alert"><strong>Editing paused.</strong> {state.apiError} Reload to check which changes were saved. <button disabled={state.recovering} onClick={state.retry}>{state.recovering ? "Reloading…" : "Reload saved trip"}</button>{state.apiError.includes("401") && <a href="/auth/login?returnUrl=%2F">Sign in</a>}</div>}
    {state.apiState === "loading" || (state.apiState === "live" && !state.hasSnapshot) ? <>{header}<p role="status">Loading your trip…</p></> : state.apiState === "offline" && !state.hasSnapshot ? <>{header}<p>Your trip could not be loaded. Retry above to continue.</p></> : pathname === "/plan" ? <div className="detour-plan-shell">{header}<PlanPage snapshot={snapshot} update={state.mutate}/></div> : pathname === "/preparation" ? <>{header}<PreparePage snapshot={snapshot} update={state.mutate}/></> : <PlacesExplorer
      trip={{...snapshot,places:displayPlaces(snapshot.places)}} selected={selected}
      toggle={id => state.mutate(current => ({...current,places:current.places.map(p=>p.id===id?{...p,selected:!p.selected}:p)}))}
      loading={false} error="" header={header} onAdd={()=>setAdding(true)}
      renderEdit={(place, close) => <EditPlaceModal key={place.id} embedded
        place={snapshot.places.find(p => p.id === place.id) ?? place}
        onClose={close} onSave={updated => {
          if (!state.mutate(current => ({...current, places:current.places.map(p => p.id === updated.id ? updated : p)}))) return false;
          close();
          return true;
        }}/>}/>}
    {adding && <AddPlaceModal onClose={()=>setAdding(false)} onAdd={place=>{if (!state.mutate(current=>({...current,places:[...current.places,place]}))) return false;setAdding(false);return true;}}/>}
  </div></TripEditingContext.Provider>;
}
function RouteShell() {
  return <DetourApp />;
}
const rootRoute = createRootRoute({ component: RouteShell, validateSearch: validatePlacesSearch });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});
const itineraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/itinerary",
  beforeLoad: () => {
    throw redirect({ to: "/plan", replace: true });
  },
});
const preparationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/preparation",
  component: () => null,
});
const planRoute = createRoute({getParentRoute:()=>rootRoute,path:"/plan",component:()=>null});
const routeTree = rootRoute.addChildren([
  planRoute,
  indexRoute,
  itineraryRoute,
  preparationRoute,
]);
const router = createRouter({ routeTree });
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
