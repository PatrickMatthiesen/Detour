import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  redirect,
  RouterProvider,
  useLocation,
} from "@tanstack/react-router";
import {
  getAuthSession,
  getTrip,
  loadSession,
  logout,
  previewTrip,
  saveTrip,
} from "./api";
import { LoginScreen } from "./LoginScreen";
import { DetourIcon } from "./DetourIcon";
import PreparePage from "./prepare/PreparePage";
import { PlacesExplorer } from "./places/PlacesExplorer";
import { validatePlacesSearch } from "./places/places-search";
import { displayPlaces } from "./places/displayPlaces";
import { shortDate } from "./format";
import PlanPage from "./plan/PlanPage";
import "./detour.css";
import { TripMutationQueue } from "./trip-store";
import type { TripSnapshot } from "./types";
import { AddPlaceModal, EditPlaceModal } from "./places/PlaceModals";
import "./styles.css";

function useTripState() {
  const [snapshot, setSnapshot] = useState<TripSnapshot>(() => previewTrip());
  const [saveError, setSaveError] = useState("");
  const storeRef = useRef<TripMutationQueue | null>(null);
  if (!storeRef.current) {
    storeRef.current = new TripMutationQueue(
      snapshot,
      async next => {
        const saved = await saveTrip(next);
        queryClient.setQueryData(["trip"], saved);
        return saved;
      },
      (next, error) => {
        setSnapshot(next);
        setSaveError(error);
      },
    );
  }
  const query = useQuery({
    queryKey: ["trip"],
    queryFn: async () => {
      await loadSession();
      return getTrip();
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const apiState: "loading" | "live" | "offline" = query.isPending
    ? "loading"
    : query.isError
      ? "offline"
      : "live";
  const apiError = query.isError ? (query.error as Error).message : saveError;
  useEffect(() => {
    if (query.data) {
      storeRef.current?.replaceConfirmed(query.data);
    }
  }, [query.data]);
  const mutate = useCallback(
    (updater: (current: TripSnapshot) => TripSnapshot) => {
      if (apiState !== "live") return;
      storeRef.current?.enqueue(updater);
    },
    [apiState],
  );
  const retry = async () => {
    setSaveError("");
    const result = await query.refetch();
    if (result.data) storeRef.current?.reset(result.data);
  };
  return { snapshot, mutate, apiState, apiError, retry };
}

function DetourApp() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof getAuthSession>> | null>(null);
  const [failed, setFailed] = useState(false);
  const checkSession = useCallback(() => {
    setFailed(false);
    getAuthSession().then(setSession).catch(() => setFailed(true));
  }, []);
  useEffect(checkSession, [checkSession]);
  if (failed) return <LoginScreen mode="error" onRetry={checkSession}/>;
  if (!session) return <LoginScreen mode="loading"/>;
  if (!session.authenticated && !session.localDevelopment) return <LoginScreen mode="login" googleConfigured={session.googleConfigured}/>;
  return <AuthenticatedDetourApp session={session}/>;
}
function AuthenticatedDetourApp({session}: {session: Awaited<ReturnType<typeof getAuthSession>>}) {
  const [sessionError, setSessionError] = useState("");
  const state = useTripState();
  const { pathname } = useLocation();
  const [adding, setAdding] = useState(false);
  const { snapshot } = state;
  const header = <header className="detour-nav">
    <Link to="/" className="detour-brand"><DetourIcon/>Detour</Link>
    <span className="detour-trip">{snapshot.trip.name}<small>{shortDate(snapshot.trip.startDate)} – {shortDate(snapshot.trip.endDate)}</small></span>
    <nav aria-label="Main navigation">
      <Link to="/" aria-current={pathname === "/" ? "page" : undefined}>Places</Link>
      <Link to="/plan" aria-current={pathname === "/plan" ? "page" : undefined}>Plan</Link>
      <Link to="/preparation" aria-current={pathname === "/preparation" ? "page" : undefined}>Prepare</Link>
    </nav>
    {session?.authenticated && !session.localDevelopment && <button className="detour-account" onClick={()=>logout().then(()=>window.location.reload()).catch(error=>setSessionError(String(error)))}>Sign out</button>}
  </header>;
  if (state.apiError.includes("401")) return <LoginScreen mode="login" expired/>;
  const selected = new Set(snapshot.places.filter(p => p.selected).map(p => p.id));
  return <div className="detour-app">
    {sessionError && <div role="alert">{sessionError}</div>}
    {state.apiError && <div className="detour-save-error" role="alert">{state.apiError} <button onClick={state.retry}>Reload saved trip</button>{state.apiError.includes("401") && <a href="/auth/login?returnUrl=%2F">Sign in</a>}</div>}
    {state.apiState === "loading" || (state.apiState === "live" && snapshot.version === 0) ? <>{header}<p role="status">Loading your trip…</p></> : state.apiState === "offline" ? <>{header}<p>Your trip could not be loaded. Retry above to continue.</p></> : pathname === "/plan" ? <div className="detour-plan-shell">{header}<PlanPage snapshot={snapshot} update={state.mutate}/></div> : pathname === "/preparation" ? <>{header}<PreparePage snapshot={snapshot} update={state.mutate}/></> : <PlacesExplorer
      trip={{...snapshot,places:displayPlaces(snapshot.places)}} selected={selected}
      toggle={id => state.mutate(current => ({...current,places:current.places.map(p=>p.id===id?{...p,selected:!p.selected}:p)}))}
      loading={false} error="" header={header} onAdd={()=>setAdding(true)}
      renderEdit={(place, close) => <EditPlaceModal key={place.id} embedded
        place={snapshot.places.find(p => p.id === place.id) ?? place}
        onClose={close} onSave={updated => {
          state.mutate(current => ({...current, places:current.places.map(p => p.id === updated.id ? updated : p)}));
          close();
        }}/>}/>}
    {adding && <AddPlaceModal onClose={()=>setAdding(false)} onAdd={place=>{state.mutate(current=>({...current,places:[...current.places,place]}));setAdding(false)}}/>}
  </div>;
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
