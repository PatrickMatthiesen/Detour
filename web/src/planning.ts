import type { Booking, TripSnapshot } from './types';

const DAY = 86_400_000;
export function calendarDays(start: string, end: string): string[] {
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [];
  return Array.from({ length: Math.min(3660, Math.floor((last - first) / DAY) + 1) },
    (_, index) => new Date(first + index * DAY).toISOString().slice(0, 10));
}

export function bookedNights(bookings: Booking[]): Set<string> {
  const nights = new Set<string>();
  for (const booking of bookings) {
    if (booking.kind !== 'hotel' || booking.status !== 'confirmed' || !booking.checkIn || !booking.checkOut) continue;
    for (const night of calendarDays(booking.checkIn, booking.checkOut).slice(0, -1)) nights.add(night);
  }
  return nights;
}

export function lodgingSummary(snapshot: TripSnapshot) {
  // A coverage gap is a night to review, not proof that another hotel must be bought.
  // Midnight flights and overnight transport can intentionally leave a night unbooked.
  const nights = calendarDays(snapshot.trip.arrival?.date ?? snapshot.trip.startDate,
    snapshot.trip.departure?.date ?? snapshot.trip.endDate).slice(0, -1);
  const booked = bookedNights(snapshot.bookings);
  return { nights, covered: nights.filter(date => booked.has(date)), uncovered: nights.filter(date => !booked.has(date)) };
}

export function dayCapacity(snapshot: TripSnapshot, date: string, capacityMinutes = 480) {
  const activities = snapshot.activities.filter(item => item.date === date && item.status !== 'cancelled');
  const travel = snapshot.travelLegs.filter(item => item.date === date);
  const duration = (item: typeof activities[number]) => item.durationMinutes ??
    snapshot.places.find(place => place.id === item.placeId)?.durationMinutes ?? null;
  const known = [...activities.map(duration), ...travel.map(item => item.durationMinutes ?? null)];
  const allocatedMinutes = known.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const unknownCount = known.filter(value => value === null).length;
  const overlaps: string[][] = [];
  const timed = activities.flatMap(item => {
    if (!item.startTime) return [];
    const minutes = duration(item);
    if (minutes === null) return [];
    const [hours, mins] = item.startTime.split(':').map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(mins)) return [];
    return [{ id: item.id, start: hours * 60 + mins, end: hours * 60 + mins + minutes }];
  });
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[i].start < timed[j].end && timed[j].start < timed[i].end) overlaps.push([timed[i].id, timed[j].id]);
    }
  }
  return {
    allocatedMinutes, unknownCount,
    remainingMinutes: Math.max(0, capacityMinutes - allocatedMinutes),
    overCapacityMinutes: Math.max(0, allocatedMinutes - capacityMinutes),
    // Remaining is an upper bound when durations are missing, never guaranteed free time.
    isUpperBound: unknownCount > 0, overlaps,
  };
}

export function selectedUnscheduled(snapshot: TripSnapshot) {
  const scheduled = new Set(snapshot.activities.filter(item => item.status !== 'cancelled').map(item => item.placeId));
  return snapshot.places.filter(place => place.selected && !scheduled.has(place.id));
}
