import { describe, expect, it } from 'vitest';
import { buildWindows, readForm, trackManIndices, windowableClubs } from './windows.js';
import { parseConditions } from '../benchmarks/conditions.js';
import type { Shot, ShotSession } from '../schema.js';

function shot(i: number, over: Partial<Shot> = {}): Shot {
  return {
    id: `s${i}`, source: 'trackman-csv', time: null, club: '7i',
    clubSpeed: 87, ballSpeed: 115, smashFactor: 1.32, attackAngle: -3.4, clubPath: 0.2,
    faceAngle: 0.3, faceToPath: 0.1, dynamicLoft: 25, spinLoft: 28, lowPointDistance: 3,
    impactOffset: null, impactHeight: null, launchAngle: 17, launchDirection: 0.3,
    spinRate: 6800, spinAxis: 0, carry: 169, total: 178, side: 0, curve: 0,
    apexHeight: 30, landingAngle: 47, targetDistance: null, proximity: null, shotScore: null,
    spinMeasured: true, smashIndex: null, spinIndex: null,
    lowPointSide: null, swingRadius: null, dynamicLie: null, flags: [],
    ...over,
  } as Shot;
}

function session(id: string, daysAgo: number, shots: Shot[], conditionLine?: string): ShotSession {
  return {
    id, source: 'trackman-csv', kind: 'range', sourceRef: id, handedness: 'right',
    startedAt: new Date(Date.now() - daysAgo * 86_400_000),
    conditions: conditionLine ? parseConditions(conditionLine) : undefined,
    shots,
  };
}

/** Alternating ±s so the robust spread is predictable. */
const spread = (s: number) => (i: number) => ({ carry: 169 + (i % 2 ? s : -s) });

describe('shot windows', () => {
  it('takes the most recent shots first', () => {
    const old = session('old', 60, Array.from({ length: 20 }, (_, i) => shot(i, spread(14)(i))));
    const recent = session('new', 1, Array.from({ length: 20 }, (_, i) => shot(i, spread(2)(i))));
    const w = buildWindows([old, recent], '7i');

    const last20 = w.find((x) => x.window.id === 'last20')!.profile!;
    const lifetime = w.find((x) => x.window.id === 'lifetime')!.profile!;
    // The recent tight session should dominate the short window and not the long one.
    expect(last20.carry.mad).toBeLessThan(lifetime.carry.mad);
    expect(lifetime.representativeCount).toBeGreaterThan(last20.representativeCount);
  });

  it('keeps a 60-day-old session out of the 30-day window', () => {
    const old = session('old', 60, Array.from({ length: 20 }, (_, i) => shot(i)));
    const recent = session('new', 2, Array.from({ length: 8 }, (_, i) => shot(i)));
    const w = buildWindows([old, recent], '7i');
    expect(w.find((x) => x.window.id === 'days30')!.profile!.representativeCount).toBe(8);
    expect(w.find((x) => x.window.id === 'lifetime')!.profile!.representativeCount).toBe(28);
  });

  it('puts every window into common air before comparing', () => {
    /*
     * The *same swing* at two venues, which means two different measured
     * carries: 169 at sea level is 179 at 4,700 feet. Without normalisation
     * the mountain session looks like ten yards of improvement that never
     * happened.
     *
     * Note the fixture has to inflate the number itself. An earlier version of
     * this test gave both venues a measured 169 and expected them to match
     * after correction — but two identical readings at different altitudes are
     * two different swings, and the engine was right to say so.
     */
    const sea = session('sea', 40, Array.from({ length: 20 }, (_, i) => shot(i)),
      'normalized at 0 ft altitude, 70 F');
    const high = session('high', 1,
      Array.from({ length: 20 }, (_, i) => shot(i, { carry: 169 * 1.0604, total: 178 * 1.0604 })),
      'normalized at 4700 ft altitude, 77 F');
    const w = buildWindows([sea, high], '7i');
    const recent = w.find((x) => x.window.id === 'last20')!.profile!;
    const lifetime = w.find((x) => x.window.id === 'lifetime')!.profile!;
    // Same swing at both venues, so carry must read the same after correction.
    expect(Math.abs(recent.carry.median - lifetime.carry.median)).toBeLessThan(1);
  });

  it('separates a bad day from a new normal', () => {
    const history = session('old', 40, Array.from({ length: 40 }, (_, i) => shot(i, spread(3)(i))));
    const today = session('new', 0, Array.from({ length: 20 }, (_, i) => shot(i, spread(15)(i))));
    const form = readForm(buildWindows([history, today], '7i'));
    const distance = form.find((f) => f.metric === 'carrySpread')!;
    expect(distance.verdict).toBe('rusty');
    expect(distance.recent).toBeGreaterThan(distance.baseline);
  });

  it('calls it flat when the change is inside the noise floor', () => {
    const a = session('a', 40, Array.from({ length: 40 }, (_, i) => shot(i, spread(5)(i))));
    const b = session('b', 0, Array.from({ length: 20 }, (_, i) => shot(i, spread(5)(i))));
    expect(readForm(buildWindows([a, b], '7i')).every((f) => f.verdict === 'flat')).toBe(true);
  });

  it('needs enough shots before it offers a club at all', () => {
    const thin = session('t', 1, Array.from({ length: 4 }, (_, i) => shot(i)));
    expect(windowableClubs([thin])).toEqual([]);
    const thick = session('k', 1, Array.from({ length: 20 }, (_, i) => shot(i)));
    expect(windowableClubs([thick])).toEqual(['7i']);
  });
});

describe("TrackMan's own indices", () => {
  it('reports the median where the export carries them', () => {
    const shots = Array.from({ length: 10 }, (_, i) => shot(i, { smashIndex: 100 + i }));
    const idx = trackManIndices(shots);
    expect(idx.smashIndex).toBeCloseTo(104.5, 1);
    expect(idx.smashCount).toBe(10);
  });

  it('stays silent on too thin a sample rather than guessing', () => {
    // The real export carries a spin index on two shots out of forty-five.
    const shots = Array.from({ length: 45 }, (_, i) => shot(i, { spinIndex: i < 2 ? 55 : null }));
    expect(trackManIndices(shots).spinIndex).toBeNull();
    expect(trackManIndices(shots).spinCount).toBe(2);
  });
});
