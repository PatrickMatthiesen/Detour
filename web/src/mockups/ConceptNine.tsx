import { useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Plus,
  Train,
  X,
} from "lucide-react";
import type { Activity, Place } from "../types";
import {
  DesignMap,
  PlacePhoto,
  PreviewNav,
  cityPlaces,
  shortDate,
  useDesignTrip,
} from "./design-kit";
import "./nine.css";

const DAY = "2026-10-02";
export default function ConceptNine() {
  const { trip, selected, loading, error } = useDesignTrip();
  const [date, setDate] = useState(DAY);
  const [city, setCity] = useState("Tokyo");
  const [category, setCategory] = useState("All");
  const [localActivities, setLocalActivities] = useState<Activity[]>([]);
  const places = trip ? cityPlaces(trip, city) : [];
  const categories = [
    "All",
    ...Array.from(
      new Set(
        places.flatMap((place) =>
          (place.category || "Other").split(",").map((part) => part.trim()),
        ),
      ),
    ).slice(0, 7),
  ];
  const scheduled = useMemo(
    () => [
      ...(trip?.activities.filter((item) => item.date === date) ?? []),
      ...localActivities.filter((item) => item.date === date),
    ],
    [trip, localActivities, date],
  );
  const scheduledPlaces = scheduled
    .map((activity) =>
      trip?.places.find((place) => place.id === activity.placeId),
    )
    .filter((place): place is Place => Boolean(place));
  const usedMinutes = scheduled.reduce(
    (total, activity) => total + (activity.durationMinutes || 0),
    0,
  );
  const travel = trip?.travelLegs.filter((leg) => leg.date === date) ?? [];
  const bookings =
    trip?.bookings.filter((booking) =>
      (booking.date || booking.start || booking.checkIn)?.startsWith(date),
    ) ?? [];
  const browse = places.filter(
    (place) => category === "All" || place.category?.includes(category),
  );
  const moveDay = (delta: number) => {
    const next = new Date(`${date}T12:00:00`);
    next.setDate(next.getDate() + delta);
    setDate(next.toISOString().slice(0, 10));
  };
  const add = (place: Place) =>
    setLocalActivities((items) =>
      items.some((item) => item.date === date && item.placeId === place.id)
        ? items
        : [
            ...items,
            {
              id: `preview-${place.id}-${date}`,
              placeId: place.id,
              date,
              durationMinutes: place.durationMinutes || 90,
              status: "preview",
            },
          ],
    );

  return (
    <main className="new-preview d9-page">
      <PreviewNav active={9} />
      <header className="d9-head">
      <div>
        <strong>Day composer</strong>
        </div>
        <div className="d9-day-control">
          <button onClick={() => moveDay(-1)} aria-label="Previous day">
            <ChevronLeft />
          </button>
          <label>
            <span>
              {new Intl.DateTimeFormat("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(new Date(`${date}T12:00:00`))}
            </span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <button onClick={() => moveDay(1)} aria-label="Next day">
            <ChevronRight />
          </button>
        </div>
      </header>
      <section className="d9-browse">
        <div className="d9-browse-head">
        <div>
          <h1>Choose from {city}</h1>
          <p>Your saved places in {city}.</p>
          </div>
          <select
            value={city}
            onChange={(event) => setCity(event.target.value)}
          >
            {trip &&
              Array.from(new Set(trip.places.map((place) => place.city)))
                .sort()
                .map((name) => <option key={name}>{name}</option>)}
          </select>
        </div>
        <div className="d9-categories">
          {categories.map((name) => (
            <button
              className={category === name ? "active" : ""}
              onClick={() => setCategory(name)}
              key={name}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="d9-place-grid">
          {loading && <p>Loading places…</p>}
          {error && <p>Places could not be loaded.</p>}
          {browse.map((place) => {
            const alreadyAdded = scheduled.some(
              (item) => item.placeId === place.id,
            );
            return (
              <article key={place.id}>
                <PlacePhoto place={place} className="d9-photo" />
                <div>
                  <h2>{place.name}</h2>
                  <p>
                    {place.description ||
                      place.notes ||
                      "Saved in your place library."}
                  </p>
                  <span>
                    <MapPin /> {place.area || city}
                  </span>
                </div>
                <div className="d9-card-actions">
                  <span>
                    <Clock />{" "}
                    {place.durationMinutes
                      ? `${place.durationMinutes} min`
                      : place.durationText || "Duration unknown"}
                  </span>
                  <button disabled={alreadyAdded} onClick={() => add(place)}>
                    {alreadyAdded ? (
                      <>
                        <Check /> Added
                      </>
                    ) : (
                      <>
                        <Plus /> Add to day
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <aside className="d9-plan">
        <div className="d9-plan-title">
          <div>
            <h2>{shortDate(date)}</h2>
            <p>{city} plan</p>
          </div>
          <span>{Math.round((usedMinutes / 60) * 10) / 10}h scheduled</span>
        </div>
        <div className="d9-timeline">
          {bookings.map((booking) => (
            <div className="d9-event booking" key={booking.id}>
              <CalendarDays />
              <div>
                <strong>{booking.title}</strong>
                <small>Booking · {booking.status}</small>
              </div>
            </div>
          ))}
          {scheduled.map((activity, index) => {
            const place = trip?.places.find(
              (item) => item.id === activity.placeId,
            );
            return (
              <div className="d9-event" key={activity.id}>
                <span className="d9-time">
                  {activity.startTime || (index ? "Later" : "Morning")}
                </span>
                <div>
                  <strong>
                    {place?.name || activity.title || "Planned activity"}
                  </strong>
                  <small>
                    {activity.durationMinutes
                      ? `${activity.durationMinutes} minutes`
                      : "Time needed is unknown"}
                  </small>
                </div>
                {activity.id.startsWith("preview-") && (
                  <button
                    onClick={() =>
                      setLocalActivities((items) =>
                        items.filter((item) => item.id !== activity.id),
                      )
                    }
                    aria-label="Remove from day"
                  >
                    <X />
                  </button>
                )}
              </div>
            );
          })}
          {travel.map((leg) => (
            <div className="d9-event travel" key={leg.id}>
              <Train />
              <div>
                <strong>
                  {leg.from} to {leg.to}
                </strong>
                <small>
                  {leg.durationMinutes
                    ? `${leg.durationMinutes} min`
                    : "Travel time unknown"}{" "}
                  · {leg.mode || "Travel"}
                </small>
              </div>
            </div>
          ))}
          <div className="d9-free">
            <Clock />
            <div>
              <strong>
                {usedMinutes
                  ? "Time remains unallocated"
                  : "This day is still open"}
              </strong>
              <small>
                {usedMinutes
                  ? "Meal, transfer and opening-hour buffers are not included."
                  : "Add a place to begin shaping the day."}
              </small>
            </div>
          </div>
        </div>
        <DesignMap
          places={scheduledPlaces.length ? scheduledPlaces : places}
          selected={selected}
          city={city}
          className="d9-mini-map"
          route
        />
        <p className="d9-local">Preview changes stay on this screen.</p>
      </aside>
    </main>
  );
}
