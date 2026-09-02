import { describe, expect, it } from 'vitest';
import { aimValue } from './aim.js';
import type { ClubProfile } from '../stats/dispersion.js';
import type { Club } from '../schema.js';

/** Only the fields `aimValue` reads; the rest of a profile is irrelevant here. */
function profile(club: Club, over: {
  carry?: number; sideMedian?: number; sideMad?: number; carryMad?: number; n?: number;
} = {}): ClubProfile {
  const n = over.n ?? 20;
  return {
    club,
    representativeCount: n,
    carry: { n, median: over.carry ?? 170, mad: over.carryMad ?? 9, min: 0, max: 0, p25: 0, p75: 0, mean: 0 },
    side: { n, median: over.sideMedian ?? 0, mad: over.sideMad ?? 12, min: 0, max: 0, p25: 0, p75: 0, mean: 0 },
  } as unknown as ClubProfile;
}

describe('what aiming is worth', () => {
  it('finds nothing to gain when the pattern is already centred', () => {
    const v = aimValue([profile('7i', { sideMedian: 0 })]);
    expect(v.worthSaying).toBe(false);
    expect(v.strokesFromAim).toBeCloseTo(0, 2);
    expect(v.headline).toMatch(/already centred/i);
  });

  it('prices an offset pattern and says which way to move', () => {
    const v = aimValue([profile('7i', { sideMedian: 12.5, carry: 175, sideMad: 12.6, carryMad: 9.2 })]);
    expect(v.worthSaying).toBe(true);
    expect(v.worst!.moveSide).toBe('left');
    expect(v.worst!.moveYards).toBeCloseTo(12.5, 1);
    expect(v.strokesFromAim).toBeGreaterThan(3);
  });

  it('mirrors for a pattern that sits left', () => {
    const right = aimValue([profile('7i', { sideMedian: 12.5 })]);
    const left = aimValue([profile('7i', { sideMedian: -12.5 })]);
    expect(left.worst!.moveSide).toBe('right');
    expect(left.strokesFromAim).toBeCloseTo(right.strokesFromAim, 6);
  });

  it('never claims aiming makes a pattern worse', () => {
    for (const offset of [-30, -12, -4, 0, 4, 12, 30]) {
      const v = aimValue([profile('7i', { sideMedian: offset })]);
      for (const c of v.clubs) {
        expect(c.aimed).toBeLessThanOrEqual(c.asPlayed + 1e-9);
        expect(c.greenAimed).toBeGreaterThanOrEqual(c.greenNow - 1e-9);
      }
    }
  });

  it('keeps the share of cost inside nought and one', () => {
    for (const offset of [0, 5, 15, 40]) {
      for (const mad of [3, 12, 25]) {
        const v = aimValue([profile('7i', { sideMedian: offset, sideMad: mad })]);
        expect(v.shareOfCost).toBeGreaterThanOrEqual(0);
        expect(v.shareOfCost).toBeLessThanOrEqual(1);
      }
    }
  });

  it('stays quiet about an offset nobody could aim to anyway', () => {
    // Three yards at 170 is under a degree and a half; telling somebody to
    // shift their alignment by that is noise dressed as insight.
    expect(aimValue([profile('7i', { sideMedian: 3 })]).worthSaying).toBe(false);
  });

  it('refuses to place a pattern centre from a handful of shots', () => {
    const v = aimValue([profile('7i', { sideMedian: 20, n: 5 })]);
    expect(v.clubs).toHaveLength(0);
    expect(v.worthSaying).toBe(false);
  });

  it('weights the bag by shots and leads on the club with most to gain', () => {
    const v = aimValue([
      profile('PW', { sideMedian: 2, n: 30, carry: 120 }),
      profile('7i', { sideMedian: 18, n: 10, carry: 170 }),
    ]);
    expect(v.worst!.club).toBe('7i');
    // The wedge is straight and outnumbers it three to one, so the bag figure
    // has to land well below the 7-iron's own.
    const sevenGain = v.clubs.find((c) => c.club === '7i')!;
    expect(v.strokesFromAim).toBeLessThan(sevenGain.asPlayed - sevenGain.aimed);
  });

  it('tells the player not to rebuild their alignment on one session', () => {
    const v = aimValue([profile('7i', { sideMedian: 14 })]);
    expect(v.detail).toMatch(/second session/i);
  });
});
