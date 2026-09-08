import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import maplibregl from "maplibre-gl";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useLocation,
} from "@tanstack/react-router";
import {
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Compass,
  Edit3,
  Filter,
  Hotel,
  ListChecks,
  Map,
  MapPin,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Train,
  Trash2,
  X,
} from "lucide-react";
import {
  getAuthSession,
  getTrip,
  loadSession,
  logout,
  previewTrip,
  saveTrip,
} from "./api";
import { PlacesExplorer } from "./mockups/ConceptFour";
import { displayPlaces, shortDate } from "./mockups/design-kit";
import PlanPage from "./plan/PlanPage";
import "./detour.css";
import { TripMutationQueue } from "./trip-store";
import {
  calendarDays,
  dayCapacity,
  lodgingSummary,
  selectedUnscheduled,
} from "./planning";
import type {
  Booking,
  PackingItem,
  Place,
  Stay,
  TravelLeg,
  TripSnapshot,
} from "./types";
import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";

const uid = (prefix: string) =>
  `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
const hasOffset = (value: string) => /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
const datePart = (value: string) =>
  value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? value;
const fmtDate = (value: string, timeZone?: string | null) => {
  const date =
    hasOffset(value) && timeZone
      ? new Date(value)
      : new Date(`${datePart(value)}T12:00:00`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(hasOffset(value) && timeZone ? { timeZone } : {}),
  }).format(date);
};
const fmtDateTime = (
  value: string | null | undefined,
  timeZone?: string | null,
) => {
  if (!value) return "time unknown";
  const time = value.match(/T(\d{2}:\d{2})/)?.[1];
  if (!time) return fmtDate(value, timeZone);
  if (hasOffset(value) && timeZone) {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(new Date(value));
  }
  return `${fmtDate(value)} · ${time}`;
};
const dateTimeLocalValue = (value: string | null | undefined) =>
  value?.slice(0, 16) || "";
const sourceOffset = (value: string | null | undefined) =>
  value?.match(/(?:Z|[+-]\d{2}:?\d{2})$/)?.[0] ?? "";

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

type TripState = ReturnType<typeof useTripState>;
const TripContext = createContext<TripState | null>(null);
function useSharedTrip() {
  const value = useContext(TripContext);
  if (!value) throw new Error("Trip context is missing");
  return value;
}

function App() {
  const trip = useTripState();
  const [auth, setAuth] = useState<Awaited<
    ReturnType<typeof getAuthSession>
  > | null>(null);
  const [authError, setAuthError] = useState("");
  useEffect(() => {
    getAuthSession()
      .then(setAuth)
      .catch((error: Error) => setAuthError(error.message));
  }, []);
  const location = useLocation();
  const path = location.pathname;
  const active = path.startsWith("/itinerary")
    ? "itinerary"
    : path.startsWith("/preparation")
      ? "preparation"
      : "library";
  return (
    <TripContext.Provider value={trip}>
      <div className="app-shell">
        <Sidebar active={active} snapshot={trip.snapshot} />
        <main className="main-shell">
          <header className="topbar">
            <div className="mobile-mark">
              <Compass size={18} />
              <span>DETOUR</span>
            </div>
            <div className="trip-switcher">
              <span className="trip-dot" />
              <div>
                <strong>{trip.snapshot.trip.name}</strong>
                <span>
                  {fmtDate(trip.snapshot.trip.startDate)} —{" "}
                  {fmtDate(trip.snapshot.trip.endDate)} · Solo
                </span>
              </div>
              <ChevronRight size={16} />
            </div>
            <div className="topbar-account">
              {auth?.authenticated ? (
                <>
                  <span>{auth.email || "Signed in"}</span>
                  <button
                    onClick={() =>
                      logout()
                        .then(() => window.location.reload())
                        .catch((error: Error) => setAuthError(error.message))
                    }
                  >
                    Sign out
                  </button>
                </>
              ) : auth?.googleConfigured === false ? (
                <span className="auth-setup">
                  Google sign-in needs API configuration
                </span>
              ) : (
                <a href="/auth/login?returnUrl=%2F">Sign in with Google</a>
              )}
            </div>
          </header>
          {trip.apiError && (
            <div className="api-notice">
              <CircleAlert size={16} />
              <span>
                {trip.apiState === "offline"
                  ? "Trip API unavailable · showing a read-only local preview."
                  : `Could not save the latest change · ${trip.apiError}`}
              </span>
              {trip.apiError.includes("401") ? (
                <a className="api-login" href="/auth/login?returnUrl=%2F">
                  <Send size={14} /> Sign in
                </a>
              ) : (
                <button onClick={trip.retry}>
                  <RefreshCw size={14} /> Retry
                </button>
              )}
            </div>
          )}
          {authError && !trip.apiError && (
            <div className="api-notice">
              <CircleAlert size={16} />
              <span>Sign-in status unavailable · {authError}</span>
              <a className="api-login" href="/auth/login?returnUrl=%2F">
                <Send size={14} /> Open sign-in
              </a>
            </div>
          )}
          {trip.apiState === "loading" && <div className="loading-line" />}
          <div className="page-content">
            <Outlet />
          </div>
        </main>
      </div>
    </TripContext.Provider>
  );
}

function Sidebar({
  active,
  snapshot,
}: {
  active: string;
  snapshot: TripSnapshot;
}) {
  const nav = [
    { to: "/", key: "library", label: "Place library", icon: MapPin },
    {
      to: "/itinerary",
      key: "itinerary",
      label: "Itinerary",
      icon: CalendarDays,
    },
    {
      to: "/preparation",
      key: "preparation",
      label: "Preparation",
      icon: ListChecks,
    },
  ];
  const selected = snapshot.places.filter((place) => place.selected).length;
  const due = snapshot.tasks.filter((task) => !task.completed).length;
  return (
    <aside className="sidebar">
      <div className="brand">
        <Compass size={22} strokeWidth={1.7} />
        <span>DETOUR</span>
      </div>
      <div className="sidebar-trip">
        <span className="overline">CURRENT TRIP</span>
        <strong>Japan</strong>
        <span>Autumn 2026</span>
      </div>
      <nav aria-label="Main navigation">
        {nav.map(({ to, key, label, icon: Icon }) => (
          <Link
            key={key}
            to={to}
            className={`nav-link ${active === key ? "active" : ""}`}
          >
            <Icon size={18} strokeWidth={1.8} />
            <span>{label}</span>
            {key === "library" && selected > 0 && <em>{selected}</em>}
            {key === "preparation" && due > 0 && (
              <em className="nav-warn">{due}</em>
            )}
          </Link>
        ))}
      </nav>
      <div className="sidebar-rule" />
      <div className="sidebar-section">
        <span className="overline">TRIP HEALTH</span>
        <div className="health-row">
          <span>Places selected</span>
          <strong>{selected}</strong>
        </div>
        <div className="health-row">
          <span>Stay coverage</span>
          <strong className="warn-text">Hotel dates only</strong>
        </div>
        <div className="health-row">
          <span>Ready to pack</span>
          <strong>
            {snapshot.packingItems.filter((item) => item.packed).length} /{" "}
            {snapshot.packingItems.length}
          </strong>
        </div>
      </div>
      <div className="sidebar-bottom">
        <span className="build-label">Personal planner · v0.1</span>
      </div>
    </aside>
  );
}

function LibraryPage() {
  const state = useSharedTrip();
  return <Library snapshot={state.snapshot} mutate={state.mutate} />;
}
function ItineraryPage() {
  const state = useSharedTrip();
  return <Itinerary snapshot={state.snapshot} mutate={state.mutate} />;
}
function PreparationPage() {
  const state = useSharedTrip();
  return <Preparation snapshot={state.snapshot} mutate={state.mutate} />;
}

function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function StatStrip({ snapshot }: { snapshot: TripSnapshot }) {
  const cities = new Set(snapshot.places.map((p) => p.city).filter(Boolean))
    .size;
  const selected = snapshot.places.filter((p) => p.selected).length;
  const areas = new Set(
    snapshot.places.filter((p) => p.selected).map((p) => `${p.city}/${p.area}`),
  ).size;
  return (
    <div className="stat-strip">
      <div>
        <span className="stat-value">{snapshot.places.length}</span>
        <span className="stat-label">saved places</span>
      </div>
      <div>
        <span className="stat-value">{cities}</span>
        <span className="stat-label">cities in library</span>
      </div>
      <div>
        <span className="stat-value accent-number">{selected}</span>
        <span className="stat-label">selected for Japan</span>
      </div>
      <div>
        <span className="stat-value indigo-number">{areas}</span>
        <span className="stat-label">active areas</span>
      </div>
    </div>
  );
}

function Library({
  snapshot,
  mutate,
}: {
  snapshot: TripSnapshot;
  mutate: (fn: (s: TripSnapshot) => TripSnapshot) => void;
}) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("All cities");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editPlace, setEditPlace] = useState<Place | null>(null);
  const [focusPlace, setFocusPlace] = useState<string | null>(null);
  const cities = Array.from(new Set(snapshot.places.map((p) => p.city))).sort();
  const places = snapshot.places.filter(
    (p) =>
      (!query ||
        `${p.name} ${p.city} ${p.area} ${p.category}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (city === "All cities" || p.city === city) &&
      (!selectedOnly || p.selected),
  );
  const byCity = places.reduce<Record<string, Place[]>>((acc, place) => {
    (acc[place.city] ??= []).push(place);
    return acc;
  }, {});
  const toggle = (id: string) =>
    mutate((s) => ({
      ...s,
      places: s.places.map((p) =>
        p.id === id ? { ...p, selected: !p.selected } : p,
      ),
    }));
  const addPlace = (place: Place) =>
    mutate((s) => ({ ...s, places: [...s.places, place] }));
  return (
    <>
      <PageHeading
        title="Your place library"
        description="A generous list of possibilities. Select what feels right, then let the map show what becomes easy."
        action={
          <button
            className="button button-primary"
            onClick={() => setShowAdd(true)}
          >
            <Plus size={17} /> Add a place
          </button>
        }
      />
      <StatStrip snapshot={snapshot} />
      <div className="library-layout">
        <section className="library-panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search places, areas, cities…"
                aria-label="Search places"
              />
            </label>
            <button
              className={`filter-button ${selectedOnly ? "active" : ""}`}
              onClick={() => setSelectedOnly(!selectedOnly)}
            >
              <Filter size={16} /> {selectedOnly ? "Selected" : "All places"}
            </button>
          </div>
          <div className="city-tabs">
            <button
              className={city === "All cities" ? "active" : ""}
              onClick={() => setCity("All cities")}
            >
              All cities
            </button>
            {cities.map((item) => (
              <button
                key={item}
                className={city === item ? "active" : ""}
                onClick={() => setCity(item)}
              >
                {item}
                <span>
                  {snapshot.places.filter((p) => p.city === item).length}
                </span>
              </button>
            ))}
          </div>
          <div className="library-list">
            {Object.entries(byCity).map(([cityName, cityPlaces]) => (
              <CityGroup
                key={cityName}
                city={cityName}
                places={cityPlaces}
                focusPlace={focusPlace}
                onFocus={setFocusPlace}
                onToggle={toggle}
                onEdit={setEditPlace}
              />
            ))}
            {places.length === 0 && (
              <div className="empty-state">
                <Search size={25} />
                <strong>No places match that search</strong>
                <span>Try a city, area, or category, or add a new place.</span>
              </div>
            )}
          </div>
        </section>
        <MapPanel
          places={snapshot.places}
          focusPlace={focusPlace}
          onFocus={setFocusPlace}
        />
      </div>
      {showAdd && (
        <AddPlaceModal
          onClose={() => setShowAdd(false)}
          onAdd={(place) => {
            addPlace(place);
            setShowAdd(false);
          }}
        />
      )}
      {editPlace && (
        <EditPlaceModal
          place={editPlace}
          onClose={() => setEditPlace(null)}
          onSave={(updated) => {
            mutate((s) => ({
              ...s,
              places: s.places.map((p) => (p.id === updated.id ? updated : p)),
            }));
            setEditPlace(null);
          }}
        />
      )}
    </>
  );
}

