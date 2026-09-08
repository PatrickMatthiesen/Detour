import type { Activity, Booking, TravelLeg, TripSnapshot } from "../types";

const PLANNING_WINDOW_MINUTES = 12 * 60;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface DaySummary {
  cities: string[];
  activities: Activity[];
  travelLegs: TravelLeg[];
  bookings: Booking[];
  knownMinutes: number;
  unknownDurations: number;
  remainingMinutes: number;
  overlaps: boolean;
  accommodationCovered: boolean;
}

/** Return the trip's inclusive calendar range without consulting the machine's local timezone. */
export function datesForTrip(snapshot: TripSnapshot): string[] {
  const start = parseDateOnly(snapshot.trip.startDate);
  const end = parseDateOnly(snapshot.trip.endDate);
  if (start === null || end === null || end < start) return [];

  const dates: string[] = [];
  for (let day = start; day <= end; day += 86_400_000) {
    dates.push(formatDateOnly(new Date(day)));
  }
  return dates;
}

export function daySummary(snapshot: TripSnapshot, date: string): DaySummary {
  const activities = snapshot.activities.filter(
    (activity) => activity.date === date && !isCancelled(activity.status),
  );
  const travelLegs = snapshot.travelLegs.filter((leg) => leg.date === date);
  const bookings = snapshot.bookings.filter(
    (booking) => !isCancelled(booking.status) && bookingBelongsOnDate(booking, date, snapshot.trip.timeZone),
  );

  const cities: string[] = [];
  const addCity = (city: string | null | undefined) => {
    const value = city?.trim();
    if (value && !cities.includes(value)) cities.push(value);
  };

  // A stay owns the hotel nights [checkIn, checkOut); checkout day belongs to
  // the next allocation. Travel endpoints add useful context on transfer days.
  for (const stay of snapshot.stays) {
    if (stay.checkIn <= date && date < stay.checkOut) addCity(stay.city);
  }
  for (const leg of travelLegs) {
    addCity(leg.from);
    addCity(leg.to);
  }

  let knownMinutes = 0;
  let unknownDurations = 0;
  const activityDurations = new Map<string, number | null>();
  for (const activity of activities) {
    const duration = activityDuration(snapshot, activity);
    activityDurations.set(activity.id, duration);
    if (duration === null) unknownDurations++;
    else knownMinutes += duration;
  }
  for (const leg of travelLegs) {
    const duration = validDuration(leg.durationMinutes);
    if (duration === null) unknownDurations++;
    else knownMinutes += duration;
  }

  return {
    cities,
    activities,
    travelLegs,
    bookings,
    knownMinutes,
    unknownDurations,
    remainingMinutes: Math.max(0, PLANNING_WINDOW_MINUTES - knownMinutes),
    overlaps: hasActivityOverlap(activities, activityDurations),
    accommodationCovered: snapshot.bookings.some(
      (booking) =>
        !isCancelled(booking.status) &&
        isConfirmed(booking.status) &&
        isAccommodationBooking(booking) &&
        Boolean(booking.checkIn && booking.checkOut) &&
        booking.checkIn! <= date &&
        date < booking.checkOut!,
    ),
  };
}

function parseDateOnly(value: string | null | undefined): number | null {
  if (!value || !DATE_ONLY.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, month - 1, day);
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) return null;
  return result.getTime();
}

function formatDateOnly(value: Date): string {
  return [value.getUTCFullYear().toString().padStart(4, "0"),
    (value.getUTCMonth() + 1).toString().padStart(2, "0"),
    value.getUTCDate().toString().padStart(2, "0")].join("-");
}

function validDuration(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function activityDuration(snapshot: TripSnapshot, activity: Activity): number | null {
  const direct = validDuration(activity.durationMinutes);
  if (direct !== null) return direct;
  const place = activity.placeId === null
    ? undefined
    : snapshot.places.find((candidate) => candidate.id === activity.placeId);
  return validDuration(place?.durationMinutes);
}

function isCancelled(status: string | null | undefined): boolean {
  return status?.trim().toLowerCase() === "cancelled" || status?.trim().toLowerCase() === "canceled";
}

function isConfirmed(status: string | null | undefined): boolean {
  return status?.trim().toLowerCase() === "confirmed";
}

function isAccommodationBooking(booking: Booking): boolean {
  const kind = booking.kind.trim().toLowerCase();
  return kind === "hotel" || kind === "accommodation" || kind === "lodging" || kind === "hostel" ||
    kind === "ryokan" || kind === "guesthouse" || kind === "apartment" || kind === "airbnb";
}

function bookingBelongsOnDate(booking: Booking, date: string, timeZone: string | null | undefined): boolean {
  // Date-only values carry their source calendar date and must never be parsed
  // as UTC instants. Each field is an independent reason for inclusion.
  if (booking.date === date || localDateForTimestamp(booking.date, timeZone) === date) return true;

  const checkIn = calendarDate(booking.checkIn, timeZone);
  const checkOut = calendarDate(booking.checkOut, timeZone);
  if (checkIn && checkOut && checkIn <= date && date < checkOut) return true;
  if (checkIn === date) return true;
  if (checkOut === date && !booking.start && !booking.end) return true;

  const start = localDateForTimestamp(booking.start, timeZone);
  const end = localDateForTimestamp(booking.end, timeZone);
  if (start && end) return start <= date && date <= end;
  return start === date || end === date;
}

function calendarDate(value: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (!value) return null;
  return DATE_ONLY.test(value) ? value : localDateForTimestamp(value, timeZone);
}

function localDateForTimestamp(value: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (!value) return null;
  if (DATE_ONLY.test(value)) return value;

  // API timestamps normally carry an offset. A timestamp without one is a
  // wall time from the trip's planning timezone, so retain its date prefix
  // instead of letting Date.parse interpret it in the browser's timezone.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const datePrefix = /^(\d{4}-\d{2}-\d{2})T/.exec(value)?.[1];
    return datePrefix && parseDateOnly(datePrefix) !== null ? datePrefix : null;
  }

  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone?.trim() || "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(instant));
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function hasActivityOverlap(activities: Activity[], durations: Map<string, number | null>): boolean {
  const timed = activities.flatMap((activity) => {
    const duration = durations.get(activity.id);
    if (!activity.startTime || duration === null || duration === undefined) return [];
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(activity.startTime.trim());
    if (!match) return [];
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return [];
    const start = hours * 60 + minutes;
    return [{ start, end: start + duration }];
  });
  for (let first = 0; first < timed.length; first++) {
    for (let second = first + 1; second < timed.length; second++) {
      if (timed[first].start < timed[second].end && timed[second].start < timed[first].end) return true;
    }
  }
  return false;
}
