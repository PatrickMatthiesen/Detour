import type { Place } from "../types";

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function myMapsCsv(places: Place[], selectedOnly = false): string {
  const rows = places
    .filter(place => !selectedOnly || place.selected)
    .map(place => [
      place.name,
      [place.name, place.area, place.city].filter(Boolean).join(", "),
      place.googleMapsUrl?.trim() || "",
      place.notes || place.description || "",
    ]);
  return [["Name", "Address", "Maps URL", "Notes"], ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadMyMapsCsv(places: Place[], selectedOnly = false): void {
  const csv = `\uFEFF${myMapsCsv(places, selectedOnly)}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = selectedOnly ? "detour-selected-places.csv" : "detour-saved-places.csv";
  link.click();
  URL.revokeObjectURL(url);
}
