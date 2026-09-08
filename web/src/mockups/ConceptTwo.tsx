import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ArrowRight,
  BedDouble,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Compass,
  ExternalLink,
  MapPinned,
  Plus,
  Route,
  Search,
  Sparkles,
  TrainFront,
  X,
} from "lucide-react";
import { getTrip } from "../api";
import type { Activity, Place, TripSnapshot } from "../types";
import "./two.css";

const CITY_COORDINATES: Record<string, [number, number]> = {
  Tokyo: [139.6917, 35.6895],
  Nagoya: [136.9066, 35.1815],
  Kyoto: [135.7681, 35.0116],
  Osaka: [135.5023, 34.6937],
  Nagano: [138.181, 36.651],
  Yokohama: [139.638, 35.4437],
  Himeji: [134.6853, 34.8151],
};

type CitySummary = {
  name: string;
  places: Place[];
  selected: number;
  stay?: TripSnapshot["stays"][number];
};

const formatDay = (value: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(
    new Date(`${value}T12:00:00`),
  );

const formatTime = (value?: string | null) => {
  if (!value) return "Time flexible";
  return value.length > 5 ? value.slice(0, 5) : value;
};

const duration = (minutes?: number | null) => {
  if (!minutes) return "Duration unknown";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
};

const cityCoordinates = (city: string): [number, number] | null => CITY_COORDINATES[city] ?? null;

function MapPane({
  cities,
  places,
  selectedCity,
  focusedPlace,
  onCitySelect,
  onPlaceFocus,
}: {
  cities: CitySummary[];
  places: Place[];
  selectedCity: string;
  focusedPlace?: string;
  onCitySelect: (city: string) => void;
  onPlaceFocus: (id: string) => void;
}) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const cityFeatures = useMemo(
    () =>
      cities.flatMap((city) => {
        const coordinate = cityCoordinates(city.name);
        return coordinate
          ? [{ type: "Feature", geometry: { type: "Point", coordinates: coordinate }, properties: { name: city.name, selected: city.name === selectedCity, count: city.selected } }]
          : [];
      }),
    [cities, selectedCity],
  );

  const placeFeatures = useMemo(
    () =>
      places.flatMap((place) =>
        place.latitude != null && place.longitude != null
          ? [{ type: "Feature", geometry: { type: "Point", coordinates: [place.longitude, place.latitude] }, properties: { id: place.id, selected: place.selected } }]
          : [],
      ),
    [places],
  );

  useEffect(() => {
    if (!mapNode.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
            maxzoom: 19,
          },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#eef3f1" } },
          { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.72, "raster-saturation": -0.55, "raster-contrast": -0.08 } },
        ],
      },
      center: [137.4, 35.7],
      zoom: 5,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.on("load", () => {
      map.addSource("m2-cities", { type: "geojson", data: { type: "FeatureCollection", features: cityFeatures } as never });
      map.addLayer({ id: "m2-city-dot", type: "circle", source: "m2-cities", paint: { "circle-radius": ["case", ["get", "selected"], 9, 6], "circle-color": ["case", ["get", "selected"], "#0b7774", "#ffffff"], "circle-stroke-width": 2, "circle-stroke-color": ["case", ["get", "selected"], "#0b7774", "#98aaa7"] } });
      map.addLayer({ id: "m2-city-label", type: "symbol", source: "m2-cities", layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.35], "text-anchor": "top" }, paint: { "text-color": "#203330", "text-halo-color": "#eef3f1", "text-halo-width": 1.5 } });
      map.addSource("m2-places", { type: "geojson", data: { type: "FeatureCollection", features: placeFeatures } as never });
      map.addLayer({ id: "m2-place-dot", type: "circle", source: "m2-places", paint: { "circle-radius": ["case", ["get", "selected"], 6, 4], "circle-color": ["case", ["get", "selected"], "#e06d42", "#ffffff"], "circle-stroke-width": 1.5, "circle-stroke-color": ["case", ["get", "selected"], "#e06d42", "#75918c"] } });
      map.on("click", "m2-city-dot", (event) => {
        const name = event.features?.[0]?.properties?.name;
        if (name) onCitySelect(name);
      });
      map.on("click", "m2-place-dot", (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (id) onPlaceFocus(id);
      });
      map.on("mouseenter", "m2-city-dot", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "m2-city-dot", () => (map.getCanvas().style.cursor = ""));
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // The map is intentionally created once; data updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const citySource = map.getSource("m2-cities") as maplibregl.GeoJSONSource | undefined;
    const placeSource = map.getSource("m2-places") as maplibregl.GeoJSONSource | undefined;
    citySource?.setData({ type: "FeatureCollection", features: cityFeatures } as never);
    placeSource?.setData({ type: "FeatureCollection", features: placeFeatures } as never);
    const focus = cityCoordinates(selectedCity);
    if (focus) map.easeTo({ center: focus, duration: 450, zoom: Math.max(map.getZoom(), 5.3) });
  }, [cityFeatures, placeFeatures, selectedCity]);

  return (
    <section className="m2-map-panel" aria-label="Japan map">
      <div className="m2-map-heading">
        <div>
          <span className="m2-overline">GEOGRAPHIC CONTEXT</span>
          <h2>Japan route</h2>
        </div>
        <span className="m2-map-key"><i className="m2-key-selected" /> selected <i /> saved</span>
      </div>
      <div className="m2-map-canvas" ref={mapNode} />
      <div className="m2-map-note">
        <Compass size={14} strokeWidth={1.7} />
        <span>City markers are approximate. Exact place pins appear only when coordinates are in your saved data.</span>
      </div>
      {focusedPlace && <div className="m2-map-focus"><MapPinned size={14} /> Focused on saved place</div>}
    </section>
  );
}

