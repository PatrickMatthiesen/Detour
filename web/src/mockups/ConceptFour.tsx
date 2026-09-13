import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import type { PlacesSearch } from "./places-search";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Hotel,
  Plane,
  TrainFront,
  Search,
} from "lucide-react";
import {
  DesignMap,
  PlacePhoto,
  PreviewNav,
  cityPlaces,
  shortDate,
  useDesignTrip,
} from "./design-kit";
import type { Place, TripSnapshot } from "../types";
import PlaceDetails from "../plan/PlaceDetails";
import { usePlacesDrawer } from "./use-places-drawer";
import { buildRouteStops, summarizeCityStops, STATUS_COLORS } from "./route-status";
import "./four.css";
import "./places-drawer.css";

const CITIES = ["Tokyo", "Kyoto", "Osaka"];

function placeDescription(place: Place) {
  return (
    place.description ||
    place.notes?.split("\n")[0] ||
    "Saved place awaiting a closer look."
  );
}

const statusVariables = Object.fromEntries(Object.entries(STATUS_COLORS).map(([status,color])=>[`--status-${status}`,color])) as CSSProperties;
function stayDate(value:string) {
  try { return shortDate(value); } catch { return "Date needed"; }
}

function TransportBookings({trip}:{trip:TripSnapshot|null}) {
  const groups = [
    {label:"Flights",icon:Plane,kinds:["flight"]},
    {label:"Other transport",icon:TrainFront,kinds:["transport","train","rail","bus","ferry"]},
  ];
  return <details className="d4-transport-bookings">
    <summary><TrainFront size={13} aria-hidden="true"/>Transport bookings</summary>
    <div className="d4-transport-summary">
      {groups.map(({label,icon:Icon,kinds})=>{
        const bookings=trip?.bookings.filter(b=>kinds.includes(b.kind.trim().toLowerCase())&&!['cancelled','canceled'].includes(b.status.trim().toLowerCase()))??[];
        const confirmed=bookings.filter(b=>b.status.trim().toLowerCase()==='confirmed').length;
        const status=!bookings.length?'saved':confirmed===bookings.length?'booked':confirmed?'partial':'picked';
        return <div key={label} data-status={status}><Icon size={14} aria-hidden="true"/><span>{label}: {bookings.length?`${confirmed} confirmed${bookings.length-confirmed?`, ${bookings.length-confirmed} unconfirmed`:''}`:'no bookings recorded'}</span></div>;
      })}
      <p>Recorded bookings only. Accommodation status does not include transport.</p>
    </div>
  </details>;
}

export default function ConceptFour() {
  const state = useDesignTrip();
  return <PlacesExplorer {...state} />;
}

