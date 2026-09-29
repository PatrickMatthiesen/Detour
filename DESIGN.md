# Design direction

## World

The interface draws from a Japanese rail timetable and a well-used field notebook: warm paper, ink-black typography, vermilion decisions, indigo distance markers, and quiet green for ready states. It should feel considered and tactile without becoming a theme park version of Japan.

## Mode

Operate. The first job is to understand what is saved, what is selected, and what can fit into the trip.

## Palette and type

- Canvas: soft paper `#F7F8F3`; primary ink `#273535`; muted ink `#586760`; hairline `#DFE4DC`.
- Vermilion `#B94F3F` marks decisions and active selections. Indigo `#426B80` carries travel. Moss `#58765F` marks ready/packed.
- Use `Lato` for headings, body text, and controls, with `system-ui, sans-serif` as fallbacks. Distinguish headings through size and weight; numbers and times use tabular figures.
- Prefer solid surfaces and 8–12px radii. Shadows are soft and offset; borders remain light.

## Composition

Desktop opens with a compact top navigation bar naming the active trip and the three working modes. Places uses a two-pane workspace with browse controls in a drawer on the left and geographic context on the right. Plan and Prepare use a single paper workspace with clear sections and date or attention controls. Mobile keeps the top bar, turns the Places pane into a snap-point drawer, and lets Plan and Prepare flow as a single column.

## Signature interaction

Selecting one place wakes its city and area: the place row receives a vermilion marker, the area summary becomes colored, nearby saved places rise in the list, and the map shows the cluster. This is a planning signal, not an itinerary mutation.

## States

Saved places are paper rows, selected places carry a vermilion check and label, suggested places use a dashed indigo cue, and approximate city markers use a ring plus “city area” text. Empty and loading states explain recovery and never look like missing content.

## Surface contracts

- Places: browse, filter, group, select, and add places quickly while keeping the map visible.
- Plan: show date spine, stays, travel, scheduled items, unallocated selections, and accommodation gaps.
- Prepare: combine tasks and packing with due/packed progress.
