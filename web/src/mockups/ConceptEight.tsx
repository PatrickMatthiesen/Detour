import { useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Search,
  X,
} from "lucide-react";
import type { Place } from "../types";
import {
  DesignMap,
  PlacePhoto,
  PreviewNav,
  cityPlaces,
  useDesignTrip,
} from "./design-kit";
import "./eight.css";

export default function ConceptEight() {
  const { trip, selected, toggle, loading, error } = useDesignTrip();
  const [city, setCity] = useState("Tokyo");
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [detail, setDetail] = useState<Place | null>(null);
  const cities = useMemo(
    () =>
      trip
        ? Array.from(new Set(trip.places.map((place) => place.city))).sort()
        : [],
    [trip],
  );
  const allCityPlaces = trip ? cityPlaces(trip, city) : [];
  const categories = [
    "All",
    ...Array.from(
      new Set(
        allCityPlaces.flatMap((place) =>
          (place.category || "Other").split(",").map((part) => part.trim()),
        ),
      ),
    ).slice(0, 6),
  ];
  const visible = allCityPlaces.filter(
    (place) =>
      (category === "All" || place.category?.includes(category)) &&
      `${place.name} ${place.description ?? ""} ${place.area ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );

  return (
    <main className={`new-preview d8-page ${collapsed ? "d8-collapsed" : ""}`}>
      <PreviewNav active={8} />
      <DesignMap
        places={trip?.places ?? []}
        selected={selected}
        city={city}
        onCity={setCity}
        onPlace={setDetail}
        className="d8-map"
        route
      />
      <aside className="d8-discovery" aria-label="Place discovery">
        {collapsed ? (
          <button
            className="d8-reopen"
            onClick={() => setCollapsed(false)}
            aria-label="Open discovery panel"
          >
            <ChevronRight />
            <span>{city}</span>
          </button>
        ) : (
          <>
            <header className="d8-head">
              <div>
                <span>Japan 2026</span>
                <h1>{city}</h1>
                <p>{allCityPlaces.length} saved places</p>
              </div>
              <button
                onClick={() => setCollapsed(true)}
                aria-label="Collapse discovery panel"
              >
                <ChevronLeft />
              </button>
            </header>
            <div className="d8-city-switcher" aria-label="Choose city">
              <select
                value={city}
                onChange={(event) => {
                  setCity(event.target.value);
                  setDetail(null);
                }}
                aria-label="All cities"
              >
                {cities.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
              {["Tokyo", "Kyoto", "Osaka"]
                .filter((name) => cities.includes(name))
                .map((name) => (
                  <button
                    className={name === city ? "active" : ""}
                    onClick={() => {
                      setCity(name);
                      setDetail(null);
                    }}
                    key={name}
                  >
                    {name}
                  </button>
                ))}
            </div>
            <div className="d8-categories">
              {categories.map((name) => (
                <button
                  className={name === category ? "active" : ""}
                  onClick={() => setCategory(name)}
                  key={name}
                >
                  {name}
                </button>
              ))}
              <button
                className={`d8-search-toggle ${searchOpen ? "active" : ""}`}
                onClick={() => setSearchOpen((open) => !open)}
              >
                <Search /> Search
              </button>
            </div>
            {searchOpen && (
              <label className="d8-search">
                <Search />
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={`Search ${city}`}
                />
              </label>
            )}
            <div className="d8-results">
              {loading && <p className="d8-message">Loading saved places…</p>}
              {error && (
                <p className="d8-message">Saved places could not be loaded.</p>
              )}
              {visible.map((place) => (
                <article
                  className={detail?.id === place.id ? "focused" : ""}
                  key={place.id}
                  onClick={() => setDetail(place)}
                >
                  <PlacePhoto place={place} className="d8-photo" />
                  <div className="d8-card-copy">
                    <h2>{place.name}</h2>
                    <p>
                      {place.description ||
                        place.notes ||
                        "Saved for later research."}
                    </p>
                    <span>
                      <MapPin /> {place.area || city}
                    </span>
                  </div>
                  <button
                    className={`d8-check ${selected.has(place.id) ? "selected" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(place.id);
                    }}
                    aria-label={`${selected.has(place.id) ? "Remove" : "Select"} ${place.name}`}
                  >
                    {selected.has(place.id) && <Check />}
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
      </aside>
      {detail && (
        <aside className="d8-inspector">
          <button
            className="d8-close"
            onClick={() => setDetail(null)}
            aria-label="Close place details"
          >
            <X />
          </button>
          <PlacePhoto place={detail} className="d8-inspector-photo" />
          <div>
            <h2>{detail.name}</h2>
            <p className="d8-location">
              {detail.area || detail.city} · {detail.category || "Saved place"}
            </p>
            <p>
              {detail.description ||
                detail.notes ||
                "No description has been saved yet."}
            </p>
            <button
              className={`d8-primary ${selected.has(detail.id) ? "selected" : ""}`}
              onClick={() => toggle(detail.id)}
            >
              {selected.has(detail.id) ? (
                <>
                  <Check /> Selected for trip
                </>
              ) : (
                "Select for trip"
              )}
            </button>
          </div>
        </aside>
      )}
    </main>
  );
}
