import { describe, expect, it } from "vitest";
import { myMapsCsv } from "./my-maps-export";
import type { Place } from "../types";

const places: Place[] = [
  { id: "1", name: 'Cafe "A"', city: "Kyoto", area: "Gion", notes: "Tea, then walk", googleMapsUrl: "https://maps.google.com/?q=cafe", selected: true, latitude: 35, longitude: 135, coordinatesFromGoogle: true },
  { id: "2", name: "Park", city: "Osaka", selected: false },
];

describe("My Maps CSV export", () => {
  it("exports names, Maps links or city queries, and notes without coordinates", () => {
    expect(myMapsCsv(places)).toBe([
      '"Name","Address","Maps URL","Notes"',
      '"Cafe ""A""","Cafe ""A"", Gion, Kyoto","https://maps.google.com/?q=cafe","Tea, then walk"',
      '"Park","Park, Osaka","",""',
    ].join("\r\n"));
    expect(myMapsCsv(places)).not.toContain("35");
    expect(myMapsCsv(places)).not.toContain("135");
  });

  it("can export only saved places the user marked selected", () => {
    expect(myMapsCsv(places, true).split("\r\n")).toHaveLength(2);
    expect(myMapsCsv(places, true)).toContain('"Cafe ""A"""');
    expect(myMapsCsv(places, true)).not.toContain("Park");
  });
});
