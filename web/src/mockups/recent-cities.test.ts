import {describe, expect, it} from "vitest";
import {readRecentCities, rememberCity} from "./recent-cities";

describe("recent city tabs", () => {
  it("promotes a selected city without duplicates and keeps three cities", () => {
    const cities = rememberCity(["Tokyo", "Kyoto", "Osaka"], "Fukui");
    expect(cities).toEqual(["Fukui", "Tokyo", "Kyoto"]);
    expect(rememberCity(cities, "Tokyo")).toEqual(["Tokyo", "Fukui", "Kyoto"]);
  });

  it("keeps recency when viewing All and restores it from storage", () => {
    const cities = ["Nagoya", "Fukui", "Osaka"];
    expect(rememberCity(cities, "All")).toEqual(cities);
    expect(readRecentCities(JSON.stringify(cities))).toEqual(cities);
  });

  it("recovers from malformed stored preferences", () => {
    expect(readRecentCities("invalid")).toEqual(["Tokyo", "Kyoto", "Osaka"]);
    expect(readRecentCities('[null,42,"All","Nagoya","Nagoya","Fukui"]')).toEqual(["Nagoya", "Fukui"]);
  });
});
