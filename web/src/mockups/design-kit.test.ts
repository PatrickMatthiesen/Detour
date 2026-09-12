import { describe, expect, it } from "vitest";
import maplibregl from "maplibre-gl";
import { cityAreaPerimeter, cityRouteFeatures } from "./design-kit";
import type { Place } from "../types";

type Coordinate = readonly number[];

function insidePolygon(point: Coordinate, polygon: Array<[number, number]>) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = polygon[i];
    const [previousX, previousY] = polygon[j];
    const intersects =
      y > point[1] !== previousY > point[1] &&
      point[0] <
        ((previousX - x) * (point[1] - y)) / (previousY - y) + x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegment(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
) {
  const [dx, dy] = [end[0] - start[0], end[1] - start[1]];
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared
    ? Math.max(
        0,
        Math.min(
          1,
          ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
            lengthSquared,
        ),
      )
    : 0;
  return Math.hypot(
    point[0] - (start[0] + projection * dx),
    point[1] - (start[1] + projection * dy),
  );
}

function isOnPolygonEdge(
  point: Coordinate,
  polygon: Array<[number, number]>,
  tolerance = 1e-10,
) {
  const project = (coordinate: Coordinate): [number, number] => {
    const projected = maplibregl.MercatorCoordinate.fromLngLat([
      coordinate[0],
      coordinate[1],
    ]);
    return [projected.x, projected.y];
  };
  const projectedPoint = project(point);
  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    return distanceToSegment(projectedPoint, project(start), project(end)) <= tolerance;
  });
}

function place(
  id: string,
  city: string,
  longitude: number,
  latitude: number,
): Place {
  return { id, name: id, city, longitude, latitude };
}

describe("design map city areas", () => {
  it("expands the Nagoya area to contain skewed and farthest resolved places", () => {
    const resolvedPlaces: Array<[number, number]> = [
      [137.095, 35.185], // Ghibli Park, east of the city center.
      [136.84, 35.25],
      [137.14, 35.36], // Farthest point in this group.
    ];
    const perimeter = cityAreaPerimeter("Nagoya", resolvedPlaces);

    expect(perimeter).toHaveLength(49);
    expect(resolvedPlaces.every((point) => insidePolygon(point, perimeter))).toBe(
      true,
    );
  });

  it("keeps a useful approximate area when no places have coordinates", () => {
    const perimeter = cityAreaPerimeter("Nagoya", []);

    expect(perimeter).toHaveLength(49);
    expect(perimeter[0][0]).toBeCloseTo(137.019, 3);
    expect(perimeter[12][1]).toBeCloseTo(35.271, 3);
  });
});

