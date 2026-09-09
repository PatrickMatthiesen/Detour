import type { Stay, TripSnapshot } from "../types";
import { daySummary } from "./planning";

const DAY = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type ParsedStay = Stay & { checkIn: string; checkOut: string };

/** Shift a valid date-only value without consulting the machine's timezone. */
export function shiftDate(date: string, days: number): string {
  const parsed = parseDateOnly(date);
  if (parsed === null || !Number.isFinite(days)) return date;
  return formatDateOnly(new Date(parsed + Math.trunc(days) * DAY));
}

/** Add or replace a stay, optionally moving later stays by the checkout delta. */
export function editStayRoute(stays: Stay[], edited: Stay, shiftLater: boolean): Stay[] {
  const existingIndex = stays.findIndex((stay) => stay.id === edited.id);
  const original = existingIndex < 0 ? undefined : stays[existingIndex];
  const delta = shiftLater && original
    ? dateDifference(edited.checkOut, original.checkOut)
    : null;
  const originalCheckout = original?.checkOut;

  const result = stays.map((stay, index) => {
    if (index === existingIndex) return { ...edited };
    if (delta !== null && originalCheckout && stay.checkIn >= originalCheckout) {
      return {
        ...stay,
        checkIn: shiftDate(stay.checkIn, delta),
        checkOut: shiftDate(stay.checkOut, delta),
      };
    }
    return { ...stay };
  });
  if (existingIndex < 0) result.push({ ...edited });
  return sortStays(result);
}

/** Swap a stay with its chronological neighbour while preserving durations and gaps. */
export function reorderStayRoute(stays: Stay[], id: string, direction: -1 | 1): Stay[] {
  const route = sortStays(stays);
  const index = route.findIndex((stay) => stay.id === id);
  const neighbor = index < 0 ? -1 : index + direction;
  if (index < 0 || neighbor < 0 || neighbor >= route.length) return route;

  const earlierIndex = Math.min(index, neighbor);
  const laterIndex = Math.max(index, neighbor);
  const earlier = route[earlierIndex];
  const later = route[laterIndex];
  const earlierDuration = stayDuration(earlier);
  const laterDuration = stayDuration(later);
  const gap = dateDifference(later.checkIn, earlier.checkOut);
  if (earlierDuration === null || laterDuration === null || gap === null) return route;

  const first = {
    ...later,
    checkIn: earlier.checkIn,
    checkOut: shiftDate(earlier.checkIn, laterDuration),
  };
  const secondCheckIn = shiftDate(first.checkOut, gap);
  const second = {
    ...earlier,
    checkIn: secondCheckIn,
    checkOut: shiftDate(secondCheckIn, earlierDuration),
  };
  const reordered = [...route];
  reordered[earlierIndex] = first;
  reordered[laterIndex] = second;
  return reordered;
}

export interface StayRouteReview {
  errors: string[];
  changes: string[];
  warnings: string[];
}

