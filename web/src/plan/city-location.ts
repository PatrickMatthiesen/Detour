import cityCenters from '../../../shared/city-centers.json';
import type { Place } from '../types';

export const centers: Record<string, [number, number]> = Object.fromEntries(
  Object.entries(cityCenters).map(([city, [longitude, latitude]]) => [city, [longitude, latitude] as [number, number]]),
);
const combinedCity = /[/\\;]|\s[&+]\s|\b(?:and|or)\b/i;

/** Approximate city anchor, never a substitute for a place's coordinates. */
export function cityMapCenter(city: string, places: Place[]): [number, number] | undefined {
  city = city.trim();
  if (combinedCity.test(city) || ['other', 'unknown city', ''].includes(city.toLowerCase())) return undefined;
  if (Object.hasOwn(centers, city)) return centers[city];
  const place = places.find(p => p.city === city && p.longitude != null && p.latitude != null
    && Number.isFinite(p.longitude) && Number.isFinite(p.latitude)
    && Math.abs(p.longitude) <= 180 && Math.abs(p.latitude) <= 90);
  return place ? [place.longitude!, place.latitude!] : undefined;
}

export function stayCityError(city: string, places: Place[]): string | undefined {
  if (combinedCity.test(city)) return `Use one city or city area for "${city}". Put other destinations in the label or notes.`;
  if (!cityMapCenter(city, places)) return `Cannot locate "${city}" on the map. Choose a suggested city or add a place with coordinates in that city first.`;
}

export function unresolvedRouteCities(stops: ReadonlyArray<{ city: string }>, places: Place[]): string[] {
  return [...new Set(stops.map(stop => stop.city))].filter(city => !cityMapCenter(city, places));
}
