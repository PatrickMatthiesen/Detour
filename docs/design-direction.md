# Approved design direction

Approved by the user on 9 September 2026: use the current `/4` explorer as the visual and interaction baseline. Stop exploring alternative layouts. The colour treatment is accepted for now; it may be slightly too colourful, so future refinement should reduce intensity rather than introduce another theme.

## Preserve

- Photo-led browsing with useful descriptions of what a place is and why it could be interesting; never reduce discovery to names alone.
- Compact city navigation and category filters. An always-visible search field with All saved / Chosen on its left supports browsing.
- Map alongside the library on desktop, readable Latin names, geographic group rings, and small zoom-dependent dots for actual places only. City labels must not look like place dots.
- Selecting a place makes surrounding saved options more relevant without automatically scheduling them or committing to a city stay.
- A detail inspector opened from a place, with descriptions, practical information, sources and selection controls.
- A compact stays strip with consistent spacing and readable short dates. Wrap when necessary rather than require horizontal scrolling.
- Light surfaces with restrained coral selection accents and distinct category colours. The map has its own natural colours; do not tint the whole screen one colour.
- Plain typography, useful content and minimal interface copy. No decorative numbering, slogans, oversized headings or floating map-information banners.

## Implementation boundary

`/4` remains a temporary interactive preview. The approved explorer now also runs at `/` with persistent selection and manual add/edit. `/plan` shares that trip state and saves activity additions, times, durations and removals. Preview photo/coordinate presentation is not written back to the trip. Preserve uncertainty and source information when integrating real data.

The first Plan workflow is implemented: city-stay navigation, day selection, booking/travel context, nearby saved places and daily activities. Capacity uses an explicit 09:00–21:00 planning budget; unknown durations, bookings, meals and local transfers mean the result is an upper bound, not guaranteed free time. Existing stay editing is still available through `/itinerary`. Next: integrate stay/route editing into the new Plan workspace, then redesign Bookings and Prepare (tasks and packing). The other preview routes are references, not competing directions.