/** Review a proposed stay route while leaving all activities, bookings, and travel untouched. */
export function reviewStayRoute(snapshot: TripSnapshot, proposed: Stay[]): StayRouteReview {
  const errors: string[] = [];
  const changes: string[] = [];
  const warnings: string[] = [];
  const tripStart = parseDateOnly(snapshot.trip.startDate);
  const tripEnd = parseDateOnly(snapshot.trip.endDate);
  if (tripStart === null || tripEnd === null || tripEnd < tripStart) {
    errors.push("Trip dates are invalid.");
  }

  const validProposed: ParsedStay[] = [];
  const seenIds = new Set<string>();
  for (const stay of proposed) {
    if (seenIds.has(stay.id)) errors.push(`Duplicate stay for ${cityText(stay.city)} (${stay.checkIn}–${stay.checkOut}).`);
    seenIds.add(stay.id);
    const checkIn = parseDateOnly(stay.checkIn);
    const checkOut = parseDateOnly(stay.checkOut);
    if (checkIn === null) errors.push(`Stay in ${cityText(stay.city)} has an invalid check-in date: ${stay.checkIn}.`);
    if (checkOut === null) errors.push(`Stay in ${cityText(stay.city)} has an invalid check-out date: ${stay.checkOut}.`);
    if (!stay.city?.trim()) errors.push(`Stay on ${dateText(stay.checkIn)} needs a city.`);
    if (checkIn !== null && checkOut !== null) {
      if (checkOut <= checkIn) errors.push(`Stay in ${cityText(stay.city)} must cover at least one night.`);
      if (tripStart !== null && checkIn < tripStart) errors.push(`Stay in ${cityText(stay.city)} starts before the trip: ${dateText(stay.checkIn)}.`);
      if (tripEnd !== null && checkOut > tripEnd) errors.push(`Stay in ${cityText(stay.city)} ends after the trip: ${dateText(stay.checkOut)}.`);
      validProposed.push(stay as ParsedStay);
    }
  }
  for (let first = 0; first < validProposed.length; first++) {
    const a = validProposed[first];
    const aIn = parseDateOnly(a.checkIn)!;
    const aOut = parseDateOnly(a.checkOut)!;
    if (aOut <= aIn) continue;
    for (let second = first + 1; second < validProposed.length; second++) {
      const b = validProposed[second];
      const bIn = parseDateOnly(b.checkIn)!;
      const bOut = parseDateOnly(b.checkOut)!;
      if (bOut <= bIn) continue;
      if (aIn < bOut && bIn < aOut) {
        errors.push(`Stays in ${cityText(a.city)} and ${cityText(b.city)} overlap (${formatStayDates(a)} and ${formatStayDates(b)}).`);
      }
    }
  }

  const oldById = new Map(snapshot.stays.map((stay) => [stay.id, stay]));
  const newById = new Map(proposed.map((stay) => [stay.id, stay]));
  const ids = [...new Set([...oldById.keys(), ...newById.keys()])].sort((a,b)=>(oldById.get(a)?.checkIn || newById.get(a)!.checkIn).localeCompare(oldById.get(b)?.checkIn || newById.get(b)!.checkIn));
  const affectedDates = new Set<string>();
  const affectedNightDates = new Set<string>();
  const changedOldOrNew: Stay[] = [];
  const changedRouteIds = new Set<string>();
  for (const id of ids) {
    const oldStay = oldById.get(id);
    const newStay = newById.get(id);
    if (!oldStay && newStay) {
      changes.push(`Added stay in ${cityText(newStay.city)}: ${formatStayDates(newStay)}.`);
      changedRouteIds.add(id);
      changedOldOrNew.push(newStay);
      addStayDates(newStay, affectedDates, affectedNightDates);
      continue;
    }
    if (oldStay && !newStay) {
      changes.push(`Removed stay in ${cityText(oldStay.city)}: ${formatStayDates(oldStay)}.`);
      changedOldOrNew.push(oldStay);
      changedRouteIds.add(id);
      addStayDates(oldStay, affectedDates, affectedNightDates);
      continue;
    }
    if (!oldStay || !newStay) continue;
    const cityChanged = oldStay.city.trim() !== newStay.city.trim();
    const datesChanged = oldStay.checkIn !== newStay.checkIn || oldStay.checkOut !== newStay.checkOut;
    if (datesChanged && cityChanged) changes.push(`Stay: ${cityText(oldStay.city)}, ${formatStayDates(oldStay)} → ${cityText(newStay.city)}, ${formatStayDates(newStay)}.`);
    else if (datesChanged) changes.push(`${cityText(newStay.city)}: ${formatStayDates(oldStay)} → ${formatStayDates(newStay)}.`);
    else if (cityChanged) changes.push(`Stay city: ${cityText(oldStay.city)} → ${cityText(newStay.city)} (${formatStayDates(newStay)}).`);
    if ((oldStay.name || "").trim() !== (newStay.name || "").trim()) {
      changes.push(`${cityText(newStay.city)} name: ${oldStay.name?.trim() || "(unnamed)"} → ${newStay.name?.trim() || "(unnamed)"}.`);
    }
    if (datesChanged || cityChanged) {
      changedRouteIds.add(id);
      changedOldOrNew.push(oldStay, newStay);
      addStayDates(oldStay, affectedDates, affectedNightDates);
      addStayDates(newStay, affectedDates, affectedNightDates);
    }
  }

  const reviewSnapshot: TripSnapshot = { ...snapshot, stays: proposed.map((stay) => ({ ...stay })) };
  const routeNights = validProposed.flatMap((stay) => datesInStay(stay));
  const routeNightSet = new Set(routeNights);
  const unallocated = [...affectedNightDates].filter((date) => !routeNightSet.has(date)).sort();
  if (unallocated.length) warnings.push(`Unallocated route nights: ${formatRanges(unallocated)}.`);

  const changedDates = [...affectedDates].sort();
  for (const date of changedDates) {
    const summary = daySummary(reviewSnapshot, date);
    for (const activity of summary.activities) {
      const place = activity.placeId ? snapshot.places.find((candidate) => candidate.id === activity.placeId) : undefined;
      const title = activity.title?.trim() || place?.name?.trim() || "Untitled activity";
      const stayCities = validProposed.filter((stay) => stay.checkIn <= date && date < stay.checkOut).map((stay) => cityText(stay.city));
      const distinctStayCities = [...new Set(stayCities)];
      warnings.push(`Scheduled activity "${title}" on ${formatShortDate(date)}${distinctStayCities.length ? `; stay city: ${distinctStayCities.join(", ")}` : "; city unassigned"}.`);
    }
    const hasStayCity = validProposed.some((stay) => stay.checkIn <= date && date < stay.checkOut && stay.city.trim());
    if (!hasStayCity && isWithinTrip(date, tripStart, tripEnd)) warnings.push(`City unassigned on ${formatShortDate(date)}.`);
  }

  const boundaries = new Set<string>();
  for (const stay of changedOldOrNew) {
    if (parseDateOnly(stay.checkIn) !== null) boundaries.add(stay.checkIn);
    if (parseDateOnly(stay.checkOut) !== null) boundaries.add(stay.checkOut);
  }
  for (const leg of snapshot.travelLegs) {
    if (!boundaries.has(leg.date)) continue;
    warnings.push(`Travel leg on ${formatShortDate(leg.date)}: ${leg.from} → ${leg.to}${leg.mode?.trim() ? `; ${leg.mode.trim()}` : ""}${typeof leg.durationMinutes === "number" && Number.isFinite(leg.durationMinutes) ? `; ${leg.durationMinutes} min` : ""}. Review manually; travel was left unchanged.`);
  }

  const linkedIds = new Set<string>();
  for (const stay of changedOldOrNew) if (stay.bookingId) linkedIds.add(stay.bookingId);
  const affectedBookingIds = new Set<string>();
  for (const date of changedDates) {
    for (const booking of daySummary(reviewSnapshot, date).bookings) {
      if (booking.status.trim().toLowerCase() === "confirmed") affectedBookingIds.add(booking.id);
    }
  }
  for (const booking of snapshot.bookings) {
    if (linkedIds.has(booking.id) && booking.status.trim().toLowerCase() === "confirmed") affectedBookingIds.add(booking.id);
  }
  for (const booking of snapshot.bookings) {
    if (!affectedBookingIds.has(booking.id)) continue;
    warnings.push(`Confirmed booking "${booking.title || "Untitled booking"}" remains fixed (${bookingDateText(booking, snapshot.trip.timeZone)}); review against the edited stay.`);
  }

  const linkedMismatchIds = new Set<string>();
  for (const stay of changedOldOrNew) {
    if (!stay.bookingId) continue;
    const booking = snapshot.bookings.find((candidate) => candidate.id === stay.bookingId);
    if (!booking || stay.city.trim() === (oldById.get(stay.id)?.city.trim() || "")) continue;
    if (linkedMismatchIds.has(booking.id)) continue;
    linkedMismatchIds.add(booking.id);
    const location = booking.location?.trim();
    warnings.push(location
      ? `Linked booking "${booking.title || "Untitled booking"}" location "${location}" may mismatch edited stay city "${stay.city}"; booking remains fixed.`
      : `Linked booking "${booking.title || "Untitled booking"}" remains fixed while the stay city changes to "${stay.city}"; check the city mismatch.`);
  }

  const oldRoute = sortStays(snapshot.stays);
  const oldPairs = new Set(oldRoute.slice(1).map((stay, index) => `${oldRoute[index].id}\u0000${stay.id}`));
  const proposedRoute = sortStays(proposed);
  const warnedPairs = new Set<string>();
  for (let index = 1; index < proposedRoute.length; index++) {
    const previous = proposedRoute[index - 1];
    const current = proposedRoute[index];
    if (!previous.city.trim() || !current.city.trim() || previous.city.trim() === current.city.trim()) continue;
    const pairKey = `${previous.id}\u0000${current.id}`;
    if (oldPairs.has(pairKey) && !changedRouteIds.has(previous.id) && !changedRouteIds.has(current.id)) continue;
    if (warnedPairs.has(pairKey) || hasMatchingTravel(snapshot, previous.city, current.city, previous.checkOut, current.checkIn)) continue;
    warnedPairs.add(pairKey);
    warnings.push(`Route link needs planning: ${previous.city} → ${current.city} around ${formatShortDate(previous.checkOut)}; no matching travel leg is recorded.`);
  }

  const uncovered = [...affectedNightDates].filter((date) => routeNightSet.has(date) && !daySummary(reviewSnapshot, date).accommodationCovered).sort();
  if (uncovered.length) warnings.push(`Uncovered accommodation nights: ${formatRanges(uncovered)}.`);
  return { errors, changes, warnings };
}

