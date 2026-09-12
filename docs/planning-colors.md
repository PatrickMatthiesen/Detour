# Planning colors

The Places map and Route strip use the same status palette, defined in
`web/src/mockups/route-status.ts`. The page supplies these values as CSS variables.

| Status | Color | Meaning |
| --- | --- | --- |
| Saved | Slate `#64748b` | Saved ideas without a picked place or planned stay |
| Picked | Red `#b94f3f` | Picked places, or a planned stay with no confirmed accommodation coverage |
| Partial | Amber `#996b17` | Some accommodation nights are covered, but not all |
| Booked | Green `#287052` | Every night of the stay has confirmed accommodation coverage |

Blue `#527cc4` is reserved for the illustrative route arrows. Viewing a city uses
a dark outline or underline and does not change its booking status. Category
chips identify place categories and do not indicate booking progress.

## Accommodation coverage

Count distinct nights covered by confirmed accommodation bookings. Check-in is
inclusive and checkout is exclusive. Cancelled stays and bookings do not count.
Date overlap alone cannot associate a hotel with a city. Match an exact normalized
booking location to the city, or use the stay's explicit booking link. A linked
booking with a location that identifies another known stay city does not count.
Full addresses on explicitly linked bookings are supported. Do not infer city
associations from booking titles.

Consecutive stays in the same city merge only when their dates touch or overlap.
Separate visits retain separate Route cards. A map marker summarizes all visits:
green requires every visit to be covered; amber means some nights are covered.
Missing or invalid dates never produce a green status.

Route cards show status text as well as color. Their accessible labels and tooltips
include night counts. Map city markers use status colors with dark city names;
hover details include the number of covered stays and nights. The map key explains
the colors. Picking a place does not create an accommodation or ticket requirement.

## Transport

The separate Transport bookings disclosure summarizes recorded flight and other
transport bookings. It uses the same palette and explicit confirmation counts.
No recorded bookings means unknown, not proof that a reservation is required.
Travel legs currently have no explicit booking association, so these counts do
not claim coverage of every journey. Accommodation status never includes transport.
