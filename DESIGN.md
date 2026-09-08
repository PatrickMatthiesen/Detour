# Design direction

## World

The interface draws from a Japanese rail timetable and a well-used field notebook: warm paper, ink-black typography, vermilion decisions, indigo distance markers, and quiet green for ready states. It should feel considered and tactile without becoming a theme park version of Japan.

## Mode

Operate. The first job is to understand what is saved, what is selected, and what can fit into the trip.

## Palette and type

- Canvas: pale rice `#F5F1E8`; primary ink `#17211D`; muted ink `#68736D`; hairline `#D9D4C8`.
- Vermilion `#B9422E` marks decisions and active selections. Indigo `#315A72` carries travel. Moss `#58725C` marks ready/packed.
- Display: `DM Serif Display`; body: `IBM Plex Sans`; numbers and times use tabular figures in the body face.
- Prefer solid surfaces and 12–16px radii. Shadows are soft and offset; borders remain light.

## Composition

Desktop opens with a narrow rail-like sidebar and a two-column workspace: place library on the left, geographic context on the right. The app bar names the active trip and gives one clear add action. Mobile collapses into a top bar and bottom navigation; map context becomes a drawer or shorter lower section.

## Signature interaction

Selecting one place wakes its city and area: the place row receives a vermilion marker, the area summary becomes colored, nearby saved places rise in the list, and the map shows the cluster. This is a planning signal, not an itinerary mutation.

## States

Saved places are paper rows, selected places carry a vermilion check and label, suggested places use a dashed indigo cue, and approximate city markers use a ring plus “city area” text. Empty and loading states explain recovery and never look like missing content.

## Surface contracts

- Library: browse, filter, group, select, and add places quickly.
- Itinerary: show date spine, stays, travel, scheduled items, unallocated selections, and accommodation gaps.
- Preparation: combine tasks and packing with due/packed progress.