function parseDateOnly(value: string | null | undefined): number | null {
  if (!value || !DATE_ONLY.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, month - 1, day);
  return result.getUTCFullYear() === year && result.getUTCMonth() === month - 1 && result.getUTCDate() === day
    ? result.getTime() : null;
}

function formatDateOnly(value: Date): string {
  return `${value.getUTCFullYear().toString().padStart(4, "0")}-${(value.getUTCMonth() + 1).toString().padStart(2, "0")}-${value.getUTCDate().toString().padStart(2, "0")}`;
}

function dateDifference(later: string, earlier: string): number | null {
  const laterDate = parseDateOnly(later);
  const earlierDate = parseDateOnly(earlier);
  if (laterDate === null || earlierDate === null) return null;
  return Math.round((laterDate - earlierDate) / DAY);
}

function stayDuration(stay: Stay): number | null {
  const duration = dateDifference(stay.checkOut, stay.checkIn);
  return duration !== null && duration >= 0 ? duration : null;
}

function sortStays(stays: Stay[]): Stay[] {
  return stays.map((stay) => ({ ...stay })).sort((first, second) => {
    const byDate = first.checkIn.localeCompare(second.checkIn);
    return byDate || first.id.localeCompare(second.id);
  });
}

function datesInStay(stay: Stay): string[] {
  const duration = stayDuration(stay);
  if (duration === null || duration < 1) return [];
  return Array.from({ length: duration }, (_, index) => shiftDate(stay.checkIn, index));
}

