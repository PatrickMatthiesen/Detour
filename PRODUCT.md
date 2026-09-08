# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: ASP.NET Core backend, PostgreSQL, React TypeScript Vite, Bun, TanStack Router and Query, Tailwind; Aspire orchestrates local and deployed services.

## Users

The primary user is one traveler planning and taking a personal trip from a phone or laptop. They collect ideas in ChatGPT, then need a calm, visual workspace for deciding what is worth including, arranging days, tracking commitments, and preparing to leave.

## Product Purpose

Detour turns a large, flexible collection of saved places into an understandable trip. It keeps saved ideas separate from scheduled commitments, makes travel and accommodation visible, and helps the traveler act on the plan with bookings, checklists, and packing.

## Positioning

The product preserves the difference between “interesting” and “committed” at every step, while showing the geographic and time cost of a decision before it becomes part of the itinerary.

## Operating Context

ChatGPT is the research and data-entry partner: it can read Notion or Gmail through existing connectors and update this app through an authenticated plugin. The app is the authoritative planner and should work well on a phone with a network connection during the trip.

## Capabilities and Constraints

- Candidate places are reusable saved records. Trip selection, scheduled activity, stay, travel leg, booking, task, and packing item are separate concepts.
- Places group by city and area. An active area is visually prominent when it contains a selected place; it is not automatically a hotel stay.
- The initial real trip is Japan, 30 September–25 October 2026, arriving Tokyo Haneda 2 October and departing Tokyo Haneda 25 October.
- Manual place entry is required. Link ingestion and Notion migration are intentionally handled by ChatGPT rather than product features.
- Booking purchases happen on external provider sites; the app records details ChatGPT finds in Gmail.
- First travel estimates are editable and may carry a source and checked date. Unknown coordinates remain unknown; city-level approximate map markers must be labeled.
- The product is personal first, with a possible future self-hosted version. Full collaboration and offline editing are open decisions.

## Evidence on Hand

Real source data is supplied in `C:\Users\patr7\Downloads\japan-places\Japan 2026 — Places c5f02fad6ec045389f00ac7795fe34b7.csv` and `C:\Users\patr7\Downloads\Japan_2026-Itinerary\Japan 2026 — Itinerary 7fe2cb34ea9b417a9fbab506a514ece2.csv`. The app must not invent hotel, flight, place, or booking facts absent from those sources.

## Product Principles

1. Ideas stay safe to explore until explicitly committed.
2. Geography and time are first-class planning information.
3. Every uncertain fact keeps its source and uncertainty visible.
4. Preparation belongs beside the itinerary, not buried in it.
5. Small, reversible decisions should feel easy.

## Accessibility & Inclusion

Use semantic controls, keyboard focus, readable contrast, explicit labels, and responsive layouts. Color is supplemental; selected, suggested, approximate, and required states need text or icon cues as well.
