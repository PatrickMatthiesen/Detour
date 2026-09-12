import type { TripSnapshot } from "../types";

export type PlanningStatus = "saved" | "picked" | "partial" | "booked";

export const STATUS_COLORS: Record<PlanningStatus, string> = {
  saved: "#64748b",
  picked: "#b94f3f",
  partial: "#996b17",
  booked: "#287052",
};

export interface RouteStop {
  city: string;
  checkIn: string;
  checkOut: string;
  status: PlanningStatus;
  bookedNights: number;
  totalNights: number;
  label: string;
  detail: string;
}

type Stay = TripSnapshot["stays"][number];
type Booking = TripSnapshot["bookings"][number];

interface ParsedRange {
  start: number;
  end: number;
}

interface StopGroup {
  city: string;
  cityKey: string;
  checkIn: string;
  checkOut: string;
  range: ParsedRange | null;
  stays: Stay[];
}

const DAY = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ACCOMMODATION_KINDS = new Set(["hotel", "accommodation", "ryokan"]);

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const timestamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(timestamp);
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3])
    ? timestamp
    : null;
}

function parseRange(checkIn: string | null | undefined, checkOut: string | null | undefined): ParsedRange | null {
  const start = parseDate(checkIn);
  const end = parseDate(checkOut);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

function normalizeCity(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().normalize("NFC").toLocaleLowerCase("en-US");
  return normalized === "nikkō" ? "nikko" : normalized;
}

function nightsInRange(range: ParsedRange | null): Set<number> {
  const nights = new Set<number>();
  if (!range) return nights;
  for (let night = range.start; night < range.end; night += DAY) nights.add(night);
  return nights;
}

function intersectRanges(left: ParsedRange | null, right: ParsedRange | null): ParsedRange | null {
  if (!left || !right) return null;
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return end > start ? { start, end } : null;
}

function isCancelled(status: string | null | undefined): boolean {
  const normalized = (status ?? "").trim().toLocaleLowerCase("en-US");
  return normalized === "cancelled" || normalized === "canceled";
}

function groupStays(stays: Stay[]): StopGroup[] {
  const sorted = stays
    .map((stay, index) => ({ stay, index, start: parseDate(stay.checkIn) }))
    .sort((left, right) => {
      if (left.start === null && right.start === null) return left.index - right.index;
      if (left.start === null) return 1;
      if (right.start === null) return -1;
      return left.start - right.start || left.index - right.index;
    });

  const groups: StopGroup[] = [];
  for (const { stay } of sorted) {
    const range = parseRange(stay.checkIn, stay.checkOut);
    const cityKey = normalizeCity(stay.city);
    const previous = groups.at(-1);
    const canMerge = previous
      && previous.range
      && range
      && previous.cityKey === cityKey
      && range.start <= previous.range.end;

    if (canMerge && previous) {
      previous.stays.push(stay);
      if (range.end > previous.range!.end) {
        previous.range!.end = range.end;
        previous.checkOut = stay.checkOut;
      }
      continue;
    }

    groups.push({
      city: stay.city.trim() || stay.city,
      cityKey,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      range,
      stays: [stay],
    });
  }
  return groups;
}

function bookingMatchesGroup(
  booking: Booking,
  group: StopGroup,
  linkedIds: Set<string>,
  knownCityKeys: Set<string>,
): boolean {
  if (booking.status.trim().toLocaleLowerCase("en-US") !== "confirmed") return false;
  if (!ACCOMMODATION_KINDS.has(booking.kind.trim().toLocaleLowerCase("en-US"))) return false;

  const locationKey = normalizeCity(booking.location);
  const matchingLocation = locationKey.length > 0 && locationKey === group.cityKey;
  const conflictingLocation = locationKey.length > 0
    && locationKey !== group.cityKey
    && knownCityKeys.has(locationKey);
  return matchingLocation || (linkedIds.has(booking.id) && !conflictingLocation);
}

function statusCopy(bookedNights: number, totalNights: number): Pick<RouteStop, "status" | "label" | "detail"> {
  const detail = totalNights > 0
    ? `${bookedNights} of ${totalNights} nights booked`
    : "Stay dates need checking";
  if (totalNights > 0 && bookedNights >= totalNights) return { status: "booked", label: "Booked", detail };
  if (bookedNights > 0) return { status: "partial", label: "Partly booked", detail };
  return { status: "picked", label: "Not booked", detail };
}

export function buildRouteStops(trip: TripSnapshot | null): RouteStop[] {
  if (!trip) return [];

  const stays = trip.stays.filter((stay) => !isCancelled(stay.status));
  const knownCityKeys = new Set(stays.map((stay) => normalizeCity(stay.city)).filter(Boolean));

  return groupStays(stays).map((group) => {
    const stayNights = nightsInRange(group.range);
    const linkedIds = new Set(group.stays.flatMap((stay) => stay.bookingId ? [stay.bookingId] : []));
    const coveredNights = new Set<number>();

    for (const booking of trip.bookings) {
      if (!bookingMatchesGroup(booking, group, linkedIds, knownCityKeys)) continue;
      const bookingNights = nightsInRange(
        intersectRanges(group.range, parseRange(booking.checkIn, booking.checkOut)),
      );
      for (const night of bookingNights) if (stayNights.has(night)) coveredNights.add(night);
    }

    const bookedNights = coveredNights.size;
    const totalNights = stayNights.size;
    return {
      city: group.city,
      checkIn: group.checkIn,
      checkOut: group.checkOut,
      bookedNights,
      totalNights,
      ...statusCopy(bookedNights, totalNights),
    };
  });
}

export function summarizeCityStops(
  stops: RouteStop[],
): Record<string, { status: PlanningStatus; label: string; detail: string }> {
  const cities = new Map<string, {
    displayCities: Set<string>;
    stopCount: number;
    bookedStops: number;
    bookedNights: number;
    totalNights: number;
  }>();

  for (const stop of stops) {
    const cityKey = normalizeCity(stop.city);
    const existing = cities.get(cityKey) ?? {
      displayCities: new Set<string>(),
      stopCount: 0,
      bookedStops: 0,
      bookedNights: 0,
      totalNights: 0,
    };
    existing.displayCities.add(stop.city);
    const totalNights = Number.isFinite(stop.totalNights) ? Math.max(0, stop.totalNights) : 0;
    const bookedNights = Number.isFinite(stop.bookedNights)
      ? Math.min(totalNights, Math.max(0, stop.bookedNights))
      : 0;
    existing.stopCount += 1;
    existing.bookedStops += totalNights > 0 && bookedNights === totalNights ? 1 : 0;
    existing.bookedNights += bookedNights;
    existing.totalNights += totalNights;
    cities.set(cityKey, existing);
  }

  const summary: Record<string, { status: PlanningStatus; label: string; detail: string }> = {};
  for (const city of cities.values()) {
    const allStopsBooked = city.stopCount > 0 && city.bookedStops === city.stopCount && city.totalNights > 0;
    const status: PlanningStatus = allStopsBooked ? "booked" : city.bookedNights > 0 ? "partial" : "picked";
    const aggregate = {
      status,
      label: status === "booked" ? "Booked" : status === "partial" ? "Partly booked" : "Not booked",
      detail: `${city.bookedStops} of ${city.stopCount} stays booked · ${city.bookedNights} of ${city.totalNights} nights booked`,
    };
    for (const displayCity of city.displayCities) summary[displayCity] = aggregate;
  }
  return summary;
}
