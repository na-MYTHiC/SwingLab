import { describe, expect, it } from 'vitest';
import { scoreSession } from './score.js';
import { personalOptimals, compareToOptimal } from '../benchmarks/personal.js';
import type { ClubProfile } from '../stats/dispersion.js';
import type { StrikeBreakdown } from '../analysis/strike.js';

function summary(median: number, mad: number, n = 30) {
  return { n, median, mad, min: median - mad, max: median + mad, p25: median, p75: median, mean: median };
}

function profile(carry = 170, sideMad = 12): ClubProfile {
  const blank = summary(0, 0);
  return {
    club: '7i', shotCount: 30, representativeCount: 30, mishitCount: 0, mishitRate: 0,
    distinctTargets: 0,
    clubSpeed: summary(87, 2), attackAngle: blank, clubPath: blank, faceAngle: blank,
    faceToPath: blank, dynamicLoft: blank, spinLoft: blank, lowPointDistance: blank,
    impactOffset: blank, impactHeight: blank, ballSpeed: blank, smashFactor: blank,
    launchAngle: blank, launchDirection: blank, spinRate: blank, spinAxis: blank,
    carry: summary(carry, carry * 0.04), carryError: blank, total: blank,
    side: summary(0, sideMad), curve: blank, apexHeight: blank, landingAngle: blank,
    dispersion: { centreCarry: carry, centreSide: 0, depth: 40, width: sideMad * 4 },
  } as ClubProfile;
}

const strike = (quality: number): StrikeBreakdown => ({
  total: 30, counts: [], qualityShare: quality, perShot: [],
});

/** Compare a club against its own optimals, with each metric offset by `off`
 *  half-widths from the target. */
function comparisons(off: number) {
  const opt = personalOptimals('7i', 87)!;
  return opt.windows.map((w) => {
    const half = (w.max - w.min) / 2;
    return compareToOptimal(w, w.target + half * off);
  });
}

describe('session scoring', () => {
  it('gives a perfect Delivery only when the numbers match the tour figure', () => {
    /*
     * The bug this exists to prevent: counting how many numbers landed inside
     * their band handed 100/100 to a player sitting on the very edge of all
     * six of them.
     */
    const exact = scoreSession({
      profile: profile(), strike: strike(0.8), consistency: null, optimals: comparisons(0),
    })!;
    const onTheEdge = scoreSession({
      profile: profile(), strike: strike(0.8), consistency: null, optimals: comparisons(1),
    })!;

    const delivery = (s: typeof exact) => s.components.find((c) => c.id === 'delivery')!.score;
    expect(delivery(exact)).toBe(100);
    expect(delivery(onTheEdge)).toBeLessThan(70);
    expect(delivery(onTheEdge)).toBeGreaterThan(40);
  });

  it('degrades Delivery smoothly rather than in steps', () => {
    const scores = [0, 0.5, 1, 1.5, 2].map(
      (off) =>
        scoreSession({
          profile: profile(), strike: strike(0.8), consistency: null, optimals: comparisons(off),
        })!.components.find((c) => c.id === 'delivery')!.score,
    );
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeLessThan(scores[i - 1] as number);
    }
  });

  it('scores dispersion against tour, not against an invented range', () => {
    const disp = (sideMad: number) =>
      scoreSession({
        profile: profile(170, sideMad), strike: strike(0.8), consistency: null, optimals: null,
      })!.components.find((c) => c.id === 'dispersion')!.score;

    // Tour width on a 170-yard shot is about 31 yards, i.e. sideMad near 7.9.
    expect(disp(7.9)).toBeGreaterThan(95);
    // A 51-yard pattern is ordinary for a mid handicap and used to score zero.
    expect(disp(12.75)).toBeGreaterThan(30);
    expect(disp(12.75)).toBeLessThan(75);
    // And a genuinely scattered one still bottoms out.
    expect(disp(22)).toBeLessThan(10);
  });

  it('says out loud what tour standard would be at that distance', () => {
    const s = scoreSession({
      profile: profile(170, 14), strike: strike(0.8), consistency: null, optimals: null,
    })!;
    expect(s.components.find((c) => c.id === 'dispersion')!.detail).toMatch(/Tour standard/);
  });

  it('refuses to grade a session too small to judge', () => {
    expect(scoreSession({
      profile: profile(), strike: { ...strike(0.9), total: 4 }, consistency: null, optimals: null,
    })).toBeNull();
  });
});