function addStayDates(stay: Stay, allDates: Set<string>, nightDates: Set<string>): void {
  const checkIn = parseDateOnly(stay.checkIn);
  const checkOut = parseDateOnly(stay.checkOut);
  if (checkIn === null || checkOut === null || checkOut < checkIn) return;
  const duration = Math.round((checkOut - checkIn) / DAY);
  for (let index = 0; index <= duration; index++) allDates.add(shiftDate(stay.checkIn, index));
  for (const date of datesInStay(stay)) nightDates.add(date);
}

function isWithinTrip(date: string, start: number | null, end: number | null): boolean {
  const value = parseDateOnly(date);
  return value !== null && start !== null && end !== null && value >= start && value <= end;
}

function cityText(city: string | null | undefined): string {
  return city?.trim() || "(unassigned)";
}

function formatRanges(dates: string[]): string {
  const sorted = [...new Set(dates)].sort();
  const ranges: Array<[string, string]> = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let index = 1; index < sorted.length; index++) {
    if (shiftDate(end, 1) === sorted[index]) end = sorted[index];
    else {
      ranges.push([start, end]);
      start = sorted[index];
      end = sorted[index];
    }
  }
  if (start) ranges.push([start, end]);
  return ranges.map(([rangeStart, rangeEnd]) => formatDateRange(rangeStart, rangeEnd)).join(", ");
}

function bookingDateText(booking: TripSnapshot["bookings"][number], timeZone: string | null | undefined): string {
  if (booking.checkIn || booking.checkOut) return `${bookingDateValue(booking.checkIn, timeZone)} → ${bookingDateValue(booking.checkOut, timeZone)}`;
  if (booking.start && booking.end) return `${bookingDateValue(booking.start, timeZone)} → ${bookingDateValue(booking.end, timeZone)}`;
  if (booking.start || booking.end) return bookingDateValue(booking.start || booking.end, timeZone);
  if (booking.date) return bookingDateValue(booking.date, timeZone);
  return "dates unavailable";
}

function bookingDateValue(value: string | null | undefined, timeZone: string | null | undefined): string {
  if (!value) return "?";
  if (parseDateOnly(value) !== null) return formatShortDate(value);
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return value;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone?.trim() || "Asia/Tokyo",
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(instant));
  } catch {
    return value;
  }
}

function formatStayDates(stay: Stay): string {
  return formatDateRange(stay.checkIn, stay.checkOut);
}

function dateText(value: string): string {
  return parseDateOnly(value) === null ? value : formatShortDate(value);
}

function formatShortDate(value: string): string {
  const parsed = parseDateOnly(value);
  if (parsed === null) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(parsed));
}

function formatDateRange(start: string, end: string): string {
  const startDate = parseDateOnly(start);
  const endDate = parseDateOnly(end);
  if (startDate === null || endDate === null) return `${dateText(start)}–${dateText(end)}`;
  const first = new Date(startDate);
  const last = new Date(endDate);
  const firstMonth = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(first);
  const lastMonth = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(last);
  if (first.getUTCFullYear() === last.getUTCFullYear() && first.getUTCMonth() === last.getUTCMonth()) {
    return `${first.getUTCDate()}–${last.getUTCDate()} ${firstMonth}`;
  }
  return `${first.getUTCDate()} ${firstMonth}–${last.getUTCDate()} ${lastMonth}`;
}

function hasMatchingTravel(snapshot: TripSnapshot, from: string, to: string, ...dates: string[]): boolean {
  const fromValue = from.trim();
  const toValue = to.trim();
  return snapshot.travelLegs.some((leg) => dates.includes(leg.date) && leg.from.trim() === fromValue && leg.to.trim() === toValue);
}
