import { useEffect, useState } from "react";

const defaults = ["Tokyo", "Kyoto", "Osaka"];

export function rememberCity(cities: string[], city: string) {
  return [...new Set([city, ...cities].filter(value => value && value !== "All"))].slice(0, 3);
}

export function readRecentCities(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (Array.isArray(parsed)) {
      const cities = parsed.filter((city): city is string => typeof city === "string" && !!city.trim() && city !== "All");
      if (cities.length) return [...new Set(cities)].slice(0, 3);
    }
  } catch { /* Fall back when stored preferences are invalid. */ }
  return defaults;
}

function loadCities(key: string) {
  try { return readRecentCities(localStorage.getItem(key)); }
  catch { return defaults; }
}

export function useRecentCities(tripId: string, city: string) {
  const key = `detour.recent-cities.v1:${tripId}`;
  const [saved, setSaved] = useState(() => ({key, cities: loadCities(key)}));
  const cities = rememberCity(saved.key === key ? saved.cities : loadCities(key), city);
  useEffect(() => {
    const next = rememberCity(saved.key === key ? saved.cities : loadCities(key), city);
    if (saved.key !== key || next.join("\n") !== saved.cities.join("\n")) setSaved({key, cities:next});
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* Browsing still works without storage. */ }
  }, [key, city, saved]);
  return cities;
}
