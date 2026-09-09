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
  unknownItems: string[];
  remainingMinutes: number;
  overlaps: boolean;
  conflicts: string[];
  calculationNotes: string[];
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

  let untimedMinutes = 0;
  let unknownDurations = 0;
  const unknownItems: string[] = [];
  const calculationNotes: string[] = [];
  const timedIntervals: TimedInterval[] = [];
  for (const activity of activities) {
    const duration = activityDuration(snapshot, activity);
    if (duration === null) {
      unknownDurations++;
      unknownItems.push(activityName(snapshot, activity));
      continue;
    }

    const start = parseLocalTime(activity.startTime);
    if (start === null) {
      untimedMinutes += duration;
      if (activity.startTime?.trim()) {
        calculationNotes.push(`Activity "${activityName(snapshot, activity)}" has an invalid start time; counted as untimed.`);
      } else {
        calculationNotes.push(`Activity "${activityName(snapshot, activity)}" has no start time; counted as untimed.`);
      }
    } else {
      timedIntervals.push({
        name: activityName(snapshot, activity),
        start,
        end: start + duration,
        kind: "activity",
      });
    }
  }
  for (const leg of travelLegs) {
    const duration = validDuration(leg.durationMinutes);
    if (duration === null) {
      unknownDurations++;
      unknownItems.push(`${leg.from} → ${leg.to}`);
    }
    else {
      untimedMinutes += duration;
      calculationNotes.push(`Travel "${leg.from} → ${leg.to}" has no clock time; counted as untimed.`);
    }
  }

  for (const booking of bookings) {
    if (isAccommodationBooking(booking)) continue;
    const interval = bookingInterval(booking, snapshot.trip.timeZone, date);
    if (interval === null) {
      unknownDurations++;
      unknownItems.push(bookingName(booking));
      calculationNotes.push(`Booking "${bookingName(booking)}" has no complete timed interval; duration is unknown.`);
    } else if (interval) {
      timedIntervals.push({ name: bookingName(booking), ...interval, kind: "booking" });
    }
  }

  const conflicts = findConflicts(timedIntervals);
  const timedMinutes = unionMinutes(timedIntervals);
  const knownMinutes = timedMinutes + untimedMinutes;
  addDuplicateNotes(calculationNotes, activities, bookings, snapshot);

  return {
    cities,
    activities,
    travelLegs,
    bookings,
    knownMinutes,
    unknownDurations,
    unknownItems,
    remainingMinutes: Math.max(0, PLANNING_WINDOW_MINUTES - knownMinutes),
    overlaps: conflicts.length > 0,
    conflicts,
    calculationNotes,
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

interface TimedInterval {
  name: string;
  start: number;
  end: number;
  kind: "activity" | "booking";
}

interface LocalTimestamp {
  date: string;
  minute: number;
}

function parseLocalTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
}

function parseTimestamp(value: string | null | undefined, timeZone: string | null | undefined): LocalTimestamp | null {
  if (!value || DATE_ONLY.test(value)) return null;
  const trimmed = value.trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/.exec(trimmed);
    if (!match || parseDateOnly(match[1]) === null) return null;
    const minute = Number(match[2]) * 60 + Number(match[3]);
    return Number(match[2]) <= 23 && Number(match[3]) <= 59 ? { date: match[1], minute } : null;
  }

  const instant = Date.parse(trimmed);
  if (!Number.isFinite(instant)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone?.trim() || "Asia/Tokyo",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(instant));
    const valueFor = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
    const year = valueFor("year");
    const month = valueFor("month");
    const day = valueFor("day");
    const hour = valueFor("hour");
    const minute = valueFor("minute");
    if (!year || !month || !day || !hour || !minute) return null;
    return { date: `${year}-${month}-${day}`, minute: Number(hour) * 60 + Number(minute) };
  } catch {
    return null;
  }
}

function bookingInterval(
  booking: Booking,
  timeZone: string | null | undefined,
  date: string,
): Omit<TimedInterval, "name" | "kind"> | null | undefined {
  if (!booking.start || !booking.end) return null;
  const start = parseTimestamp(booking.start, timeZone);
  const end = parseTimestamp(booking.end, timeZone);
  if (!start || !end) return null;
  const startMinute = minutesFromDate(date, start);
  const endMinute = minutesFromDate(date, end);
  if (endMinute < startMinute) return null;
  if (endMinute <= 0 || startMinute >= 24 * 60) return undefined;
  return { start: startMinute, end: endMinute };
}

function minutesFromDate(date: string, timestamp: LocalTimestamp): number {
  const day = parseDateOnly(date);
  const timestampDay = parseDateOnly(timestamp.date);
  if (day === null || timestampDay === null) return timestamp.minute;
  return Math.round((timestampDay - day) / 60_000) + timestamp.minute;
}

function unionMinutes(intervals: TimedInterval[]): number {
  const windowStart = 9 * 60;
  const windowEnd = 21 * 60;
  const clipped = intervals
    .map(({ start, end }) => ({ start: Math.max(windowStart, start), end: Math.min(windowEnd, end) }))
    .filter((interval) => interval.start < interval.end)
    .sort((first, second) => first.start - second.start || first.end - second.end);
  let total = 0;
  let current: { start: number; end: number } | undefined;
  for (const interval of clipped) {
    if (!current) current = interval;
    else if (interval.start <= current.end) current.end = Math.max(current.end, interval.end);
    else {
      total += current.end - current.start;
      current = interval;
    }
  }
  return total + (current ? current.end - current.start : 0);
}

function findConflicts(intervals: TimedInterval[]): string[] {
  const conflicting = new Set<string>();
  for (let first = 0; first < intervals.length; first++) {
    for (let second = first + 1; second < intervals.length; second++) {
      if (intervals[first].start < intervals[second].end && intervals[second].start < intervals[first].end) {
        conflicting.add(intervals[first].name);
        conflicting.add(intervals[second].name);
      }
    }
  }
  return intervals.filter((interval) => conflicting.has(interval.name)).map((interval) => interval.name)
    .filter((name, index, names) => names.indexOf(name) === index);
}

function activityName(snapshot: TripSnapshot, activity: Activity): string {
  return activity.title?.trim() || snapshot.places.find((place) => place.id === activity.placeId)?.name?.trim() || activity.id;
}

function bookingName(booking: Booking): string {
  return booking.title?.trim() || booking.kind.trim() || booking.id;
}

function addDuplicateNotes(notes: string[], activities: Activity[], bookings: Booking[], snapshot: TripSnapshot): void {
  const activityNames = new Set(activities.map((activity) => activityName(snapshot, activity).toLowerCase()));
  const noted = new Set<string>();
  for (const booking of bookings) {
    if (isAccommodationBooking(booking)) continue;
    const name = bookingName(booking);
    const normalized = name.toLowerCase();
    if (activityNames.has(normalized) && !noted.has(normalized)) {
      notes.push(`Possible duplicate activity/booking named "${name}".`);
      noted.add(normalized);
    }
  }
}
