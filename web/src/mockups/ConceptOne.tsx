import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Compass,
  ExternalLink,
  MapPin,
  Search,
  X,
} from "lucide-react";
import { getTrip } from "../api";
import type { Place, TripSnapshot } from "../types";
import "maplibre-gl/dist/maplibre-gl.css";
import "./ConceptOne.css";

type CityPoint = { longitude: number; latitude: number };

// These are deliberately city-center reference points. Places remain unmapped
// until their source provides coordinates; no location is invented here.
const CITY_POINTS: Record<string, CityPoint> = {
  Tokyo: { longitude: 139.6917, latitude: 35.6895 },
  Yokohama: { longitude: 139.638, latitude: 35.4437 },
  Hakone: { longitude: 139.0256, latitude: 35.2324 },
  Nagoya: { longitude: 136.9066, latitude: 35.1815 },
  Kyoto: { longitude: 135.7681, latitude: 35.0116 },
  Osaka: { longitude: 135.5023, latitude: 34.6937 },
  "Kinosaki Onsen": { longitude: 134.812, latitude: 35.624 },
  Kurashiki: { longitude: 133.7719, latitude: 34.585 },
  Onomichi: { longitude: 133.205, latitude: 34.408 },
  Hiroshima: { longitude: 132.4553, latitude: 34.3853 },
  Nikkō: { longitude: 139.6982, latitude: 36.7199 },
  Nagano: { longitude: 138.181, latitude: 36.6485 },
  Fukui: { longitude: 136.2216, latitude: 36.0641 },
  Gifu: { longitude: 136.7607, latitude: 35.4233 },
  Fukushima: { longitude: 140.4676, latitude: 37.7608 },
  Miyazaki: { longitude: 131.4239, latitude: 31.9111 },
  Wakayama: { longitude: 135.1675, latitude: 34.2305 },
};

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    openstreetmap: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "openstreetmap",
      type: "raster",
      source: "openstreetmap",
    },
  ],
};

const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));

function placeCityGroups(
  places: Place[],
  activeCity: string | null,
  query: string,
  selectedIds: Set<string>,
  plannedCities: Set<string>,
) {
  const normalized = query.trim().toLocaleLowerCase();
  const grouped = new Map<string, Place[]>();
  for (const place of places) {
    if (activeCity && place.city !== activeCity) continue;
    if (
      normalized &&
      ![place.name, place.city, place.area, place.category]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(normalized))
    )
      continue;
    const city = place.city || "Unsorted";
    grouped.set(city, [...(grouped.get(city) ?? []), place]);
  }
  return [...grouped.entries()].sort(([a, aPlaces], [b, bPlaces]) => {
    const rank = (city: string, cityPlaces: Place[]) =>
      city === activeCity
        ? 0
        : city === "Tokyo"
          ? 1
          : cityPlaces.some((place) => selectedIds.has(place.id))
            ? 2
            : plannedCities.has(city)
              ? 3
              : 4;
    return rank(a, aPlaces) - rank(b, bPlaces) || a.localeCompare(b);
  });
}

