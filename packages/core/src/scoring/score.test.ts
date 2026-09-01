import { describe, expect, it } from 'vitest';
import { scoreSession } from './score.js';
import { personalOptimals, compareToOptimal } from '../benchmarks/personal.js';
import type { ClubProfile } from '../stats/dispersion.js';
import type { StrikeBreakdown } from '../analysis/strike.js';

function summary(median: number, mad: number, n = 30) {
  return { n, median, mad, min: median - mad, max: median + mad, p25: median, p75: median, mean: median };
}

function profile(carry = 170, sideMad = 12, carryMad = carry * 0.04): ClubProfile {
  const blank = summary(0, 0);
  return {
    club: '7i', shotCount: 30, representativeCount: 30, mishitCount: 0, mishitRate: 0,
    distinctTargets: 0,
    clubSpeed: summary(87, 2), attackAngle: blank, clubPath: blank, faceAngle: blank,
    faceToPath: blank, dynamicLoft: blank, spinLoft: blank, lowPointDistance: blank,
    impactOffset: blank, impactHeight: blank, ballSpeed: blank, smashFactor: blank,
    launchAngle: blank, launchDirection: blank, spinRate: blank, spinAxis: blank,
    carry: summary(carry, carryMad), carryError: blank, total: blank,
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

  it('scores distance control on the same tour anchor as direction', () => {
    /*
     * Promoted out of Repeatability, where it was one metric among eight.
     * Half of proximity to the hole is distance error, so scoring only the
     * sideways half told a player who sprayed it a consistent distance that
     * they were fine.
     */
    const dist = (carryMad: number) =>
      scoreSession({
        profile: profile(170, 8, carryMad), strike: strike(0.8), consistency: null, optimals: null,
      })!.components.find((c) => c.id === 'distance')?.score;

    // Tour carry sigma is about 4.6% of the shot: 7.9 yards on 170.
    expect(dist(7.9)).toBeGreaterThan(95);
    expect(dist(11.3)).toBeGreaterThan(50);
    expect(dist(11.3)).toBeLessThan(85);
    expect(dist(21)).toBeLessThan(10);
  });

  it('does not score distance control when the club was played to several targets', () => {
    // In a Combine the carry is *supposed* to vary. Reading that as a fault
    // would be scoring the protocol rather than the player.
    const ladder = { ...profile(170, 8), distinctTargets: 4 } as ClubProfile;
    const s = scoreSession({
      profile: ladder, strike: strike(0.8), consistency: null, optimals: null,
    })!;
    expect(s.components.find((c) => c.id === 'distance')).toBeUndefined();
  });

  it('does not count carry spread twice', () => {
    // Carry lives in the consistency scorecard and in Distance control. Only
    // the latter may reach the score, or the same fault is the heaviest thing
    // in it by accident.
    const consistency = {
      club: '7i' as const,
      overall: 50,
      weakest: null,
      scores: [
        { metric: 'carry', label: 'Carry distance', score: 0, spread: 20, unit: 'yds', verdict: 'wild' as const, soWhat: '' },
        { metric: 'clubPath', label: 'Club path', score: 90, spread: 1, unit: '°', verdict: 'elite' as const, soWhat: '' },
      ],
    };
    const s = scoreSession({
      profile: profile(), strike: strike(0.8), consistency, optimals: null,
    })!;
    // The kept metric alone, not the mean of both.
    expect(s.components.find((c) => c.id === 'repeatability')!.score).toBe(90);
  });

  it('charges for the shots it threw out', () => {
    /*
     * The hole this closes: tops and shanks are excluded from every statistic,
     * which is right, but it meant a player could shank three balls and the
     * score would not notice — the filter that keeps the numbers honest was
     * also hiding the cost.
     */
    const rel = (discarded: number) =>
      scoreSession({
        profile: profile(), strike: strike(0.8), consistency: null, optimals: null,
        discarded, shotCount: 40,
      })!.components.find((c) => c.id === 'reliability')!.score;

    expect(rel(0)).toBe(100);
    expect(rel(2)).toBeLessThan(60);
    expect(rel(4)).toBe(0);

    const clean = scoreSession({
      profile: profile(), strike: strike(0.8), consistency: null, optimals: null,
      discarded: 0, shotCount: 40,
    })!;
    const messy = scoreSession({
      profile: profile(), strike: strike(0.8), consistency: null, optimals: null,
      discarded: 3, shotCount: 40,
    })!;
    expect(messy.total).toBeLessThan(clean.total);
  });

  it('hands the components back best first', () => {
    const s = scoreSession({
      profile: profile(170, 20), strike: strike(0.95), consistency: null, optimals: comparisons(0),
      discarded: 0, shotCount: 40,
    })!;
    for (let i = 1; i < s.components.length; i += 1) {
      expect((s.components[i] as { score: number }).score)
        .toBeLessThanOrEqual((s.components[i - 1] as { score: number }).score);
    }
  });

  it('renormalises rather than punishing a launch monitor for what it cannot see', () => {
    // No club data and no optimals: the remaining components must still be
    // able to reach 100 between them.
    const s = scoreSession({
      profile: profile(170, 7.9, 7.9), strike: strike(1), consistency: null, optimals: null,
      discarded: 0, shotCount: 40,
    })!;
    expect(s.total).toBeGreaterThan(95);
  });

  it('refuses to grade a session too small to judge', () => {
    expect(scoreSession({
      profile: profile(), strike: { ...strike(0.9), total: 4 }, consistency: null, optimals: null,
    })).toBeNull();
  });
});
