export type PlacesSearch = {
  city?: string;
  category?: string;
  chosen?: boolean;
  q?: string;
  place?: string;
};

export function validatePlacesSearch(search: Record<string, unknown>): PlacesSearch {
  return {
    place: typeof search.place === "string" ? search.place || undefined : undefined,
    city: typeof search.city === "string" && search.city ? search.city : undefined,
    category: typeof search.category === "string" && search.category !== "All" ? search.category || undefined : undefined,
    chosen: search.chosen === true || search.chosen === "true" ? true : undefined,
    q: typeof search.q === "string" ? search.q || undefined : undefined,
  };
}
