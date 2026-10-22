import { describe, expect, it } from 'vitest';
import { buildClubProfiles } from '../stats/dispersion.js';
import { carryConsistencyRule } from './rules-spin.js';
import { speedAdjustedEfficiencyRule } from './rules-delivery.js';
import type { Club, Shot } from '../schema.js';

function shot(i: number, o: { club?: Club; carry: number; clubSpeed?: number; smash?: number }): Shot {
  const speed = o.clubSpeed ?? 92;
  const smash = o.smash ?? 1.34;
  return {
    id: `s${i}`, source: 'trackman-csv', time: null, club: o.club ?? '7i',
    clubSpeed: speed, ballSpeed: speed * smash, smashFactor: smash, attackAngle: -3,
    clubPath: 0, faceAngle: 0, faceToPath: 0, dynamicLoft: 25, spinLoft: 28,
    lowPointDistance: 3, impactOffset: 0, impactHeight: 0, launchAngle: 17,
    launchDirection: 0, spinRate: 6800, spinAxis: 0, carry: o.carry, total: o.carry + 8,
    side: 0, curve: 0, apexHeight: 30, landingAngle: 47, targetDistance: null,
    proximity: null, shotScore: null, spinMeasured: true, smashIndex: null,
    spinIndex: null, lowPointSide: null, swingRadius: null, dynamicLie: null, flags: [],
  } as Shot;
}

function profileOf(shots: Shot[]) {
  const profiles = buildClubProfiles(shots);
  return { profile: profiles[0]!, allProfiles: profiles };
}

/** Symmetric carries around a median, so the scaled MAD is 1.4826 x the offset. */
const carries = (median: number, offset: number) =>
  Array.from({ length: 12 }, (_, i) => median + (i % 2 === 0 ? offset : -offset));

describe('carry consistency', () => {
  it('does not call a tour-level spread unpredictable', () => {
    // 4.6% of carry is the app's own tour standard; the old rule fired at 4.5%.
    const ctx = profileOf(carries(150, 4.6).map((c, i) => shot(i, { carry: c })));
    expect(carryConsistencyRule.run(ctx)).toEqual([]);
  });

  it('still flags a genuinely wide spread', () => {
    const ctx = profileOf(carries(150, 10).map((c, i) => shot(i, { carry: c })));
    const [f] = carryConsistencyRule.run(ctx);
    expect(f?.id).toBe('carry-inconsistent');
  });
});

describe('yards left in the strike', () => {
  it('comes from the missing ball speed and is never negative', () => {
    // Smash 1.25 against a 1.34 tour 7-iron at 92 mph. The carry is deliberately
    // long, as it would be at altitude: the old carry-gap arithmetic then went negative.
    const ctx = profileOf(carries(190, 2).map((c, i) => shot(i, { carry: c, smash: 1.25 })));
    const [f] = speedAdjustedEfficiencyRule.run(ctx);
    expect(f).toBeDefined();
    const yards = Number(/about (\d+) yards/.exec(f!.title)?.[1]);
    expect(yards).toBeGreaterThan(10);
    expect(yards).toBeLessThan(25);
  });

  it('stays quiet when the strike is already tour quality', () => {
    const ctx = profileOf(carries(176, 2).map((c, i) => shot(i, { carry: c, smash: 1.33 })));
    expect(speedAdjustedEfficiencyRule.run(ctx)).toEqual([]);
  });
});
