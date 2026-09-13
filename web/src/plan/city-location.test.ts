import { describe, expect, it } from 'vitest';
import { cityMapCenter, stayCityError, unresolvedRouteCities } from './city-location';
import { reviewStayRoute } from './stay-editing';
import type { Place, TripSnapshot } from '../types';

describe('stay locations', () => {
  it.each(['Osaka / Kyoto', 'Tokyo / Haneda', 'Tokyo and Kyoto', 'Tokyo + Kyoto', 'Tokyo; Kyoto'])('rejects combined destinations: %s', city => {
    const places: Place[] = [{id:'p', name:'Place', city, latitude:35, longitude:139}];
    expect(cityMapCenter(city, places)).toBeUndefined();
    expect(stayCityError(city, places)).toContain('one city or city area');
  });

  it('accepts known cities and a single area anchored to a mapped place', () => {
    expect(cityMapCenter('Osaka', [])).toEqual([135.502, 34.694]);
    expect(cityMapCenter('Nikkō', [])).toEqual(cityMapCenter('Nikko', []));
    expect(cityMapCenter(' Shinjuku ', [{id:'p',name:'Place',city:'Shinjuku',latitude:35.69,longitude:139.7}])).toEqual([139.7,35.69]);
    expect(cityMapCenter('Shinjuku', [{id:'p',name:'Place',city:'Shinjuku',latitude:100,longitude:139.7}])).toBeUndefined();
    expect(cityMapCenter('toString', [])).toBeUndefined();
  });

  it('identifies unresolved stops without joining across them', () => {
    expect(unresolvedRouteCities([{city:'Tokyo'},{city:'Tokyo / Haneda'},{city:'Tokyo / Haneda'},{city:'Osaka'}], [])).toEqual(['Tokyo / Haneda']);
  });

  it('blocks newly unresolved locations but warns about unchanged legacy stays', () => {
    const current = {id:'s',city:'Tokyo / Haneda',checkIn:'2026-10-01',checkOut:'2026-10-02'};
    const snapshot: TripSnapshot = {version:1,trip:{id:'t',name:'Trip',startDate:'2026-10-01',endDate:'2026-10-05',timeZone:'Asia/Tokyo'},stays:[current],places:[],bookings:[],travelLegs:[],activities:[],tasks:[],packingItems:[]};
    const legacy = reviewStayRoute(snapshot, [{...current,name:'Updated label'}]);
    expect(legacy.errors).toEqual([]);
    expect(legacy.warnings.join(' ')).toContain('one city or city area');
    expect(reviewStayRoute(snapshot,[{...current,city:'Unknown destination'}]).errors.join(' ')).toContain('Cannot locate');
    expect(reviewStayRoute(snapshot,[{...current,city:'Tokyo'}]).errors).toEqual([]);
  });
});
