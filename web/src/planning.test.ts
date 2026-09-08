import { describe, expect, it } from 'vitest';
import { bookedNights, calendarDays, dayCapacity, lodgingSummary, selectedUnscheduled } from './planning';
import type { TripSnapshot } from './types';

function trip(): TripSnapshot {
  return { version: 1, trip: { id: 'japan', name: 'Japan', startDate: '2026-09-30', endDate: '2026-10-25',
    arrival: { airport: 'HND', date: '2026-10-02' }, departure: { airport: 'HND', date: '2026-10-25' } },
    places: [], activities: [], travelLegs: [], stays: [], bookings: [], tasks: [], packingItems: [] };
}

describe('calendar and accommodation', () => {
  it('keeps calendar dates across daylight-saving transitions', () => {
    expect(calendarDays('2026-10-24', '2026-10-26')).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(calendarDays('2026-10-26', '2026-10-24')).toEqual([]);
  });
  it('deduplicates confirmed hotel nights and excludes checkout and cancelled bookings', () => {
    expect([...bookedNights([
      { id: 'a', kind: 'hotel', title: 'A', status: 'confirmed', checkIn: '2026-10-02', checkOut: '2026-10-04' },
      { id: 'b', kind: 'hotel', title: 'B', status: 'confirmed', checkIn: '2026-10-03', checkOut: '2026-10-04' },
      { id: 'c', kind: 'hotel', title: 'C', status: 'cancelled', checkIn: '2026-10-04', checkOut: '2026-10-06' },
    ])]).toEqual(['2026-10-02', '2026-10-03']);
  });
  it('does not count planned city allocations as booked hotels or add a departure-night stay', () => {
    const state = trip();
    state.stays.push({ id: 'stay', city: 'Tokyo', checkIn: '2026-10-02', checkOut: '2026-10-25' });
    const result = lodgingSummary(state);
    expect(result.covered).toEqual([]);
    expect(result.uncovered).toHaveLength(23);
    expect(result.nights.at(-1)).toBe('2026-10-24');
  });
});

describe('daily planning', () => {
  it('includes all travel legs and preserves unknown capacity as an upper bound', () => {
    const state = trip();
    state.places.push({ id: 'p', name: 'Museum', city: 'Tokyo', selected: true, durationMinutes: 120 });
    state.activities.push({ id: 'a', placeId: 'p', date: '2026-10-03' }, { id: 'b', placeId: null, date: '2026-10-03' });
    state.travelLegs.push({ id: 't', from: 'A', to: 'B', date: '2026-10-03', durationMinutes: 60 },
      { id: 'u', from: 'B', to: 'C', date: '2026-10-03', durationMinutes: 45 });
    expect(dayCapacity(state, '2026-10-03')).toMatchObject({ allocatedMinutes: 225, remainingMinutes: 255, unknownCount: 1, isUpperBound: true });
    expect(selectedUnscheduled(state)).toHaveLength(0);
    state.activities[0].status = 'cancelled';
    expect(selectedUnscheduled(state).map(p => p.id)).toEqual(['p']);
  });
  it('detects overlaps but permits activities that meet at a boundary', () => {
    const state = trip();
    state.activities.push(
      { id: 'a', placeId: null, date: '2026-10-03', startTime: '10:00', durationMinutes: 60 },
      { id: 'b', placeId: null, date: '2026-10-03', startTime: '11:00', durationMinutes: 60 },
      { id: 'c', placeId: null, date: '2026-10-03', startTime: '11:30', durationMinutes: 60 });
    expect(dayCapacity(state, '2026-10-03', 120)).toMatchObject({ overlaps: [['b', 'c']], overCapacityMinutes: 60, remainingMinutes: 0 });
  });
});
