import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Map, Search, SlidersHorizontal, X } from "lucide-react";
import type { Place } from "../types";
import { DesignMap, PlacePhoto, PreviewNav, cityPlaces, useDesignTrip } from "./design-kit";
import "./six.css";

type InterestGroup = "Food & drink" | "Make & experience" | "Culture & outdoors";

const GROUPS: InterestGroup[] = ["Food & drink", "Make & experience", "Culture & outdoors"];

function interestGroup(place: Place): InterestGroup {
  const text = `${place.category ?? ""} ${place.name} ${place.description ?? ""}`.toLowerCase();
  if (/(food|drink|restaurant|ramen|cafe|coffee|bar|market|bakery|sushi|izakaya|dessert|meal)/.test(text)) return "Food & drink";
  if (/(experience|shopping|shop|craft|workshop|onsen|theatre|theater|show|anime|studio|museum|castle)/.test(text)) return "Make & experience";
  return "Culture & outdoors";
}

function placeDescription(place: Place) {
  return place.description || place.notes || "Description not captured yet.";
}

function ConceptSix() {
  const { trip, selected, toggle, loading, error } = useDesignTrip();
  const [city, setCity] = useState("Tokyo");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [shortlistOpen, setShortlistOpen] = useState(false);
  const [focusedPlace, setFocusedPlace] = useState<Place | null>(null);

  const visiblePlaces = useMemo(() => {
    if (!trip) return [];
    const source = city === "All" ? trip.places : cityPlaces(trip, city);
    const normalizedQuery = query.trim().toLowerCase();
    return source.filter((place) => !normalizedQuery || `${place.name} ${place.category ?? ""} ${place.city} ${place.area ?? ""}`.toLowerCase().includes(normalizedQuery));
  }, [city, query, trip]);

  const groupedPlaces = useMemo(() => GROUPS.map((group) => ({ group, places: visiblePlaces.filter((place) => interestGroup(place) === group) })), [visiblePlaces]);
  const selectedPlaces = useMemo(() => trip?.places.filter((place) => selected.has(place.id)) ?? [], [selected, trip]);
  const cityOptions = ["All", "Tokyo", "Kyoto", "Osaka"];

  if (loading || !trip) {
    return <main className="new-preview d6-page"><div className="d6-loading">{error ? <><strong>Trip data unavailable</strong><span>{error}</span></> : <span>Loading saved interests…</span>}</div></main>;
  }

  return (
    <main className="new-preview d6-page">
      <PreviewNav active={6} />

      <div className="d6-toolbar">
        <div className="d6-city-picker" aria-label="Filter by city">
          {cityOptions.map((option) => <button key={option} className={city === option ? "d6-active" : ""} onClick={() => setCity(option)}>{option}</button>)}
        </div>
        <div className="d6-toolbar-actions">
          {searchOpen && <label className="d6-search"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved places" aria-label="Search saved places" />{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={14} /></button>}</label>}
          <button className={`d6-tool-button ${searchOpen ? "d6-tool-active" : ""}`} onClick={() => setSearchOpen((open) => !open)} aria-expanded={searchOpen}><Search size={16} /><span>Search</span></button>
          <button className="d6-tool-button d6-shortlist-toggle" onClick={() => setShortlistOpen((open) => !open)} aria-expanded={shortlistOpen}><Map size={16} /><span>Shortlist</span><b>{selectedPlaces.length}</b></button>
        </div>
      </div>

      <div className={`d6-workspace ${shortlistOpen ? "d6-drawer-open" : ""}`}>
        <section className="d6-board" aria-label="Saved interests by category">
          {groupedPlaces.map(({ group, places }) => (
            <section className="d6-interest-column" key={group}>
              <div className="d6-column-heading"><h2>{group}</h2><span>{places.length}</span></div>
              <div className="d6-card-stack">
                {places.length ? places.map((place) => {
                  const isSelected = selected.has(place.id);
                  return <article className={`d6-place-card ${isSelected ? "d6-selected" : ""}`} key={place.id}>
                    <button className="d6-card-main" onClick={() => setFocusedPlace(place)} aria-label={`View details for ${place.name}`}>
                      <PlacePhoto place={place} className="d6-card-photo" />
                      <div className="d6-card-copy"><h3>{place.name}</h3><p>{placeDescription(place)}</p><span>{place.category || "Place"} <i>·</i> {place.city}</span></div>
                    </button>
                    <button className="d6-select-button" onClick={() => toggle(place.id)} aria-label={`${isSelected ? "Remove" : "Add"} ${place.name} ${isSelected ? "from" : "to"} shortlist`} aria-pressed={isSelected}>{isSelected ? <Check size={16} /> : <span />}</button>
                  </article>;
                }) : <div className="d6-empty-column">No saved places here yet.</div>}
              </div>
            </section>
          ))}
        </section>

        {shortlistOpen && <aside className="d6-drawer" aria-label="Shortlisted places">
          <div className="d6-drawer-heading"><h2>{selectedPlaces.length ? `${selectedPlaces.length} shortlisted` : "Shortlist"}</h2><button className="d6-drawer-close" onClick={() => setShortlistOpen(false)} aria-label="Close shortlist"><X size={17} /></button></div>
          <DesignMap places={selectedPlaces} selected={selected} city={city === "All" ? undefined : city} onPlace={(place) => setFocusedPlace(place)} className="d6-shortlist-map" />
          <div className="d6-drawer-list">
            {selectedPlaces.length ? selectedPlaces.map((place) => <button className={`d6-shortlist-row ${focusedPlace?.id === place.id ? "d6-focused" : ""}`} key={place.id} onClick={() => setFocusedPlace(place)}><span className="d6-row-dot" /><span><strong>{place.name}</strong><small>{place.city}{place.area ? ` · ${place.area}` : ""}</small></span><ChevronRight size={15} /></button>) : <div className="d6-drawer-empty"><SlidersHorizontal size={18} /><p>Choose places from the board to compare your options here.</p></div>}
          </div>
          {focusedPlace && <div className="d6-detail"><div className="d6-detail-heading"><strong>Details</strong><button onClick={() => setFocusedPlace(null)} aria-label="Close details"><X size={14} /></button></div><h3>{focusedPlace.name}</h3><p>{placeDescription(focusedPlace)}</p><span>{focusedPlace.category || "Place"} <i>·</i> {focusedPlace.city}</span></div>}
          <div className="d6-drawer-foot"><span>Changes stay local to this preview.</span><button onClick={() => setShortlistOpen(false)}>Keep browsing <ChevronDown size={14} /></button></div>
        </aside>}
      </div>
    </main>
  );
}

export default ConceptSix;