export function PlacesExplorer({trip, selected, toggle, loading, error, header, onAdd, onEdit, renderEdit}: {trip:TripSnapshot|null;selected:Set<string>;toggle:(id:string)=>void;loading:boolean;error:string;header?:ReactNode;onAdd?:()=>void;onEdit?:(place:Place)=>void;renderEdit?:(place:Place,onClose:()=>void)=>ReactNode}) {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const city = search.city ?? "Tokyo";
  const category = search.category ?? "All";
  const selectedOnly = search.chosen === true;
  const query = search.q ?? "";
  const updateFilters = (patch: PlacesSearch, replace = false) => {
    void navigate({ to: ".", search: previous => ({ ...previous, ...patch }), replace, resetScroll: false });
  };
  const focusedId = search.place ?? null;
  const [editing, setEditing] = useState(false);
  const drawer = usePlacesDrawer();
  const lastCard = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement>(null);
  const openPlace = (id: string) => {
    lastCard.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    updateFilters({ place: id });
    drawer.open();
  };
  const closePlace = () => updateFilters({ place: undefined }, true);
  useEffect(() => { setEditing(false); }, [focusedId]);
  useEffect(() => {
    if (editing) return;
    if (focusedId) {
      panel.current?.querySelector<HTMLButtonElement>('[aria-label="Back to places"]')?.focus();
    } else {
      lastCard.current?.focus({ preventScroll: true });
    }
  }, [focusedId, editing]);
  const cityList = useMemo(() => {
    if (!trip) return [];
    const cities = new Set(trip.places.map((place) => place.city).filter(Boolean));
    return [...cities].sort((a, b) => a.localeCompare(b));
  }, [trip]);
  const cityPlacesList = useMemo(
    () => (trip ? cityPlaces(trip, city) : []),
    [city, trip],
  );
  const categories = useMemo(() => {
    const values = new Set<string>();
    for (const place of cityPlacesList) {
      for (const value of (place.category || "").split(",")) {
        const trimmed = value.trim();
        if (trimmed) values.add(trimmed);
      }
    }
    return ["All", ...[...values].sort((a, b) => a.localeCompare(b))];
  }, [cityPlacesList]);
  const places = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return cityPlacesList.filter((place) => {
      const matchesCategory =
        category === "All" ||
        (place.category || "")
          .split(",")
          .map((value) => value.trim())
          .includes(category);
      const matchesSelected = !selectedOnly || selected.has(place.id);
      const matchesSearch =
        !search ||
        [place.name, place.city, place.area, place.category, place.description]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(search);
      return matchesCategory && matchesSelected && matchesSearch;
    });
  }, [category, cityPlacesList, query, selected, selectedOnly]);
  const focused = trip?.places.find((place) => place.id === focusedId) || null;
  const stays = useMemo(() => buildRouteStops(trip), [trip]);
  const cityStatuses = useMemo(() => summarizeCityStops(stays), [stays]);

  const changeCity = (nextCity: string) => {
    updateFilters({ city: nextCity, category: undefined, chosen: undefined, q: undefined, place: undefined });
    drawer.open();
  };

  const clearFilters = () => {
    updateFilters({ category: undefined, chosen: undefined, q: undefined });
  };

  useEffect(() => {
    if (!focusedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("dialog")) return;
      if (event.key === "Escape") {
        if (editing) setEditing(false);
        else closePlace();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusedId, editing]);

  return (
    <><div className="new-preview d4-page" data-palette="journey" style={statusVariables}>
      {header ?? <PreviewNav active={4} />}

      <div className={`d4-workspace d4-drawer-workspace${drawer.collapsed ? " is-collapsed" : ""}`} ref={drawer.workspaceRef}>
        <aside className="d4-browse-panel d4-drawer" ref={panel} style={drawer.style} data-snap={drawer.snap} aria-label="Places panel">
          <button className="d4-sheet-handle" {...drawer.handle} aria-label="Resize places panel" aria-expanded={drawer.snap !== "collapsed"} aria-controls="places-panel-content">
            <span className="d4-sheet-grip"/><span>{focused?.name ?? "Places"}</span>
          </button>
          <button className="d4-panel-toggle" onClick={drawer.toggle} aria-expanded={!drawer.collapsed} aria-controls="places-panel-content" aria-label={drawer.collapsed ? "Expand places panel" : "Collapse places panel"}>
            {drawer.collapsed ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}
          </button>
          <div id="places-panel-content" className="d4-panel-content" inert={drawer.mobile ? drawer.snap === "collapsed" : drawer.collapsed}>
          <div className="d4-browse-view" hidden={!!focusedId}>
          <div className="d4-browse-head">
            <div>
              <h1>Places</h1>
              <p>
                {trip ? `${trip.places.length} saved ideas` : "Loading places"}
              </p>
            </div>
            <div className="d4-head-actions"><span className="d4-selection-count">{selected.size} chosen</span>{onAdd && <button onClick={onAdd}>+ Add place</button>}</div>
          </div>
          <div className="d4-city-tabs" role="tablist" aria-label="Browse city">
            {CITIES.map((item) => {
              const count = trip ? cityPlaces(trip, item).length : 0;
              return (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={city === item}
                  className={city === item ? "is-active" : ""}
                  onClick={() => changeCity(item)}
                >
                  <span>{item}</span>
                  <small>{count}</small>
                </button>
              );
            })}
            <select className="d4-more-cities" aria-label="Browse other cities" value={CITIES.includes(city) ? "" : city} onChange={event => changeCity(event.target.value)}>
              <option value="" disabled>More cities</option>
              <option value="All">All cities</option>
              {cityList.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="d4-search-bar">
            <select aria-label="Place selection" value={selectedOnly ? "chosen" : "all"} onChange={event => updateFilters({ chosen: event.target.value === "chosen" ? true : undefined })}>
              <option value="all">All saved</option>
              <option value="chosen">Chosen</option>
            </select>
            <Search size={16} aria-hidden="true" />
            <input type="search" value={query} onChange={event => updateFilters({ q: event.target.value || undefined }, true)} placeholder="Search places, food, ideas…" aria-label="Search saved places" />
          </div>
          <div className="d4-category-tabs" role="tablist" aria-label="Place category">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={category === item}
                data-category={item}
                className={category === item ? "is-active" : ""}
                onClick={() => updateFilters({ category: item === "All" ? undefined : item })}
              >
                {item}
              </button>
            ))}
          </div>
          {loading && <p className="d4-state">Loading the saved places…</p>}
          {error && <p className="d4-error">{error}</p>}
          {!loading && !error && cityPlacesList.length === 0 && (
            <p className="d4-state">No saved places in {city}.</p>
          )}
          {places.length > 0 && (
            <div className="d4-card-grid">
              {places.map((place) => {
                const isSelected = selected.has(place.id);
                return (
                  <article
                    className={`d4-place-card${isSelected ? " is-selected" : ""}${focusedId === place.id ? " is-focused" : ""}`}
                    key={place.id}
                    data-category={place.category?.split(",")[0].trim()}
                  >
                    <button
                      type="button"
                      className="d4-card-view"
                      onClick={() => openPlace(place.id)}
                      aria-label={`View ${place.name}`}
                    >
                      <PlacePhoto place={place} className="d4-card-photo" />
                      <span className="d4-card-copy">
                        <strong>{place.name}</strong>
                        <small>
                          {place.category || place.area || "Saved place"}
                        </small>
                        <span>{placeDescription(place)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="d4-card-check"
                      onClick={() => toggle(place.id)}
                      aria-label={`${isSelected ? "Unchoose" : "Choose"} ${place.name}`}
                      aria-pressed={isSelected}
                    >
                      {isSelected && <Check size={14} strokeWidth={3} />}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
          {!loading && !error && cityPlacesList.length > 0 && places.length === 0 && (
            <div className="d4-empty-filter">
              <strong>No places match these filters.</strong>
              <span>Clear the filters to see all saved ideas.</span>
              <button type="button" onClick={clearFilters}>Clear filters</button>
            </div>
          )}
          </div>
          {focused && (editing && renderEdit ? renderEdit(focused, () => setEditing(false)) : <PlaceDetails
            key={focused.id} embedded place={{...focused, selected:selected.has(focused.id)}}
            onClose={closePlace} onToggleTrip={() => toggle(focused.id)}
            onEdit={renderEdit ? () => setEditing(true) : onEdit ? () => onEdit(focused) : undefined}
          />)}
          {focusedId && !focused && !loading && <div className="d4-missing-place"><button onClick={closePlace}>Back to places</button><p>This place is no longer available.</p></div>}
          </div>
        </aside>

        <main className="d4-map-area" style={{"--map-bottom-inset": `${drawer.bottomInset}px`, "--map-left-inset": `${drawer.leftInset}px`} as CSSProperties}>
          <DesignMap
            places={trip?.places || []}
            selected={selected}
            city={city}
            onCity={changeCity}
            onPlace={(place) => openPlace(place.id)}
            focusedPlaceId={focusedId ?? undefined}
            bottomInset={drawer.bottomInset}
            leftInset={drawer.leftInset}
            className="d4-map"
            routeStops={stays}
            cityStatuses={cityStatuses}
            palette="journey"
            showInformation={false}
          />
        </main>
      </div>

      <footer className="d4-stays" aria-label="Planned city stays">
        <div className="d4-stays-label">
          <strong>Route</strong>
        </div>
        <div className="d4-route-heading"><span><Hotel size={13} aria-hidden="true"/>Accommodation by stay</span><TransportBookings trip={trip}/></div>
        <div className="d4-stays-list">
          {stays.length ? (
            stays.map((stay, index) => (
              <button
                type="button"
                onClick={() => changeCity(stay.city)}
                aria-pressed={city === stay.city}
                className="d4-stay"
                data-status={stay.status}
                title={`${stay.city}: ${stay.detail}`}
                aria-label={`${stay.city}, ${stayDate(stay.checkIn)} to ${stayDate(stay.checkOut)}, accommodation ${stay.label.toLowerCase()}, ${stay.detail}`}
                key={`${stay.city}-${stay.checkIn}-${index}`}
              >
                <span>
                  <strong>{stay.city}</strong>
                  <small>
                    {stayDate(stay.checkIn)} – {stayDate(stay.checkOut)}
                  </small>
                  <small className="d4-stay-status"><Hotel size={12} aria-hidden="true"/>{stay.label}</small>
                </span>
              </button>
            ))
          ) : (
            <span className="d4-stay-empty">No city stays planned yet.</span>
          )}
        </div>
      </footer>
    </div>
    </>
  );
}
