import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlaceDetails from "./PlaceDetails";
import type { Place } from "../types";

const place: Place = { id: "temple", name: "Temple", city: "Tokyo" };
const close = () => {};

describe("place details", () => {
  it("opens from the library without offering a day-specific action", () => {
    const html = renderToStaticMarkup(<PlaceDetails place={{ ...place, description: "A quiet temple", notes: "Use the east entrance." }} onClose={close} onEdit={close} />);
    expect(html).toContain("A quiet temple");
    expect(html).toContain("Use the east entrance.");
    expect(html).toContain("Edit place");
    expect(html).not.toContain("Add to this day");
    expect(html).not.toContain("On this day");
  });

  it("keeps the planner's scheduled action disabled", () => {
    const html = renderToStaticMarkup(<PlaceDetails place={place} scheduled onClose={close} onAdd={close} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain("On this day");
  });

  it("renders embedded details with navigation and trip actions", () => {
    const html = renderToStaticMarkup(<PlaceDetails
      place={{ ...place, description: "A quiet temple", notes: "Use the east entrance." }}
      embedded
      onClose={close}
      onEdit={close}
      onToggleTrip={close}
    />);
    expect(html).toContain('class="place-details place-details-embedded"');
    expect(html).not.toContain("<dialog");
    expect(html).toContain("Back to places");
    expect(html).toContain("Edit place");
    expect(html).toContain("Add to trip");
    expect(html).not.toContain("Added to trip");
    expect(html).not.toContain("Remove from trip");
    expect(html).not.toContain("Add to this day");
    expect(html).not.toContain("On this day");
  });

  it("shows the selected trip status and removal action in embedded details", () => {
    const html = renderToStaticMarkup(<PlaceDetails
      place={{ ...place, selected: true }}
      embedded
      onClose={close}
      onToggleTrip={close}
    />);
    expect(html).toContain("Added to trip");
    expect(html).toContain("Remove from trip");
    expect(html).not.toContain("Add to trip");
    expect(html).not.toContain("Add to this day");
    expect(html).not.toContain("On this day");
  });

  it("uses edited planning fields before legacy note labels", () => {
    const html = renderToStaticMarkup(<PlaceDetails place={{
      ...place,
      durationText: "Two hours",
      reservation: "Required",
      needsResearch: false,
      notes: "Estimated duration: One hour\n\nReservation: Not needed\n\nNeeds research: Yes\n\nBring an umbrella.",
    }} onClose={close} />);
    expect(html).toContain("Two hours");
    expect(html).not.toContain("One hour");
    expect(html).toContain("Required");
    expect(html).not.toContain("Not needed");
    expect(html).not.toContain("Needs checking");
    expect(html).toContain("Bring an umbrella.");
  });

  it("still reads legacy labels when structured fields are absent", () => {
    const html = renderToStaticMarkup(<PlaceDetails place={{ ...place, notes: "Estimated duration: One hour\n\nNeeds research: Yes" }} onClose={close} />);
    expect(html).toContain("One hour");
    expect(html).toContain("Needs checking");
  });
});