describe("design map city routes", () => {
  it("keeps the stop order and revisited cities", () => {
    const route = cityRouteFeatures(
      [
        { city: "Tokyo" },
        { city: "Hakone" },
        { city: "Osaka" },
        { city: "Tokyo" },
      ],
      [],
    );

    expect(route.type).toBe("FeatureCollection");
    expect(route.features).toHaveLength(3);
    expect(route.features.map((feature) => feature.geometry.type)).toEqual([
      "LineString",
      "LineString",
      "LineString",
    ]);
    expect(route.features.map((feature) => [
      feature.geometry.coordinates[0],
      feature.geometry.coordinates.at(-1),
    ])).toEqual([
      [
        [139.7, 35.68],
        [139.025, 35.232],
      ],
      [
        [139.025, 35.232],
        [135.502, 34.694],
      ],
      [
        [135.502, 34.694],
        [139.7, 35.68],
      ],
    ]);
  });

  it("does not bridge an unresolved middle city", () => {
    const route = cityRouteFeatures(
      [{ city: "Tokyo" }, { city: "Unmapped" }, { city: "Osaka" }],
      [],
    );

    expect(route.features).toHaveLength(0);
  });

  it.each([
    { name: "empty stops", stops: [] },
    { name: "a single stop", stops: [{ city: "Tokyo" }] },
    {
      name: "the same city twice",
      stops: [{ city: "Tokyo" }, { city: "Tokyo" }],
    },
  ])("returns no features for $name", ({ stops }) => {
    expect(cityRouteFeatures(stops, []).features).toHaveLength(0);
  });

  it("uses matching place coordinates for an otherwise unknown city", () => {
    const kanazawa: Place = {
      id: "kanazawa-place",
      name: "Kanazawa place",
      city: "Kanazawa",
      latitude: 36.561,
      longitude: 136.656,
    };

    const route = cityRouteFeatures(
      [{ city: "Tokyo" }, { city: "Kanazawa" }],
      [kanazawa],
    );

    expect(route.features).toHaveLength(1);
    expect(route.features[0].geometry.coordinates[0][0]).toBeCloseTo(139.7, 10);
    expect(route.features[0].geometry.coordinates[0][1]).toBeCloseTo(35.68, 10);
    const kanazawaPerimeter = cityAreaPerimeter(
      "Kanazawa",
      [[136.656, 36.561]],
      [136.656, 36.561],
    );
    expect(route.features[0].geometry.coordinates[0][0]).toBeCloseTo(139.7, 10);
    expect(route.features[0].geometry.coordinates[0][1]).toBeCloseTo(35.68, 10);
    expect(
      isOnPolygonEdge(route.features[0].geometry.coordinates.at(-1)!, kanazawaPerimeter),
    ).toBe(true);
  });

  it.each(["Nikko", "Nikkō"])(
    "resolves a known %s stop without saved places and separates return legs",
    (city) => {
      const route = cityRouteFeatures(
        [{ city: "Tokyo" }, { city }, { city: "Tokyo" }],
        [],
      );

      expect(route.features).toHaveLength(2);
      expect(
        route.features.every((feature) => feature.geometry.type === "LineString"),
      ).toBe(true);
      const outbound = route.features[0].geometry.coordinates;
      const returnLeg = route.features[1].geometry.coordinates;
      expect(outbound[0][0]).toBeCloseTo(139.7, 10);
      expect(outbound[0][1]).toBeCloseTo(35.68, 10);
      expect(outbound.at(-1)![0]).toBeCloseTo(139.698, 10);
      expect(outbound.at(-1)![1]).toBeCloseTo(36.72, 10);
      expect(returnLeg[0][0]).toBeCloseTo(139.698, 10);
      expect(returnLeg[0][1]).toBeCloseTo(36.72, 10);
      expect(returnLeg.at(-1)![0]).toBeCloseTo(139.7, 10);
      expect(returnLeg.at(-1)![1]).toBeCloseTo(35.68, 10);
      const centerLongitude = (139.7 + 139.698) / 2;
      const outboundMidpointLongitude =
        outbound[Math.floor(outbound.length / 2)][0];
      const returnMidpointLongitude =
        returnLeg[Math.floor(returnLeg.length / 2)][0];
      expect(
        (outboundMidpointLongitude - centerLongitude) *
          (returnMidpointLongitude - centerLongitude),
      ).toBeLessThan(0);
      expect(
        [...outbound, ...returnLeg].every((point) =>
          point.every((coordinate) => Number.isFinite(coordinate)),
        ),
      ).toBe(true);
    },
  );

  it("clips route endpoints to saved city group edges", () => {
    const places = [
      place("ghibli-park", "Nagoya", 137.095, 35.185),
      place("osaka-castle", "Osaka", 135.53, 34.686),
    ];
    const nagoyaPerimeter = cityAreaPerimeter(
      "Nagoya",
      [[137.095, 35.185]],
    );
    const osakaPerimeter = cityAreaPerimeter("Osaka", [[135.53, 34.686]]);
    const route = cityRouteFeatures(
      [{ city: "Nagoya" }, { city: "Osaka" }],
      places,
    );

    expect(route.features).toHaveLength(1);
    expect(route.features[0].properties).toMatchObject({
      from: "Nagoya",
      to: "Osaka",
    });
    const coordinates = route.features[0].geometry.coordinates;
    expect(isOnPolygonEdge(coordinates[0], nagoyaPerimeter)).toBe(true);
    expect(
      isOnPolygonEdge(coordinates.at(-1)!, osakaPerimeter),
    ).toBe(true);
    expect(
      coordinates.slice(1, -1).every(
        (point) =>
          !insidePolygon(point, nagoyaPerimeter) &&
          !insidePolygon(point, osakaPerimeter),
      ),
    ).toBe(true);
  });

  it("clips both Tokyo return arcs when only Tokyo has saved places", () => {
    const tokyoPlaces = [place("tokyo-place", "Tokyo", 139.72, 35.69)];
    const tokyoPerimeter = cityAreaPerimeter("Tokyo", [[139.72, 35.69]]);
    const route = cityRouteFeatures(
      [{ city: "Tokyo" }, { city: "Nikkō" }, { city: "Tokyo" }],
      tokyoPlaces,
    );

    expect(route.features).toHaveLength(2);
    const outbound = route.features[0].geometry.coordinates;
    const returnLeg = route.features[1].geometry.coordinates;
    expect(isOnPolygonEdge(outbound[0], tokyoPerimeter)).toBe(true);
    expect(isOnPolygonEdge(returnLeg.at(-1)!, tokyoPerimeter)).toBe(true);
    expect(outbound[0]).not.toEqual([139.7, 35.68]);
    expect(returnLeg.at(-1)).not.toEqual([139.7, 35.68]);
    expect(route.features[0].properties).toMatchObject({
      from: "Tokyo",
      to: "Nikkō",
    });
    expect(route.features[1].properties).toMatchObject({
      from: "Nikkō",
      to: "Tokyo",
    });
  });

  it("omits a route when massive city groups overlap completely", () => {
    const places = [
      place("nagoya-massive", "Nagoya", 130, 30),
      place("osaka-massive", "Osaka", 142, 40),
    ];

    const route = cityRouteFeatures(
      [{ city: "Nagoya" }, { city: "Osaka" }],
      places,
    );

    expect(route.features).toHaveLength(0);
  });
});
