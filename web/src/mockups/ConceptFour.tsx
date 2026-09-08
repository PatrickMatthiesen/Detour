import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Check,
  Clock3,
  ExternalLink,
  Search,
  X,
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
import "./four.css";

const CITIES = ["Tokyo", "Kyoto", "Osaka"];

function placeDescription(place: Place) {
  return (
    place.description ||
    place.notes?.split("\n")[0] ||
    "Saved place awaiting a closer look."
  );
}

function placeFullDescription(place: Place) {
  return place.description || place.notes || "Saved place awaiting research.";
}

function cityStayStrip(trip: ReturnType<typeof useDesignTrip>["trip"]) {
  if (!trip) return [];
  const stops: { city: string; checkIn: string; checkOut: string }[] = [];
  for (const stay of trip.stays) {
    const last = stops.at(-1);
    if (last && last.city === stay.city) {
      last.checkOut = stay.checkOut;
      continue;
    }
    stops.push({
      city: stay.city,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
    });
  }
  return stops;
}

export default function ConceptFour() {
  const state = useDesignTrip();
  return <PlacesExplorer {...state} />;
}

export function PlacesExplorer({trip, selected, toggle, loading, error, header, onAdd, onEdit}: {trip:TripSnapshot|null;selected:Set<string>;toggle:(id:string)=>void;loading:boolean;error:string;header?:ReactNode;onAdd?:()=>void;onEdit?:(place:Place)=>void}) {
  const [city, setCity] = useState("Tokyo");
  const [category, setCategory] = useState("All");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [focusedId, setFocusedId] = useState<string | null>(null);
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
  const stays = cityStayStrip(trip);

  const changeCity = (nextCity: string) => {
    setCity(nextCity);
    setCategory("All");
    setSelectedOnly(false);
    setQuery("");
    setFocusedId(null);
  };

  const clearFilters = () => {
    setCategory("All");
    setSelectedOnly(false);
    setQuery("");
  };

  useEffect(() => {
    if (!focusedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocusedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusedId]);

  return (
    <div className="new-preview d4-page" data-palette="journey">
      {header ?? <PreviewNav active={4} />}

      <div className="d4-workspace">
        <aside className="d4-browse-panel">
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
            <select aria-label="Place selection" value={selectedOnly ? "chosen" : "all"} onChange={event => setSelectedOnly(event.target.value === "chosen")}>
              <option value="all">All saved</option>
              <option value="chosen">Chosen</option>
            </select>
            <Search size={16} aria-hidden="true" />
            <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search places, food, ideas…" aria-label="Search saved places" />
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
                onClick={() => setCategory(item)}
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
                      onClick={() => setFocusedId(place.id)}
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
        </aside>

        <main className="d4-map-area">
          <DesignMap
            places={trip?.places || []}
            selected={selected}
            city={city}
            onCity={changeCity}
            onPlace={(place) => setFocusedId(place.id)}
            className="d4-map"
            palette="journey"
            showInformation={false}
          />
          {focused && (
            <aside className="d4-map-inspector" role="dialog" aria-label="Place details">
              <button
                type="button"
                className="d4-inspector-close"
                onClick={() => setFocusedId(null)}
                aria-label="Close place details"
              >
                <X size={16} />
              </button>
              <PlacePhoto place={focused} className="d4-inspector-photo" />
              <div className="d4-inspector-content">
                <span className="d4-inspector-area">{focused.area || focused.city}</span>
                <h2>{focused.name}</h2>
                <p className="d4-inspector-description">
                  {placeFullDescription(focused)}
                </p>
                <div className="d4-inspector-meta">
                  <span>{focused.category || "Place"}</span>
                  <span>
                    <Clock3 size={13} />
                    {focused.durationMinutes
                      ? `${focused.durationMinutes} min`
                      : focused.durationText || "Time unknown"}
                  </span>
                  {focused.reservation && <span>Reservation: {focused.reservation}</span>}
                  {focused.openingHours && <span>{focused.openingHours}</span>}
                </div>
                <div className="d4-inspector-actions">
                  {onEdit && <button className="d4-edit-place" onClick={() => onEdit(focused)}>Edit place</button>}
                  <button
                    type="button"
                    className={`d4-inspector-select${selected.has(focused.id) ? " is-selected" : ""}`}
                    onClick={() => toggle(focused.id)}
                    aria-pressed={selected.has(focused.id)}
                  >
                    {selected.has(focused.id) ? <><Check size={14} /> Chosen</> : "Choose for trip"}
                  </button>
                  {[
                    [focused.sourceUrl, "Source"],
                    [focused.googleMapsUrl, "Maps"],
                    [focused.instagramUrl, "Instagram"],
                  ].map(([url, label]) => url && (
                    <a key={label} href={url} target="_blank" rel="noreferrer">
                      {label} <ExternalLink size={12} />
                    </a>
                  ))}
                </div>
              </div>
            </aside>
          )}
        </main>
      </div>

      <footer className="d4-stays" aria-label="Planned city stays">
        <div className="d4-stays-label">
          <strong>Stays</strong>
        </div>
        <div className="d4-stays-list">
          {stays.length ? (
            stays.map((stay, index) => (
              <button
                type="button"
                onClick={() => changeCity(stay.city)}
                aria-pressed={city === stay.city}
                className="d4-stay"
                key={`${stay.city}-${stay.checkIn}-${index}`}
              >
                <span>
                  <strong>{stay.city}</strong>
                  <small>
                    {shortDate(stay.checkIn)} – {shortDate(stay.checkOut)}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <span className="d4-stay-empty">No city stays planned yet.</span>
          )}
        </div>
      </footer>
    </div>
  );
}
