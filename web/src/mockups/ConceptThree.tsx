import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Check, ChevronDown, ChevronUp, MapPin, Search, X } from "lucide-react";
import { getTrip, previewTrip } from "../api";
import type { Place, TripSnapshot } from "../types";
import "maplibre-gl/dist/maplibre-gl.css";
import "./three.css";

const CITY_COORDS: Record<string, [number, number]> = {
  Tokyo: [139.6917, 35.6895], Yokohama: [139.638, 35.4437], Nagano: [138.181, 36.6513],
  Nagoya: [136.9066, 35.1815], Kyoto: [135.7681, 35.0116], Osaka: [135.5023, 34.6937],
  Hiroshima: [132.4553, 34.3853], Fukui: [136.2156, 36.0652], Hyogo: [134.853, 34.6913],
};

export default function ConceptThree() {
  const [data, setData] = useState<TripSnapshot>(() => previewTrip());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [city, setCity] = useState("Tokyo");
  const [detail, setDetail] = useState<Place | null>(null);
  const [query, setQuery] = useState("");
  const [trayOpen, setTrayOpen] = useState(true);
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    let active = true;
    getTrip().then((snapshot) => {
      if (!active) return;
      setData(snapshot);
      setSelected(new Set(snapshot.places.filter((place) => place.selected).map((place) => place.id)));
      const first = snapshot.places.find((place) => CITY_COORDS[place.city]);
      if (first && !snapshot.places.some((place) => place.city === "Tokyo")) setCity(first.city);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const cities = useMemo(() => Array.from(new Set(data.places.map((place) => place.city)))
    .filter((name) => CITY_COORDS[name])
    .map((name) => ({
      name,
      total: data.places.filter((place) => place.city === name).length,
      selected: data.places.filter((place) => place.city === name && selected.has(place.id)).length,
    }))
    .sort((a, b) => b.selected - a.selected || b.total - a.total), [data.places, selected]);

  const cityPlaces = useMemo(() => data.places.filter((place) => place.city === city &&
    `${place.name} ${place.area ?? ""} ${place.category ?? ""}`.toLowerCase().includes(query.toLowerCase())),
  [data.places, city, query]);

  useEffect(() => {
    if (!mapNode.current || cities.length === 0) return;
    const instance = new maplibregl.Map({
      container: mapNode.current,
      style: { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "osm", type: "raster", source: "osm" }] },
      center: [137.2, 35.25], zoom: 5.35, attributionControl: false,
    });
    map.current = instance;
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    const markers: maplibregl.Marker[] = [];
    let disposed = false;
    const onLoad = () => {
      if (disposed || !instance.isStyleLoaded()) return;
      instance.addSource("m3-halos", { type: "geojson", data: { type: "FeatureCollection", features: cities.map((item) => ({ type: "Feature", properties: { active: item.name === city || item.selected > 0 }, geometry: { type: "Point", coordinates: CITY_COORDS[item.name] } })) } });
      instance.addLayer({ id: "m3-halos", type: "circle", source: "m3-halos", paint: { "circle-radius": ["case", ["get", "active"], 34, 24], "circle-color": ["case", ["get", "active"], "#6d5bd020", "#1720330c"], "circle-stroke-color": ["case", ["get", "active"], "#6d5bd050", "#52606d32"], "circle-stroke-width": 1 } });
      cities.forEach((item) => {
        const element = document.createElement("button");
        element.className = `m3-map-badge ${item.name === city ? "is-focus" : ""} ${item.selected ? "is-active" : ""}`;
        element.innerHTML = `<strong>${item.name}</strong><span>${item.selected || item.total}</span>`;
        element.setAttribute("aria-label", `Focus ${item.name}, ${item.total} saved places`);
        element.onclick = () => focusCity(item.name);
        markers.push(new maplibregl.Marker({ element }).setLngLat(CITY_COORDS[item.name]).addTo(instance));
      });
    };
    instance.on("load", onLoad);
    return () => {
      disposed = true; instance.off("load", onLoad); markers.forEach((marker) => marker.remove());
      if (map.current === instance) map.current = null;
      instance.remove();
    };
  }, [cities, city]);

  const focusCity = (name: string) => {
    setCity(name); setTrayOpen(true); setDetail(null);
    map.current?.flyTo({ center: CITY_COORDS[name], zoom: 8.2, duration: 700 });
  };
  const toggle = (place: Place) => setSelected((current) => {
    const next = new Set(current); next.has(place.id) ? next.delete(place.id) : next.add(place.id); return next;
  });

  return <main className="m3-shell">
    <header className="m3-header">
      <a className="m3-brand" href="/">DETOUR</a><span className="m3-preview">DESIGN PREVIEW · 03</span>
      <nav aria-label="Design previews"><a href="/">App</a><a href="/1">1</a><a href="/2">2</a><a className="active" href="/3">3</a></nav>
    </header>
    <div className="m3-map" ref={mapNode} />
    <aside className="m3-cities">
      <div className="m3-panel-title"><span>Japan 2026</span><small>30 Sep — 25 Oct</small></div>
      <label className="m3-search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this city" /></label>
      <p className="m3-kicker">CITY NAVIGATOR</p>
      <div className="m3-city-list">{cities.map((item) => <button key={item.name} className={item.name === city ? "active" : ""} onClick={() => focusCity(item.name)}>
        <span><strong>{item.name}</strong><small>{item.total} saved</small></span><em>{item.selected || "·"}</em>
      </button>)}</div>
      <p className="m3-map-note"><MapPin size={13}/> Badges and halos use approximate city centres</p>
    </aside>
    <section className={`m3-tray ${trayOpen ? "open" : ""}`}>
      <button className="m3-tray-head" onClick={() => setTrayOpen((open) => !open)}>
        <span><strong>{city}</strong><small>{cityPlaces.length} saved places · {cityPlaces.filter((place) => selected.has(place.id)).length} selected</small></span>
        {trayOpen ? <ChevronDown size={18}/> : <ChevronUp size={18}/>}
      </button>
      {trayOpen && <div className="m3-place-list">{cityPlaces.map((place) => <button key={place.id} className={detail?.id === place.id ? "focused" : ""} onClick={() => setDetail(place)}>
        <span className={`m3-check ${selected.has(place.id) ? "checked" : ""}`} onClick={(event) => { event.stopPropagation(); toggle(place); }}>{selected.has(place.id) && <Check size={12}/>}</span>
        <span><strong>{place.name}</strong><small>{place.area || "Area unresolved"} · {place.category || "Place"}</small></span>
      </button>)}</div>}
    </section>
    {detail && <aside className="m3-detail">
      <button className="m3-close" onClick={() => setDetail(null)} aria-label="Close detail"><X size={17}/></button>
      <p className="m3-kicker">PLACE INSPECTOR</p><h1>{detail.name}</h1>
      <div className="m3-detail-meta"><span>{detail.city}</span><span>{detail.area || "Area unresolved"}</span><span>{detail.category || "Uncategorised"}</span></div>
      <p>{detail.description || detail.notes || "No description saved yet."}</p>
      <button className={`m3-select ${selected.has(detail.id) ? "selected" : ""}`} onClick={() => toggle(detail)}>{selected.has(detail.id) ? <><Check size={15}/> Selected for trip</> : "Select for trip"}</button>
      <small className="m3-local-note">Preview interaction only · changes are not saved</small>
    </aside>}
  </main>;
}