export default function ConceptTwo() {
  const [snapshot, setSnapshot] = useState<TripSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [query, setQuery] = useState("");
  const [localActivities, setLocalActivities] = useState<Activity[]>([]);
  const [removedActivities, setRemovedActivities] = useState<Set<string>>(new Set());
  const [focusedPlace, setFocusedPlace] = useState<string>();

  useEffect(() => {
    getTrip()
      .then((data) => {
        setSnapshot(data);
        const firstCity = data.stays[0]?.city || data.places[0]?.city || "";
        setSelectedCity(firstCity);
        const firstCityStay = data.stays.find((stay) => stay.city === "Tokyo") || data.stays[0];
        setSelectedDate(firstCityStay?.checkIn || data.trip.startDate);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Trip data could not be loaded."));
  }, []);

  const dates = useMemo(() => {
    if (!snapshot) return [];
    const result: string[] = [];
    const cursor = new Date(`${snapshot.trip.startDate}T12:00:00`);
    const end = new Date(`${snapshot.trip.endDate}T12:00:00`);
    while (cursor <= end) {
      result.push(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() + 1);
    }
    return result;
  }, [snapshot]);

  const cities = useMemo<CitySummary[]>(() => {
    if (!snapshot) return [];
    const names = [...new Set([...snapshot.stays.map((stay) => stay.city), ...snapshot.places.map((place) => place.city)])];
    return names.map((name) => {
      const places = snapshot.places.filter((place) => place.city === name);
      return { name, places, selected: places.filter((place) => place.selected).length, stay: snapshot.stays.find((stay) => stay.city === name) };
    });
  }, [snapshot]);

  const activeActivities = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.activities, ...localActivities].filter((activity) => !removedActivities.has(activity.id));
  }, [localActivities, removedActivities, snapshot]);

  const dayActivities = activeActivities.filter((activity) => activity.date === selectedDate);
  const scheduledIds = new Set(activeActivities.map((activity) => activity.placeId).filter(Boolean));
  const city = cities.find((item) => item.name === selectedCity);
  const unscheduled = city?.places.filter((place) => !scheduledIds.has(place.id) && `${place.name} ${place.area || ""} ${place.category || ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 8) || [];
  const selectedPlaces = snapshot?.places.filter((place) => place.selected) || [];
  const selectedCityIndex = Math.max(0, cities.findIndex((item) => item.name === selectedCity));

  const addActivity = (place: Place) => {
    const id = `m2-local-${place.id}-${selectedDate}`;
    if (activeActivities.some((activity) => activity.date === selectedDate && activity.placeId === place.id)) return;
    setLocalActivities((current) => [...current, { id, placeId: place.id, date: selectedDate, durationMinutes: place.durationMinutes, status: "planned" }]);
  };

  const removeActivity = (activity: Activity) => {
    if (activity.id.startsWith("m2-local-")) setLocalActivities((current) => current.filter((item) => item.id !== activity.id));
    else setRemovedActivities((current) => new Set(current).add(activity.id));
  };

  if (!snapshot) {
    return <main className="m2-shell"><div className="m2-loading">{error ? <><strong>Trip data unavailable</strong><span>{error}</span></> : <><div className="m2-loader" /><span>Loading your Japan trip…</span></>}</div></main>;
  }

  return (
    <main className="m2-shell">
      <header className="m2-header">
        <a className="m2-wordmark" href="/">TRIP / JAPAN 26</a>
        <nav className="m2-concepts" aria-label="Concept navigation">
          <a href="/1">01 Library</a><a className="m2-current" href="/2">02 Day plan</a><a href="/3">03 Map canvas</a>
        </nav>
        <div className="m2-header-state"><span className="m2-live-dot" /> Design preview · changes stay here</div>
      </header>

      <div className="m2-layout">
        <aside className="m2-city-rail">
          <div className="m2-rail-heading"><span className="m2-overline">CITIES & STAYS</span><strong>{cities.length} cities</strong></div>
          <div className="m2-city-list">
            {cities.map((item, index) => (
              <button key={item.name} className={`m2-city-row ${item.name === selectedCity ? "m2-active" : ""}`} onClick={() => setSelectedCity(item.name)}>
                <span className="m2-city-index">0{index + 1}</span>
                <span className="m2-city-copy"><b>{item.name}</b><small>{item.places.length} saved · {item.selected} selected</small>{item.stay && <small className="m2-stay"><BedDouble size={11} /> {item.stay.checkIn} → {item.stay.checkOut}</small>}</span>
                {item.name === selectedCity && <span className="m2-city-active" aria-label="active city" />}
              </button>
            ))}
          </div>
          <div className="m2-rail-footer">
            <Route size={15} />
            <span><b>{selectedPlaces.length}</b> places selected across Japan</span>
          </div>
        </aside>

        <section className="m2-planner" aria-label="Day planner">
          <div className="m2-planner-top">
            <div><span className="m2-overline">{city?.name || "CITY"} · DAY PLAN</span><h1>{city?.name || "Trip"} · {formatDay(selectedDate)}</h1><p>Shape this day from your saved places. Changes are temporary and reset when you reload.</p></div>
            <div className="m2-local-badge"><Sparkles size={14} /> local experiment</div>
          </div>
          <div className="m2-day-picker">
            <button className="m2-round-button" aria-label="Previous day" onClick={() => setSelectedDate(dates[Math.max(0, dates.indexOf(selectedDate) - 1)])}><ChevronLeft size={15} /></button>
            <div className="m2-date-strip">
              {dates.map((date) => <button key={date} className={date === selectedDate ? "m2-selected" : ""} onClick={() => setSelectedDate(date)}><small>{formatDay(date).split(" ")[0]}</small><b>{formatDay(date).split(" ")[1]}</b><span>{formatDay(date).split(" ").slice(2).join(" ")}</span></button>)}
            </div>
            <button className="m2-round-button" aria-label="Next day" onClick={() => setSelectedDate(dates[Math.min(dates.length - 1, dates.indexOf(selectedDate) + 1)])}><ChevronRight size={15} /></button>
          </div>

          <div className="m2-schedule-head"><div><span className="m2-overline">{formatDay(selectedDate)} · {city?.name}</span><h2>Today’s shape</h2></div><span className="m2-time-total"><Clock3 size={14} /> {dayActivities.reduce((sum, activity) => sum + (activity.durationMinutes || 0), 0) ? `${duration(dayActivities.reduce((sum, activity) => sum + (activity.durationMinutes || 0), 0))} planned` : "Wide open"}</span></div>
          <div className="m2-schedule">
            <div className="m2-time-column"><span>09:00</span><span>12:00</span><span>15:00</span><span>18:00</span></div>
            <div className="m2-timeline-column">
              {dayActivities.length ? dayActivities.map((activity) => {
                const place = snapshot.places.find((item) => item.id === activity.placeId);
                return <article className="m2-activity" key={activity.id}><div className="m2-activity-mark"><CircleDot size={15} /></div><div><strong>{place?.name || activity.title || "Untitled activity"}</strong><span>{formatTime(activity.startTime)} · {duration(activity.durationMinutes || place?.durationMinutes)}</span></div><button aria-label={`Remove ${place?.name || "activity"}`} onClick={() => removeActivity(activity)}><X size={14} /></button></article>;
              }) : <div className="m2-open-day"><span className="m2-open-line" /><strong>Nothing scheduled yet</strong><span>Pick from your saved places below.</span></div>}
              <div className="m2-free-time"><span /><div><b>{dayActivities.length ? "Open time remains" : "A clean slate"}</b><small>{dayActivities.length ? "Keep a buffer for queues, meals and the unexpected." : "A flexible day can be the right decision."}</small></div></div>
            </div>
          </div>

          <div className="m2-unscheduled-head"><div><span className="m2-overline">SAVED IN {city?.name?.toUpperCase()}</span><h2>What could fit nearby?</h2></div><span className="m2-count">{city?.places.length || 0} places</span></div>
          <div className="m2-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter this city's saved places" aria-label="Filter saved places" />{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={13} /></button>}</div>
          <div className="m2-saved-list">
            {unscheduled.length ? unscheduled.map((place) => <article className={`m2-saved-row ${focusedPlace === place.id ? "m2-focused" : ""}`} key={place.id} onMouseEnter={() => setFocusedPlace(place.id)} onMouseLeave={() => setFocusedPlace(undefined)}><button className="m2-add-place" onClick={() => addActivity(place)} aria-label={`Add ${place.name} to ${formatDay(selectedDate)}`}><Plus size={16} /></button><div className="m2-saved-copy"><strong>{place.name}</strong><span>{place.area || "Area unknown"} <i>·</i> {place.category || "Uncategorised"}</span></div><div className="m2-saved-meta"><span><Clock3 size={12} /> {duration(place.durationMinutes)}</span>{place.priority === "required" && <b>required</b>}{place.googleMapsUrl && <a href={place.googleMapsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${place.name} in Google Maps`}><ExternalLink size={13} /></a>}</div></article>) : <div className="m2-empty-saved"><Search size={16} /><span>No unallocated saved places match this view.</span></div>}
          </div>
        </section>

        <aside className="m2-map-wrap"><MapPane cities={cities} places={snapshot.places} selectedCity={selectedCity} focusedPlace={focusedPlace} onCitySelect={setSelectedCity} onPlaceFocus={setFocusedPlace} /><div className="m2-route-note"><TrainFront size={15} /><div><b>{selectedCityIndex < cities.length - 1 ? `${selectedCity} is your active lens` : "End of the current route"}</b><span>Travel legs remain visible in the full itinerary view.</span></div><ArrowRight size={14} /></div></aside>
      </div>
      <footer className="m2-footer"><CalendarDays size={14} /><span>{formatDay(snapshot.trip.startDate)} → {formatDay(snapshot.trip.endDate)}</span><span className="m2-footer-sep" /> <span>{snapshot.trip.timeZone || "Trip timezone not set"}</span><a href="/1">Back to place library <ArrowRight size={13} /></a></footer>
    </main>
  );
}