function CityGroup({
  city,
  places,
  focusPlace,
  onFocus,
  onToggle,
  onEdit,
}: {
  city: string;
  places: Place[];
  focusPlace: string | null;
  onFocus: (id: string) => void;
  onToggle: (id: string) => void;
  onEdit: (place: Place) => void;
}) {
  const selected = places.filter((p) => p.selected).length;
  const activeAreas = new Set(
    places.filter((p) => p.selected).map((p) => p.area),
  ).size;
  return (
    <div className="city-group">
      <div className={`city-heading ${selected ? "has-selection" : ""}`}>
        <div>
          <MapPin size={15} />
          <h2>{city}</h2>
          <span>
            {places.length} saved · {activeAreas || "No"} active{" "}
            {activeAreas === 1 ? "area" : "areas"}
          </span>
        </div>
        {selected > 0 && (
          <span className="selection-note">
            <Check size={13} /> {selected} selected
          </span>
        )}
      </div>
      <div className="area-grid">
        {places.map((place) => (
          <PlaceRow
            key={place.id}
            place={place}
            focused={focusPlace === place.id}
            onFocus={() => onFocus(place.id)}
            onToggle={() => onToggle(place.id)}
            onEdit={() => onEdit(place)}
          />
        ))}
      </div>
    </div>
  );
}

