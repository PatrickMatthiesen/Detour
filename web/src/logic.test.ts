import { describe, expect, it } from 'vitest';
import { localPreview } from './data';

describe('Japan 2026 preview data', () => {
  it('keeps saved ideas separate from scheduled activities', () => {
    const scheduledIds = new Set(localPreview.activities.map((activity) => activity.placeId));
    expect(localPreview.places.length).toBeGreaterThan(8);
    expect(localPreview.places.filter((place) => place.selected).map((place) => place.id)).toContain('p-ghibli');
    expect(localPreview.places.filter((place) => place.selected && !scheduledIds.has(place.id))).toHaveLength(0);
    expect(localPreview.activities).toHaveLength(1);
  });

  it('preserves uncertainty instead of inventing coordinates or duration', () => {
    const unresolved = localPreview.places.find((place) => place.name === 'Ginza Itoya');
    expect(unresolved?.latitude ?? null).toBeNull();
    expect(unresolved?.longitude ?? null).toBeNull();
    expect(unresolved?.needsResearch).toBe(true);
  });
});
