import { useMemo, useState } from "react";
import { Check, Clock3, MapPin, X } from "lucide-react";
import {
  DesignMap,
  PlacePhoto,
  PreviewNav,
  cityPlaces,
  useDesignTrip,
} from "./design-kit";
import type { Place } from "../types";
import "./five.css";

const CITIES = ["Tokyo", "Kyoto", "Osaka"];
const BASE_CATEGORIES = ["Culture", "Food", "Shopping", "Outdoors"];

function firstSentences(place: Place) {
  const source =
    place.description || place.notes || "Saved place awaiting research.";
  return source
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join(" ");
}

function categories(places: Place[]) {
  const values = new Set<string>();
  for (const place of places) {
    for (const category of (place.category || "").split(",")) {
      const value = category.trim();
      if (value) values.add(value);
    }
  }
  return [
    "All",
    ...BASE_CATEGORIES.filter((item) => values.has(item)),
    ...[...values]
      .filter((item) => !BASE_CATEGORIES.includes(item))
      .slice(0, 3),
  ];
}

export default function ConceptFive() {
  const { trip, selected, toggle, loading, error } = useDesignTrip();
  const [city, setCity] = useState("Tokyo");
  const [category, setCategory] = useState("All");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const places = useMemo(
    () => (trip ? cityPlaces(trip, city) : []),
    [city, trip],
  );
  const categoryTabs = useMemo(() => categories(places), [places]);
  const filteredPlaces = useMemo(
    () =>
      category === "All"
        ? places
        : places.filter((place) =>
            (place.category || "")
              .split(",")
              .map((item) => item.trim())
              .includes(category),
          ),
    [category, places],
  );
  const focused = places.find((place) => place.id === focusedId) || null;
  const chosen = places.filter((place) => selected.has(place.id));

  const selectCity = (nextCity: string) => {
    setCity(nextCity);
    setCategory("All");
    setFocusedId(null);
  };

  return (
    <div className="new-preview d5-page">
      <PreviewNav active={5} />

      <div className="d5-layout">
        <main className="d5-reading-column">
          <section className="d5-city-intro">
            <div className="d5-city-hero">
              {places[0] ? (
                <PlacePhoto place={places[0]} className="d5-hero-photo" />
              ) : (
                <div className="d5-hero-empty">
                  {loading ? "Loading places" : "No saved places"}
                </div>
              )}
            </div>
            <div className="d5-city-heading">
              <div
                className="d5-city-switcher"
                role="tablist"
                aria-label="Browse city chapters"
              >
                {CITIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={city === item}
                    className={city === item ? "is-active" : ""}
                    onClick={() => selectCity(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
              <h1>{city}</h1>
              <p>
                {places.length} saved places · {chosen.length} chosen
              </p>
            </div>
          </section>
          <div
            className="d5-category-tabs"
            role="tablist"
            aria-label="Browse categories"
          >
            {categoryTabs.map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={category === item}
                className={category === item ? "is-active" : ""}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          {loading && <p className="d5-state">Loading the saved places…</p>}
          {error && <p className="d5-error">{error}</p>}
          {!loading && !error && filteredPlaces.length === 0 && (
            <p className="d5-state">No places in this category.</p>
          )}
          <section className="d5-articles" aria-label={`${city} places`}>
            {filteredPlaces.map((place) => {
              const isSelected = selected.has(place.id);
              return (
                <article
                  className={`d5-article${isSelected ? " is-selected" : ""}${focusedId === place.id ? " is-focused" : ""}`}
                  key={place.id}
                >
                  <button
                    className="d5-article-view"
                    type="button"
                    onClick={() => setFocusedId(place.id)}
                    aria-label={`View ${place.name}`}
                  >
                    <PlacePhoto place={place} className="d5-article-photo" />
                    <span className="d5-article-copy">
                      <strong>{place.name}</strong>
                      <span>{firstSentences(place)}</span>
                      <small>
                        <MapPin size={13} />
                        {place.category || "Place"}
                        <i /> <Clock3 size={13} />
                        {place.durationMinutes
                          ? `${place.durationMinutes} min`
                          : place.durationText || "Time unknown"}
                      </small>
                    </span>
                  </button>
                  <button
                    className="d5-article-check"
                    type="button"
                    onClick={() => toggle(place.id)}
                    aria-label={`${isSelected ? "Unchoose" : "Choose"} ${place.name}`}
                    aria-pressed={isSelected}
                  >
                    {isSelected && <Check size={15} strokeWidth={3} />}
                  </button>
                </article>
              );
            })}
          </section>
          {focused && (
            <aside className="d5-details" aria-label="Place details">
              <button
                className="d5-details-close"
                type="button"
                onClick={() => setFocusedId(null)}
                aria-label="Close place details"
              >
                <X size={16} />
              </button>
              <p>{focused.area || focused.city}</p>
              <h2>{focused.name}</h2>
              <div className="d5-details-text">
                {focused.description ||
                  focused.notes ||
                  "Saved place awaiting research."}
              </div>
              <button
                type="button"
                className={selected.has(focused.id) ? "is-chosen" : ""}
                onClick={() => toggle(focused.id)}
              >
                {selected.has(focused.id) ? (
                  <>
                    <Check size={14} /> Chosen in this preview
                  </>
                ) : (
                  "Choose this place"
                )}
              </button>
            </aside>
          )}
        </main>

        <aside className="d5-side-column">
          <div className="d5-side-sticky">
            <div className="d5-map-frame">
              <DesignMap
                places={places}
                selected={selected}
                city={city}
                onCity={(nextCity) =>
                  CITIES.includes(nextCity) && selectCity(nextCity)
                }
                onPlace={(place) => setFocusedId(place.id)}
                className="d5-map"
              />
            </div>
            <section className="d5-chosen-tray">
              <div className="d5-tray-heading">
                <h2>Chosen in {city}</h2>
                <span>{chosen.length}</span>
              </div>
              {chosen.length ? (
                <div className="d5-chosen-list">
                  {chosen.map((place) => (
                    <button
                      type="button"
                      key={place.id}
                      onClick={() => setFocusedId(place.id)}
                    >
                      <span className="d5-tray-check">
                        <Check size={13} />
                      </span>
                      <span>
                        <strong>{place.name}</strong>
                        <small>
                          {place.area || place.category || "Saved place"}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="d5-tray-empty">
                  Choose places as you read. They stay local to this design
                  preview.
                </p>
              )}
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
