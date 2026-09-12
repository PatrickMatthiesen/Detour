import { describe, expect, it } from "vitest";
import { cityAreaPerimeter } from "./design-kit";

function insidePolygon(point: [number, number], polygon: Array<[number, number]>) {
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