export default function ConceptOne() {
  const [snapshot, setSnapshot] = useState<TripSnapshot | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [activeCity, setActiveCity] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReady = useRef(false);
  const markerRefs = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    let cancelled = false;
    getTrip()
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
        setSelectedIds(
          new Set(
            data.places
              .filter((place) => place.selected)
              .map((place) => place.id),
          ),
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Trip data could not be loaded.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: OSM_STYLE,
      center: [137.6, 35.7],
      zoom: 5.1,
      attributionControl: false,
    });
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );
    map.on("load", () => {
      mapReady.current = true;
      setMapLoaded(true);
      map.resize();
    });
    mapRef.current = map;
    return () => {
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      map.remove();
      mapRef.current = null;
      mapReady.current = false;
      setMapLoaded(false);
    };
  }, []);

  const cityGroups = useMemo(
    () =>
      snapshot
        ? placeCityGroups(
            snapshot.places,
            activeCity,
            query,
            selectedIds,
            new Set(snapshot.stays.map((stay) => stay.city)),
          )
        : [],
    [activeCity, query, selectedIds, snapshot],
  );
  const focusedPlace = snapshot?.places.find(
    (place) => place.id === focusedPlaceId,
  );
  const selectedCount = selectedIds.size;
  const mappedCities = useMemo(() => {
    if (!snapshot) return [];
    const cities = new Set(snapshot.places.map((place) => place.city));
    snapshot.stays.forEach((stay) => cities.add(stay.city));
    return [...cities].filter((city) => CITY_POINTS[city]);
  }, [snapshot]);
  const routeCities = useMemo(() => {
    if (!snapshot) return [];
    const route: string[] = [];
    for (const stay of snapshot.stays) {
      if (CITY_POINTS[stay.city] && route.at(-1) !== stay.city)
        route.push(stay.city);
    }
    return route;
  }, [snapshot]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady.current || !mapLoaded || !snapshot) return;
    markerRefs.current.forEach((marker) => marker.remove());
    markerRefs.current = [];
    const cities = mappedCities.map((city) => {
      const places = snapshot.places.filter((place) => place.city === city);
      const chosen = places.filter((place) => selectedIds.has(place.id)).length;
      const element = document.createElement("button");
      element.type = "button";
      element.className = `m1-city-bubble${activeCity === city ? " is-active" : ""}`;
      const title = document.createElement("strong");
      title.textContent = city;
      const count = document.createElement("span");
      count.textContent = `${chosen} / ${places.length} selected`;
      const note = document.createElement("em");
      note.textContent = "approx. city center";
      element.append(title, count, note);
      element.addEventListener("click", () => {
        setActiveCity(city);
        setFocusedPlaceId(places[0]?.id ?? null);
      });
      const marker = new maplibregl.Marker({ element, anchor: "bottom" })
        .setLngLat([CITY_POINTS[city].longitude, CITY_POINTS[city].latitude])
        .addTo(map);
      markerRefs.current.push(marker);
      return marker;
    });
    void cities;

    for (const place of snapshot.places) {
      if (place.latitude == null || place.longitude == null) continue;
      const element = document.createElement("button");
      element.type = "button";
      element.className = `m1-place-pin${selectedIds.has(place.id) ? " is-selected" : ""}`;
      element.title = `${place.name} · source coordinates`;
      element.addEventListener("click", () => setFocusedPlaceId(place.id));
      markerRefs.current.push(
        new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat([place.longitude, place.latitude])
          .addTo(map),
      );
    }

    const coordinates = routeCities.map((city) => [
      CITY_POINTS[city].longitude,
      CITY_POINTS[city].latitude,
    ]);
    if (coordinates.length > 1) {
      if (map.getSource("m1-route")) map.removeLayer("m1-route-line");
      if (map.getSource("m1-route")) map.removeSource("m1-route");
      map.addSource("m1-route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates },
        },
      });
      map.addLayer({
        id: "m1-route-line",
        type: "line",
        source: "m1-route",
        paint: {
          "line-color": "#1f5b66",
          "line-width": 3,
          "line-opacity": 0.72,
          "line-dasharray": [1.4, 1.2],
        },
      });
    }
  }, [activeCity, mapLoaded, mappedCities, routeCities, selectedIds, snapshot]);

  const toggleSelected = (place: Place) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(place.id)) next.delete(place.id);
      else next.add(place.id);
      return next;
    });
  };

  return (
    <div className="m1-shell">
      <header className="m1-header">
        <a className="m1-brand" href="/">
          <span className="m1-brand-mark">
            <Compass size={16} />
          </span>
          <span>
            <b>DETOUR</b>
            <small>Design preview</small>
          </span>
        </a>
        <nav className="m1-nav" aria-label="Mockup concepts">
          <a href="/">Main app</a>
          <a className="is-current" href="/1">
            01
          </a>
          <a href="/2">02</a>
          <a href="/3">03</a>
        </nav>
        <div className="m1-header-meta">
          <span className="m1-preview-badge">Changes stay here</span>
          <span className="m1-trip-label">
            {snapshot?.trip.name ?? "Japan 2026"}
          </span>
        </div>
      </header>

      <div className="m1-workspace">
        <aside className="m1-rail">
          <div className="m1-rail-heading">
            <div>
              <span className="m1-kicker">PLACE LIBRARY</span>
              <h1>Ideas in reach</h1>
            </div>
            <span className="m1-count">{snapshot?.places.length ?? "—"}</span>
          </div>
          <p className="m1-rail-copy">
            Choose a few anchors. Everything nearby becomes easier to see.
          </p>
          <label className="m1-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search places, areas, cities"
            />
            <kbd>/</kbd>
          </label>
          <div className="m1-filter-line">
            <span>
              {activeCity ? `Showing ${activeCity}` : "All saved places"}
            </span>
            {activeCity && (
              <button type="button" onClick={() => setActiveCity(null)}>
                Clear city <X size={13} />
              </button>
            )}
          </div>
          {error ? (
            <div className="m1-error">
              <CircleAlert size={17} />
              <span>
                Could not load the trip data.<small>{error}</small>
              </span>
            </div>
          ) : !snapshot ? (
            <div className="m1-loading">Loading Japan 2026…</div>
          ) : cityGroups.length === 0 ? (
            <div className="m1-empty">No saved places match this search.</div>
          ) : (
            <div className="m1-city-groups">
              {cityGroups.map(([city, places]) => {
                const chosen = places.filter((place) =>
                  selectedIds.has(place.id),
                ).length;
                return (
                  <section
                    className={`m1-city-group${activeCity === city ? " is-active" : ""}`}
                    key={city}
                  >
                    <button
                      className="m1-city-heading"
                      type="button"
                      onClick={() =>
                        setActiveCity(activeCity === city ? null : city)
                      }
                    >
                      <span>
                        <MapPin size={14} />
                        <b>{city}</b>
                      </span>
                      <em>
                        {chosen}/{places.length}
                      </em>
                      <ChevronDown size={14} />
                    </button>
                    <div className="m1-place-list">
                      {places.map((place) => {
                        const selected = selectedIds.has(place.id);
                        return (
                          <div
                            className={`m1-place-row${selected ? " is-selected" : ""}${focusedPlaceId === place.id ? " is-focused" : ""}`}
                            key={place.id}
                          >
                            <button
                              className="m1-place-main"
                              type="button"
                              onClick={() => setFocusedPlaceId(place.id)}
                            >
                              <span className="m1-place-state">
                                {selected && (
                                  <Check size={13} strokeWidth={3} />
                                )}
                              </span>
                              <span className="m1-place-copy">
                                <b>{place.name}</b>
                                <small>
                                  {place.area || place.category || "Saved idea"}
                                </small>
                              </span>
                            </button>
                            <button
                              className="m1-choose-button"
                              type="button"
                              onClick={() => toggleSelected(place)}
                              aria-label={`${selected ? "Unchoose" : "Choose"} ${place.name}`}
                            >
                              {selected ? "Chosen" : "Choose"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </aside>

        <section className="m1-map-panel" aria-label="Japan planning map">
          <div ref={mapNode} className="m1-map" />
          <div className="m1-map-topline">
            <strong>{snapshot?.trip.name || "Japan 2026"} · ideas map</strong>
            <span className="m1-map-note">
              <i className="m1-dot m1-dot-selected" />
              chosen <i className="m1-dot" /> saved
              <span>· city centers approximate</span>
            </span>
          </div>
          {focusedPlace && (
            <aside className="m1-place-popover">
              <button
                className="m1-popover-close"
                type="button"
                onClick={() => setFocusedPlaceId(null)}
                aria-label="Close place details"
              >
                <X size={16} />
              </button>
              <span className="m1-kicker">
                {focusedPlace.city}
                {focusedPlace.area ? ` / ${focusedPlace.area}` : ""}
              </span>
              <h2>{focusedPlace.name}</h2>
              <p>
                {focusedPlace.description ||
                  focusedPlace.notes ||
                  "Saved place awaiting research."}
              </p>
              <div className="m1-popover-meta">
                <span>{focusedPlace.category || "Place"}</span>
                <span>
                  {focusedPlace.durationMinutes
                    ? `${focusedPlace.durationMinutes} min`
                    : focusedPlace.durationText || "Time unknown"}
                </span>
              </div>
              <div className="m1-popover-actions">
                <button
                  type="button"
                  className={
                    selectedIds.has(focusedPlace.id) ? "is-chosen" : ""
                  }
                  onClick={() => toggleSelected(focusedPlace)}
                >
                  {selectedIds.has(focusedPlace.id) ? (
                    <>
                      <Check size={14} /> Chosen in this preview
                    </>
                  ) : (
                    <>
                      Choose this place <ArrowUpRight size={14} />
                    </>
                  )}
                </button>
                {focusedPlace.sourceUrl && (
                  <a
                    href={focusedPlace.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </aside>
          )}
          {!snapshot && !error && (
            <div className="m1-map-loading">Loading map layers…</div>
          )}
          {error && (
            <div className="m1-map-error">
              Map unavailable until trip data loads.
            </div>
          )}
        </section>
      </div>

      <footer className="m1-route-strip">
        <div className="m1-route-title">
          <span className="m1-kicker">CURRENT ROUTE</span>
          <strong>
            {routeCities.length
              ? `${routeCities.length} planning stops`
              : "No city route yet"}
          </strong>
          <small>Planning line only · city centers approximate</small>
        </div>
        <div className="m1-route-stops">
          {routeCities.length ? (
            routeCities.map((city, index) => (
              <div className="m1-route-stop" key={`${city}-${index}`}>
                <span className="m1-route-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <b>{city}</b>
                  <small>
                    {snapshot?.stays.find((stay) => stay.city === city)?.checkIn
                      ? dateLabel(
                          snapshot.stays.find((stay) => stay.city === city)!
                            .checkIn,
                        )
                      : "Flexible"}
                  </small>
                </span>
                {index < routeCities.length - 1 && (
                  <span className="m1-route-arrow">→</span>
                )}
              </div>
            ))
          ) : (
            <span className="m1-route-empty">
              Add a planning stay to draw the route.
            </span>
          )}
        </div>
        <div className="m1-route-stats">
          <b>{selectedCount}</b>
          <span>
            chosen
            <br />
            in preview
          </span>
        </div>
      </footer>
    </div>
  );
}