function PlaceRow({
  place,
  focused,
  onFocus,
  onToggle,
  onEdit,
}: {
  place: Place;
  focused: boolean;
  onFocus: () => void;
  onToggle: () => void;
  onEdit: () => void;
}) {
  return (
    <article
      className={`place-row ${place.selected ? "selected" : ""} ${focused ? "focused" : ""}`}
      onClick={onFocus}
    >
      <button
        className={`select-mark ${place.selected ? "checked" : ""}`}
        aria-label={`${place.selected ? "Remove" : "Select"} ${place.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {place.selected && <Check size={14} strokeWidth={3} />}
      </button>
      <div className="place-copy">
        <div className="place-title-line">
          <h3>{place.name}</h3>
          {place.priority === "required" && (
            <span className="tag required">Required</span>
          )}
          {place.needsResearch && (
            <span className="research-dot" title="Needs research" />
          )}
        </div>
        <div className="place-meta">
          <span>{place.area || "Area unknown"}</span>
          <span className="dot-sep">·</span>
          <span>{place.category || "Uncategorised"}</span>
          {place.durationText && (
            <>
              <span className="dot-sep">·</span>
              <span>{place.durationText}</span>
            </>
          )}
        </div>
        <p>{place.description || place.notes || "No description yet."}</p>
      </div>
      <div className="place-trailing">
        {place.selected ? (
          <span className="tag selected-tag">Selected</span>
        ) : (
          <span className="status-text">{place.status || "Saved"}</span>
        )}
        <button
          className="row-edit"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={`Edit ${place.name}`}
        >
          <Edit3 size={14} />
        </button>
        <ChevronRight size={16} />
      </div>
    </article>
  );
}

const CITY_COORDS: Record<string, [number, number]> = {
  Tokyo: [139.6917, 35.6895],
  Yokohama: [139.638, 35.4437],
  Nagano: [138.181, 36.6513],
  Nagoya: [136.9066, 35.1815],
  Kyoto: [135.7681, 35.0116],
  Osaka: [135.5023, 34.6937],
  Hiroshima: [132.4553, 34.3853],
  Fukui: [136.2156, 36.0652],
  Hyogo: [134.853, 34.6913],
};

function MapPanel({
  places,
  focusPlace,
  onFocus,
}: {
  places: Place[];
  focusPlace: string | null;
  onFocus: (id: string) => void;
}) {
  const selected = places.filter((p) => p.selected);
  const activeCities = new Set(selected.map((p) => p.city));
  const cities = Array.from(
    new Set(places.map((p) => p.city).filter((city) => CITY_COORDS[city])),
  );
  const mapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [137.5, 35.3],
      zoom: 5.3,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    const markers: maplibregl.Marker[] = [];
    let disposed = false;
    const renderMapData = () => {
      // `load` belongs to this map instance. React Strict Mode may dispose an
      // earlier instance before its style finishes, so never reuse readiness.
      if (disposed || !map.isStyleLoaded()) return;
      cities.forEach((city) => {
        const cityPlaces = places.filter((p) => p.city === city);
        const marker = new maplibregl.Marker({
          color: cityPlaces.some((p) => p.selected) ? "#b9422e" : "#58725c",
        })
          .setLngLat(CITY_COORDS[city])
          .setPopup(
            new maplibregl.Popup({ offset: 18 }).setText(
              `${city} · ${cityPlaces.length} saved places${cityPlaces.some((p) => p.selected) ? " · active" : ""}`,
            ),
          )
          .addTo(map);
        marker
          .getElement()
          .addEventListener("click", () => onFocus(cityPlaces[0].id));
        markers.push(marker);
      });
      const routeCities = Array.from(
        new Set(
          places
            .filter((p) => p.selected && CITY_COORDS[p.city])
            .map((p) => p.city),
        ),
      );
      if (routeCities.length > 1) {
        map.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: routeCities.map((city) => CITY_COORDS[city]),
            },
            properties: {},
          },
        });
        map.addLayer({
          id: "route",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#315a72",
            "line-width": 2,
            "line-dasharray": [2, 2],
            "line-opacity": 0.72,
          },
        });
      }
    };
    map.on("load", renderMapData);
    return () => {
      disposed = true;
      map.off("load", renderMapData);
      markers.forEach((marker) => marker.remove());
      map.remove();
    };
  }, [cities.join("|"), selected.map((p) => p.id).join("|"), onFocus, places]);
  return (
    <section className="map-panel">
      <div className="map-header">
        <div>
          <span className="overline">GEOGRAPHIC CONTEXT</span>
          <h2>Clusters emerge as you choose</h2>
        </div>
        <span className="map-status">City areas · approximate</span>
      </div>
      <div className="map-canvas real-map" ref={mapRef} />
      {cities.length === 0 && (
        <div className="map-empty">
          <MapPin size={15} /> No known city coordinates yet; unresolved areas
          stay in the library.
        </div>
      )}
      <div className="map-legend">
        <span>
          <i className="legend-dot selected-dot" />
          Selected city
        </span>
        <span>
          <i className="legend-dot saved-dot" />
          Saved city
        </span>
        <span>
          <i className="legend-ring" />
          Approximate area
        </span>
      </div>
      {activeCities.size > 0 ? (
        <div className="map-insight">
          <Sparkles size={16} />
          <span>
            <strong>{Array.from(activeCities).join(" + ")}</strong> are active.
            Nearby saved places are lifted in the list.
          </span>
        </div>
      ) : (
        <div className="map-insight quiet">
          <MapPin size={16} />
          <span>
            Place coordinates are unresolved, so the map uses known city centers
            only.
          </span>
        </div>
      )}
    </section>
  );
}

function AddPlaceModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (place: Place) => void;
}) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("Tokyo");
  const [area, setArea] = useState("");
  const [category, setCategory] = useState("Sightseeing");
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({
      id: uid("place"),
      name: name.trim(),
      city: city.trim() || "Unknown city",
      area: area.trim(),
      category,
      notes: notes.trim(),
      description: notes.trim(),
      sourceUrl: sourceUrl.trim() || null,
      priority: "nice",
      status: "Candidate",
      needsResearch: true,
      selected: false,
    });
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <span className="overline">NEW LIBRARY ENTRY</span>
            <h2>Add a place</h2>
            <p>Keep the idea loose. You can decide where it fits later.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="form-grid">
          <label>
            Name
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. teamLab Borderless"
              required
            />
          </label>
          <label>
            City
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Tokyo"
            />
          </label>
          <label>
            Area / neighborhood
            <input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Azabudai"
            />
          </label>
          <label>
            Category
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option>Sightseeing</option>
              <option>Food</option>
              <option>Culture</option>
              <option>Nature</option>
              <option>Shopping</option>
              <option>Activity</option>
            </select>
          </label>
          <label className="span-2">
            Source URL
            <input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…"
              type="url"
            />
          </label>
          <label className="span-2">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why did you save this?"
              rows={3}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            <Plus size={17} /> Save place
          </button>
        </div>
      </form>
    </div>
  );
}

function EditPlaceModal({
  place,
  onClose,
  onSave,
}: {
  place: Place;
  onClose: () => void;
  onSave: (place: Place) => void;
}) {
  const [draft, setDraft] = useState(place);
  const set = (key: keyof Place, value: string | number | null) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.name.trim())
      onSave({
        ...draft,
        name: draft.name.trim(),
        city: draft.city.trim() || "Unknown city",
      });
  };
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <span className="overline">LIBRARY ENTRY</span>
            <h2>Edit place</h2>
            <p>Correct the facts without losing the original source.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="form-grid">
          <label>
            Name
            <input
              autoFocus
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              required
            />
          </label>
          <label>
            City
            <input
              value={draft.city}
              onChange={(e) => set("city", e.target.value)}
            />
          </label>
          <label>
            Area / neighborhood
            <input
              value={draft.area || ""}
              onChange={(e) => set("area", e.target.value)}
            />
          </label>
          <label>
            Visit minutes
            <input
              type="number"
              min="0"
              value={draft.durationMinutes ?? ""}
              onChange={(e) =>
                set(
                  "durationMinutes",
                  e.target.value ? Number(e.target.value) : null,
                )
              }
              placeholder="Unknown"
            />
          </label>
          <label>
            Latitude
            <input
              type="number"
              step="any"
              value={draft.latitude ?? ""}
              onChange={(e) =>
                set("latitude", e.target.value ? Number(e.target.value) : null)
              }
              placeholder="Unknown"
            />
          </label>
          <label>
            Longitude
            <input
              type="number"
              step="any"
              value={draft.longitude ?? ""}
              onChange={(e) =>
                set("longitude", e.target.value ? Number(e.target.value) : null)
              }
              placeholder="Unknown"
            />
          </label>
          <label className="span-2">
            Source URL
            <input
              value={draft.sourceUrl || ""}
              onChange={(e) => set("sourceUrl", e.target.value)}
              type="url"
            />
          </label>
          <label className="span-2">
            Notes
            <textarea
              value={draft.notes || ""}
              onChange={(e) => set("notes", e.target.value)}
              rows={4}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            <Check size={17} /> Save changes
          </button>
        </div>
      </form>
    </div>
  );
}

function Itinerary({
  snapshot,
  mutate,
}: {
  snapshot: TripSnapshot;
  mutate: (fn: (s: TripSnapshot) => TripSnapshot) => void;
}) {
  const [showStay, setShowStay] = useState(false);
  const [showTravel, setShowTravel] = useState(false);
  const [editingStay, setEditingStay] = useState<Stay | null>(null);
  const [editingTravel, setEditingTravel] = useState<TravelLeg | null>(null);
  const dates = calendarDays(snapshot.trip.startDate, snapshot.trip.endDate);
  const selected = snapshot.places.filter((p) => p.selected);
  const schedule = (place: Place, date: string) =>
    mutate((s) => ({
      ...s,
      activities: [
        ...s.activities,
        {
          id: uid("activity"),
          placeId: place.id,
          date,
          durationMinutes: place.durationMinutes ?? null,
          status: "planned",
        },
      ],
      places: s.places.map((p) =>
        p.id === place.id ? { ...p, selected: true } : p,
      ),
    }));
  const removeActivity = (id: string) =>
    mutate((s) => ({
      ...s,
      activities: s.activities.filter((a) => a.id !== id),
    }));
  const removeStay = (stay: Stay) => {
    if (
      stay.bookingId &&
      !window.confirm(
        "This stay is linked to a booking. Remove the planning stay and keep the booking?",
      )
    )
      return;
    mutate((s) => ({
      ...s,
      stays: s.stays.filter((item) => item.id !== stay.id),
    }));
  };
  const removeTravel = (leg: TravelLeg) =>
    mutate((s) => ({
      ...s,
      travelLegs: s.travelLegs.filter((item) => item.id !== leg.id),
    }));
  const lodging = lodgingSummary(snapshot);
  const arrivalLabel =
    snapshot.trip.arrival?.localDateTime ||
    snapshot.trip.arrival?.time ||
    "time unknown";
  const departureLabel =
    snapshot.trip.departure?.localDateTime ||
    snapshot.trip.departure?.time ||
    "time unknown";
  const arrivalDisplay = snapshot.trip.arrival?.localDateTime
    ? fmtDateTime(snapshot.trip.arrival.localDateTime, snapshot.trip.timeZone)
    : arrivalLabel;
  const departureDisplay = snapshot.trip.departure?.localDateTime
    ? fmtDateTime(snapshot.trip.departure.localDateTime, snapshot.trip.timeZone)
    : departureLabel;
  return (
    <>
      <PageHeading
        title="Shape the days"
        description="A flexible spine for the trip. Commit to cities and activities only when they earn their place."
        action={
          <div className="heading-actions">
            <button
              className="button button-quiet"
              onClick={() => setShowStay(true)}
            >
              <Hotel size={16} /> Add stay
            </button>
            <button
              className="button button-quiet"
              onClick={() => setShowTravel(true)}
            >
              <Train size={16} /> Add travel
            </button>
            <button
              className="button button-primary"
              onClick={() =>
                selected[0] &&
                schedule(
                  selected[0],
                  dates.find(
                    (d) => !snapshot.activities.some((a) => a.date === d),
                  ) ?? dates[0],
                )
              }
            >
              <Plus size={17} /> Schedule selected
            </button>
          </div>
        }
      />
      <div className="itinerary-summary">
        <div>
          <span className="overline">TRIP WINDOW</span>
          <strong>
            {fmtDate(snapshot.trip.startDate)} —{" "}
            {fmtDate(snapshot.trip.endDate)}
          </strong>
          <span>
            Arrival {snapshot.trip.arrival?.airport} · {arrivalDisplay} ·
            Departure {snapshot.trip.departure?.airport} · {departureDisplay}
          </span>
        </div>
        <div className="summary-alert">
          <CircleAlert size={16} />
          <span>
            <strong>{lodging.uncovered.length} nights</strong> to review for
            hotel coverage · stays are planning allocations
          </span>
        </div>
      </div>
      <div className="itinerary-layout">
        <div className="day-spine">
          {dates.map((date, i) => {
            const activities = snapshot.activities.filter(
              (a) => a.date === date,
            );
            const stay = snapshot.stays.find(
              (s) => date >= s.checkIn && date < s.checkOut,
            );
            const travel = snapshot.travelLegs.filter((l) => l.date === date);
            const capacity = dayCapacity(snapshot, date);
            return (
              <div
                className={`day-row ${activities.length ? "has-activity" : ""}`}
                key={date}
              >
                <div className="day-date">
                  <strong>{String(i + 1).padStart(2, "0")}</strong>
                  <span>
                    {new Intl.DateTimeFormat("en-US", {
                      weekday: "short",
                    }).format(new Date(`${date}T12:00:00`))}
                  </span>
                  <time>{fmtDate(date)}</time>
                </div>
                <div className="day-content">
                  {stay && (
                    <div className="timeline-chip stay-chip">
                      <Hotel size={15} />
                      <span>
                        Staying in <strong>{stay.city}</strong>
                      </span>
                      <small>{stay.name || "Accommodation planned"}</small>
                      <button
                        className="timeline-edit"
                        onClick={() => setEditingStay(stay)}
                        aria-label={`Edit stay in ${stay.city}`}
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        className="timeline-edit"
                        onClick={() => removeStay(stay)}
                        aria-label={`Remove stay in ${stay.city}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                  {travel.map((leg) => (
                    <div className="timeline-chip travel-chip" key={leg.id}>
                      <Train size={15} />
                      <span>
                        {leg.from} → {leg.to}
                      </span>
                      <small>
                        {leg.mode || "Travel"} ·{" "}
                        {leg.durationMinutes
                          ? `${Math.round((leg.durationMinutes / 60) * 10) / 10}h`
                          : "Time unknown"}
                        {leg.estimated ? " · estimated" : ""}
                      </small>
                      <button
                        className="timeline-edit"
                        onClick={() => setEditingTravel(leg)}
                        aria-label={`Edit travel from ${leg.from} to ${leg.to}`}
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        className="timeline-edit"
                        onClick={() => removeTravel(leg)}
                        aria-label={`Remove travel from ${leg.from} to ${leg.to}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {activities.map((activity) => {
                    const place = snapshot.places.find(
                      (p) => p.id === activity.placeId,
                    );
                    if (!place)
                      return (
                        <div
                          className="timeline-chip activity-chip"
                          key={activity.id}
                        >
                          <div className="activity-marker">
                            <Check size={13} />
                          </div>
                          <span>{activity.title || "Unlinked activity"}</span>
                          <small>
                            {activity.durationMinutes
                              ? `${activity.durationMinutes} min`
                              : "duration unknown"}
                          </small>
                          <button
                            onClick={() => removeActivity(activity.id)}
                            aria-label="Remove unlinked activity"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    return (
                      <div
                        className="timeline-chip activity-chip"
                        key={activity.id}
                      >
                        <div className="activity-marker">
                          <Check size={13} />
                        </div>
                        <span>{place.name}</span>
                        <small>
                          {place.area || place.city} ·{" "}
                          {activity.durationMinutes
                            ? `${activity.durationMinutes} min`
                            : "duration unknown"}
                        </small>
                        <button
                          onClick={() => removeActivity(activity.id)}
                          aria-label={`Remove ${place.name}`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <span className="free-time">
                    {capacity.overCapacityMinutes > 0
                      ? `${capacity.allocatedMinutes} min allocated`
                      : `${capacity.remainingMinutes} min free`}
                    {capacity.isUpperBound ? " upper bound" : ""}
                    {capacity.unknownCount
                      ? ` · ${capacity.unknownCount} time unknown`
                      : ""}
                  </span>
                  {(capacity.overCapacityMinutes > 0 ||
                    capacity.overlaps.length > 0) && (
                    <span className="day-warning">
                      <CircleAlert size={13} />{" "}
                      {capacity.overCapacityMinutes > 0
                        ? `${capacity.overCapacityMinutes} min over capacity`
                        : "Overlapping timed activities"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <aside className="unallocated">
          <div className="section-title">
            <div>
              <span className="overline">SELECTED, UNALLOCATED</span>
              <h2>Still to place</h2>
            </div>
            <span className="count-badge">
              {selectedUnscheduled(snapshot).length}
            </span>
          </div>
          <p className="aside-copy">
            These ideas are part of the trip conversation, waiting for a day to
            earn them.
          </p>
          {selectedUnscheduled(snapshot).map((place) => (
            <div className="unallocated-row" key={place.id}>
              <div>
                <strong>{place.name}</strong>
                <span>
                  {place.city} · {place.durationText || "time unknown"}
                </span>
              </div>
              <select
                defaultValue=""
                onChange={(e) =>
                  e.target.value && schedule(place, e.target.value)
                }
                aria-label={`Schedule ${place.name}`}
              >
                <option value="">Add to day…</option>
                {dates.map((date, i) => (
                  <option key={date} value={date}>
                    Day {i + 1} · {fmtDate(date)}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {selected.length === 0 && (
            <div className="empty-small">
              <MapPin size={18} />
              <span>Select places in the library first.</span>
            </div>
          )}
        </aside>
      </div>
      {showStay && (
        <StayModal
          dates={dates}
          onClose={() => setShowStay(false)}
          onSave={(stay) => {
            mutate((s) => ({ ...s, stays: [...s.stays, stay] }));
            setShowStay(false);
          }}
        />
      )}
      {showTravel && (
        <TravelModal
          dates={dates}
          onClose={() => setShowTravel(false)}
          onSave={(leg) => {
            mutate((s) => ({ ...s, travelLegs: [...s.travelLegs, leg] }));
            setShowTravel(false);
          }}
        />
      )}
      {editingStay && (
        <StayModal
          initial={editingStay}
          dates={dates}
          onClose={() => setEditingStay(null)}
          onSave={(stay) => {
            mutate((s) => ({
              ...s,
              stays: s.stays.map((item) => (item.id === stay.id ? stay : item)),
            }));
            setEditingStay(null);
          }}
        />
      )}
      {editingTravel && (
        <TravelModal
          initial={editingTravel}
          dates={dates}
          onClose={() => setEditingTravel(null)}
          onSave={(leg) => {
            mutate((s) => ({
              ...s,
              travelLegs: s.travelLegs.map((item) =>
                item.id === leg.id ? leg : item,
              ),
            }));
            setEditingTravel(null);
          }}
        />
      )}
    </>
  );
}

function StayModal({
  initial,
  dates,
  onClose,
  onSave,
}: {
  initial?: Stay;
  dates: string[];
  onClose: () => void;
  onSave: (stay: Stay) => void;
}) {
  const [city, setCity] = useState(initial?.city || "Tokyo");
  const [name, setName] = useState(initial?.name || "");
  const [checkIn, setCheckIn] = useState(initial?.checkIn || dates[0]);
  const [checkOut, setCheckOut] = useState(
    initial?.checkOut || dates[1] || dates[0],
  );
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: initial?.id || uid("stay"),
            city,
            name: name || null,
            checkIn,
            checkOut,
            status: initial?.status || "planned",
            bookingId: initial?.bookingId || null,
          });
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="overline">
              {initial ? "EDIT STAY" : "NEW STAY"}
            </span>
            <h2>{initial ? "Edit stay" : "Add a city stay"}</h2>
            <p>
              A stay allocates planning time; hotel coverage is tracked
              separately.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="form-grid">
          <label>
            City
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
            />
          </label>
          <label>
            Label
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kyoto base"
            />
          </label>
          <label>
            First day
            <input
              type="date"
              value={checkIn}
              onInput={(e) => setCheckIn(e.currentTarget.value)}
              required
            />
          </label>
          <label>
            Last day / checkout
            <input
              type="date"
              value={checkOut}
              onInput={(e) => setCheckOut(e.currentTarget.value)}
              required
            />
          </label>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            <Check size={17} /> Save stay
          </button>
        </div>
      </form>
    </div>
  );
}

function TravelModal({
  initial,
  dates,
  onClose,
  onSave,
}: {
  initial?: TravelLeg;
  dates: string[];
  onClose: () => void;
  onSave: (leg: TravelLeg) => void;
}) {
  const [from, setFrom] = useState(initial?.from || "");
  const [to, setTo] = useState(initial?.to || "");
  const [date, setDate] = useState(initial?.date || dates[0]);
  const [duration, setDuration] = useState(
    initial?.durationMinutes?.toString() || "",
  );
  const [mode, setMode] = useState(initial?.mode || "train");
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            id: initial?.id || uid("leg"),
            from,
            to,
            date,
            durationMinutes: duration ? Number(duration) : null,
            mode,
            estimated: initial?.estimated ?? true,
          });
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="overline">
              {initial ? "EDIT TRAVEL" : "NEW TRAVEL"}
            </span>
            <h2>{initial ? "Edit travel leg" : "Add travel leg"}</h2>
            <p>Keep estimates editable and label them as estimates.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="form-grid">
          <label>
            From
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </label>
          <label>
            To
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </label>
          <label>
            Date
            <input
              type="date"
              value={date}
              onInput={(e) => setDate(e.currentTarget.value)}
              required
            />
          </label>
          <label>
            Duration (minutes)
            <input
              type="number"
              min="0"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="Unknown"
            />
          </label>
          <label>
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="train">Train</option>
              <option value="flight">Flight</option>
              <option value="bus">Bus</option>
              <option value="walk">Walk</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            <Check size={17} /> Save travel
          </button>
        </div>
      </form>
    </div>
  );
}

function Preparation({
  snapshot,
  mutate,
}: {
  snapshot: TripSnapshot;
  mutate: (fn: (s: TripSnapshot) => TripSnapshot) => void;
}) {
  const [tab, setTab] = useState<"tasks" | "packing" | "bookings">("tasks");
  const [newTask, setNewTask] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskReminderAt, setTaskReminderAt] = useState("");
  const [newItem, setNewItem] = useState("");
  const [category, setCategory] = useState("Essentials");
  const addTask = () => {
    if (!newTask.trim()) return;
    mutate((s) => ({
      ...s,
      tasks: [
        ...s.tasks,
        {
          id: uid("task"),
          title: newTask.trim(),
          scope: "trip",
          completed: false,
          dueDate: taskDueDate || null,
          reminderAt: taskReminderAt || null,
        },
      ],
    }));
    setNewTask("");
    setTaskDueDate("");
    setTaskReminderAt("");
  };
  const addItem = () => {
    if (!newItem.trim()) return;
    mutate((s) => ({
      ...s,
      packingItems: [
        ...s.packingItems,
        {
          id: uid("pack"),
          name: newItem.trim(),
          category,
          quantity: 1,
          packed: false,
          bag: null,
        },
      ],
    }));
    setNewItem("");
  };
  const toggleTask = (id: string) =>
    mutate((s) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, completed: !t.completed } : t,
      ),
    }));
  const togglePack = (id: string) =>
    mutate((s) => ({
      ...s,
      packingItems: s.packingItems.map((p) =>
        p.id === id ? { ...p, packed: !p.packed } : p,
      ),
    }));
  const updatePack = (id: string, patch: Partial<PackingItem>) =>
    mutate((s) => ({
      ...s,
      packingItems: s.packingItems.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    }));
  const removeTask = (id: string) =>
    mutate((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== id) }));
  const removePack = (id: string) =>
    mutate((s) => ({
      ...s,
      packingItems: s.packingItems.filter((p) => p.id !== id),
    }));
  const packed = snapshot.packingItems.filter((i) => i.packed).length;
  return (
    <>
      <PageHeading
        title="Get ready to go"
        description="The small actions that make the trip feel lighter. Keep preparation close to the plan."
      />
      <div className="prep-overview">
        <div className="prep-progress">
          <div className="progress-ring">
            <span>
              {snapshot.tasks.filter((t) => t.completed).length}
              <small>/{snapshot.tasks.length}</small>
            </span>
          </div>
          <div>
            <span className="overline">TRIP CHECKLIST</span>
            <strong>
              {snapshot.tasks.filter((t) => !t.completed).length} things to do
            </strong>
            <span>In-app reminders stay visible until complete.</span>
          </div>
        </div>
        <div className="prep-progress">
          <div className="progress-bar">
            <i
              style={{
                width: `${snapshot.packingItems.length ? (packed / snapshot.packingItems.length) * 100 : 0}%`,
              }}
            />
          </div>
          <div>
            <span className="overline">PACKING</span>
            <strong>
              {packed} / {snapshot.packingItems.length} packed
            </strong>
            <span>Buying and packing stay separate.</span>
          </div>
        </div>
      </div>
      <div className="prep-tabs">
        <button
          className={tab === "tasks" ? "active" : ""}
          onClick={() => setTab("tasks")}
        >
          <ListChecks size={17} /> Checklist{" "}
          <span>{snapshot.tasks.filter((t) => !t.completed).length}</span>
        </button>
        <button
          className={tab === "packing" ? "active" : ""}
          onClick={() => setTab("packing")}
        >
          <PackageCheck size={17} /> Packing{" "}
          <span>{snapshot.packingItems.length - packed}</span>
        </button>
        <button
          className={tab === "bookings" ? "active" : ""}
          onClick={() => setTab("bookings")}
        >
          <Hotel size={17} /> Bookings <span>{snapshot.bookings.length}</span>
        </button>
      </div>
      {tab === "tasks" && (
        <div className="prep-list">
          <div className="inline-add">
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              placeholder="Add a task before the trip…"
            />
            <input
              type="date"
              value={taskDueDate}
              onInput={(e) => setTaskDueDate(e.currentTarget.value)}
              aria-label="Task due date"
            />
            <input
              type="datetime-local"
              value={taskReminderAt}
              onInput={(e) => setTaskReminderAt(e.currentTarget.value)}
              aria-label="Task reminder"
            />
            <button className="button button-primary" onClick={addTask}>
              <Plus size={16} /> Add task
            </button>
          </div>
          {snapshot.tasks.length === 0 && (
            <div className="empty-state">
              <ListChecks size={25} />
              <strong>Your checklist is clear</strong>
              <span>Add the small thing you do not want to forget.</span>
            </div>
          )}
          {snapshot.tasks.map((task) => (
            <div
              className={`prep-row ${task.completed ? "done" : ""}`}
              key={task.id}
            >
              <button
                className={`select-mark ${task.completed ? "checked" : ""}`}
                onClick={() => toggleTask(task.id)}
                aria-label={`Mark ${task.title} ${task.completed ? "incomplete" : "complete"}`}
              >
                {task.completed && <Check size={14} strokeWidth={3} />}
              </button>
              <div>
                <strong>{task.title}</strong>
                <span>
                  {task.scope === "booking" ? "Booking" : "Trip"}
                  {task.dueDate
                    ? ` · due ${fmtDate(task.dueDate)}`
                    : " · no due date"}
                  {task.reminderAt
                    ? ` · reminder ${fmtDate(task.reminderAt)}`
                    : ""}
                </span>
              </div>
              {task.dueDate &&
                !task.completed &&
                new Date(`${task.dueDate}T12:00:00`) < new Date() && (
                  <span className="tag overdue">Overdue</span>
                )}
              <button
                className="delete-button"
                onClick={() => removeTask(task.id)}
                aria-label={`Delete ${task.title}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      {tab === "packing" && (
        <div className="prep-list">
          <div className="inline-add">
            <input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addItem()}
              placeholder="Add something to pack…"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Packing category"
            >
              <option>Essentials</option>
              <option>Clothing</option>
              <option>Electronics</option>
              <option>Toiletries</option>
              <option>Documents</option>
              <option>Comfort</option>
            </select>
            <button className="button button-primary" onClick={addItem}>
              <Plus size={16} /> Add item
            </button>
          </div>
          {Array.from(
            new Set(snapshot.packingItems.map((item) => item.category)),
          ).map((group) => {
            const items = snapshot.packingItems.filter(
              (item) => item.category === group,
            );
            return (
              <div className="packing-group" key={group}>
                <div className="group-label">
                  <span>{group}</span>
                  <i />
                </div>
                {items.map((item) => (
                  <div
                    className={`prep-row ${item.packed ? "done" : ""}`}
                    key={item.id}
                  >
                    <button
                      className={`select-mark ${item.packed ? "checked moss" : ""}`}
                      onClick={() => togglePack(item.id)}
                      aria-label={`Mark ${item.name} ${item.packed ? "unpacked" : "packed"}`}
                    >
                      {item.packed && <Check size={14} strokeWidth={3} />}
                    </button>
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {item.quantity > 1 ? `${item.quantity} × ` : ""}
                        {item.bag || "Bag not assigned"}
                      </span>
                    </div>
                    <div className="pack-controls">
                      <label>
                        Qty{" "}
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) =>
                            updatePack(item.id, {
                              quantity: Math.max(
                                1,
                                Number(e.target.value) || 1,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Bag{" "}
                        <select
                          value={item.bag || ""}
                          onChange={(e) =>
                            updatePack(item.id, { bag: e.target.value || null })
                          }
                        >
                          <option value="">Unassigned</option>
                          <option>Main bag</option>
                          <option>Personal item</option>
                          <option>Day bag</option>
                        </select>
                      </label>
                    </div>
                    <button
                      className="delete-button"
                      onClick={() => removePack(item.id)}
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {tab === "bookings" && <Bookings snapshot={snapshot} mutate={mutate} />}
    </>
  );
}

function Bookings({
  snapshot,
  mutate,
}: {
  snapshot: TripSnapshot;
  mutate: (fn: (s: TripSnapshot) => TripSnapshot) => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("hotel");
  const [editing, setEditing] = useState<Booking | null>(null);
  const add = () => {
    if (!title.trim()) return;
    mutate((s) => ({
      ...s,
      bookings: [
        ...s.bookings,
        {
          id: uid("booking"),
          title: title.trim(),
          kind,
          status: "planned",
          start: null,
          end: null,
          notes: "Added manually",
        },
      ],
    }));
    setTitle("");
  };
  return (
    <div className="prep-list">
      <div className="inline-add">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a booking to track…"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Booking type"
        >
          <option value="hotel">Accommodation</option>
          <option value="ticket">Ticket / timed entry</option>
          <option value="transport">Transport</option>
          <option value="restaurant">Restaurant</option>
        </select>
        <button className="button button-primary" onClick={add}>
          <Plus size={16} /> Add booking
        </button>
      </div>
      {snapshot.bookings.map((booking) => (
        <div className="booking-row" key={booking.id}>
          <div className={`booking-icon ${booking.kind}`}>
            <Hotel size={18} />
          </div>
          <div>
            <strong>{booking.title}</strong>
            <span>
              {booking.kind} · {booking.status}
              {booking.start
                ? ` · ${fmtDate(booking.start, snapshot.trip.timeZone)}`
                : ""}
              {booking.end
                ? ` → ${fmtDate(booking.end, snapshot.trip.timeZone)}`
                : ""}
            </span>
            {(booking.checkIn || booking.checkOut || booking.location) && (
              <span>
                {booking.checkIn ? `Stay ${fmtDate(booking.checkIn)}` : ""}
                {booking.checkOut ? ` → ${fmtDate(booking.checkOut)}` : ""}
                {booking.location ? ` · ${booking.location}` : ""}
              </span>
            )}
            {booking.notes && <p>{booking.notes}</p>}
          </div>
          <button
            className="row-edit"
            onClick={() => setEditing(booking)}
            aria-label={`Edit ${booking.title}`}
          >
            <Edit3 size={14} />
          </button>
          <button
            className="status-select"
            onClick={() =>
              mutate((s) => ({
                ...s,
                bookings: s.bookings.map((b) =>
                  b.id === booking.id
                    ? {
                        ...b,
                        status:
                          b.status === "confirmed" ? "planned" : "confirmed",
                      }
                    : b,
                ),
              }))
            }
          >
            {booking.status === "confirmed" ? "Confirmed" : "Mark confirmed"}
          </button>
        </div>
      ))}
      {editing && (
        <BookingModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(updated) => {
            mutate((s) => ({
              ...s,
              bookings: s.bookings.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function BookingModal({
  initial,
  onClose,
  onSave,
}: {
  initial: Booking;
  onClose: () => void;
  onSave: (booking: Booking) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (key: keyof Booking, value: string | null) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setDateTime = (key: "start" | "end", value: string) =>
    setDraft((current) => ({
      ...current,
      [key]: value ? `${value}${sourceOffset(current[key])}` : null,
    }));
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(draft);
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="overline">BOOKING DETAILS</span>
            <h2>Edit booking</h2>
            <p>Keep confirmation and date details together for the trip.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="form-grid">
          <label>
            Title
            <input
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              required
            />
          </label>
          <label>
            Status
            <select
              value={draft.status}
              onChange={(e) => set("status", e.target.value)}
            >
              <option value="planned">Planned</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label>
            Start / date
            <input
              type="datetime-local"
              value={dateTimeLocalValue(draft.start)}
              onInput={(e) => setDateTime("start", e.currentTarget.value)}
            />
          </label>
          <label>
            End
            <input
              type="datetime-local"
              value={dateTimeLocalValue(draft.end)}
              onInput={(e) => setDateTime("end", e.currentTarget.value)}
            />
          </label>
          <label>
            Hotel check-in
            <input
              type="date"
              value={draft.checkIn || ""}
              onInput={(e) => set("checkIn", e.currentTarget.value || null)}
            />
          </label>
          <label>
            Hotel check-out
            <input
              type="date"
              value={draft.checkOut || ""}
              onInput={(e) => set("checkOut", e.currentTarget.value || null)}
            />
          </label>
          <label>
            Confirmation code
            <input
              value={draft.confirmationCode || ""}
              onChange={(e) => set("confirmationCode", e.target.value || null)}
            />
          </label>
          <label>
            Location
            <input
              value={draft.location || ""}
              onChange={(e) => set("location", e.target.value || null)}
            />
          </label>
          <label className="span-2">
            Notes
            <textarea
              rows={4}
              value={draft.notes || ""}
              onChange={(e) => set("notes", e.target.value || null)}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="button button-quiet"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="button button-primary" type="submit">
            <Check size={17} /> Save booking
          </button>
        </div>
      </form>
    </div>
  );
}

const ConceptOne = React.lazy(() => import("./mockups/ConceptOne"));
const ConceptTwo = React.lazy(() => import("./mockups/ConceptTwo"));
const ConceptThree = React.lazy(() => import("./mockups/ConceptThree"));
const ConceptFour = React.lazy(() => import("./mockups/ConceptFour"));
const ConceptFive = React.lazy(() => import("./mockups/ConceptFive"));
const ConceptSix = React.lazy(() => import("./mockups/ConceptSix"));
const ConceptSeven = React.lazy(() => import("./mockups/ConceptSeven"));
const ConceptEight = React.lazy(() => import("./mockups/ConceptEight"));
const ConceptNine = React.lazy(() => import("./mockups/ConceptNine"));
function DetourApp() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof getAuthSession>> | null>(null);
  const [sessionError, setSessionError] = useState("");
  useEffect(()=>{getAuthSession().then(setSession).catch(error=>setSessionError(String(error)))},[]);
  const state = useTripState();
  const { pathname } = useLocation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Place|null>(null);
  const { snapshot } = state;
  const header = <header className="detour-nav">
    <Link to="/" className="detour-brand"><Compass size={21}/>Detour</Link>
    <span className="detour-trip">{snapshot.trip.name}<small>{shortDate(snapshot.trip.startDate)} – {shortDate(snapshot.trip.endDate)}</small></span>
    <nav aria-label="Main navigation">
      <Link to="/" aria-current={pathname === "/" ? "page" : undefined}>Places</Link>
      <Link to="/plan" aria-current={pathname === "/plan" ? "page" : undefined}>Plan</Link>
      <Link to="/preparation">Prepare</Link>
    </nav>
    {session?.authenticated && !session.localDevelopment && <button className="detour-account" onClick={()=>logout().then(()=>window.location.reload()).catch(error=>setSessionError(String(error)))}>Sign out</button>}
  </header>;
  const selected = new Set(snapshot.places.filter(p => p.selected).map(p => p.id));
  return <div className="detour-app">
    {sessionError && <div role="alert">{sessionError}</div>}
    {state.apiError && <div className="detour-save-error" role="alert">{state.apiError} <button onClick={state.retry}>Reload saved trip</button>{state.apiError.includes("401") && <a href="/auth/login?returnUrl=%2F">Sign in</a>}</div>}
    {state.apiState === "loading" || (state.apiState === "live" && snapshot.version === 0) ? <>{header}<p role="status">Loading your trip…</p></> : state.apiState === "offline" ? <>{header}<p>Your trip could not be loaded. Retry above to continue.</p></> : pathname === "/plan" ? <div className="detour-plan-shell">{header}<PlanPage snapshot={snapshot} update={state.mutate}/></div> : <PlacesExplorer
      trip={{...snapshot,places:displayPlaces(snapshot.places)}} selected={selected}
      toggle={id => state.mutate(current => ({...current,places:current.places.map(p=>p.id===id?{...p,selected:!p.selected}:p)}))}
      loading={false} error="" header={header} onAdd={()=>setAdding(true)}
      onEdit={place=>setEditing(snapshot.places.find(p=>p.id===place.id)??place)} />}
    {adding && <AddPlaceModal onClose={()=>setAdding(false)} onAdd={place=>{state.mutate(current=>({...current,places:[...current.places,place]}));setAdding(false)}}/>}
    {editing && <EditPlaceModal place={editing} onClose={()=>setEditing(null)} onSave={place=>{state.mutate(current=>({...current,places:current.places.map(p=>p.id===place.id?place:p)}));setEditing(null)}}/>}
  </div>;
}
function RouteShell() {
  const { pathname } = useLocation();
  if (pathname === "/" || pathname === "/plan") return <DetourApp />;
  return /^\/[1-9]\/?$/.test(pathname)
    ? <React.Suspense fallback={<p role="status">Loading design preview…</p>}><Outlet /></React.Suspense>
    : <App />;
}
const rootRoute = createRootRoute({ component: RouteShell });
const conceptRoutes = [
  createRoute({ getParentRoute: () => rootRoute, path: "/4", component: ConceptFour }),
  createRoute({ getParentRoute: () => rootRoute, path: "/5", component: ConceptFive }),
  createRoute({ getParentRoute: () => rootRoute, path: "/6", component: ConceptSix }),
  createRoute({ getParentRoute: () => rootRoute, path: "/7", component: ConceptSeven }),
  createRoute({ getParentRoute: () => rootRoute, path: "/8", component: ConceptEight }),
  createRoute({ getParentRoute: () => rootRoute, path: "/9", component: ConceptNine }),
  createRoute({ getParentRoute: () => rootRoute, path: "/1", component: ConceptOne }),
  createRoute({ getParentRoute: () => rootRoute, path: "/2", component: ConceptTwo }),
  createRoute({ getParentRoute: () => rootRoute, path: "/3", component: ConceptThree }),
];
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LibraryPage,
});
const itineraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/itinerary",
  component: ItineraryPage,
});
const preparationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/preparation",
  component: PreparationPage,
});
const planRoute = createRoute({getParentRoute:()=>rootRoute,path:"/plan",component:()=>null});
const routeTree = rootRoute.addChildren([
  planRoute,
  ...conceptRoutes,
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
