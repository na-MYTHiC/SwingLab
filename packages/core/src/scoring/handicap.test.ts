import { describe, expect, it } from 'vitest';
import { estimateHandicap } from './handicap.js';
import { dispersionScore } from '../benchmarks/skill.js';
import type { ClubProfile } from '../stats/dispersion.js';
import type { StrikeBreakdown } from '../analysis/strike.js';

function summary(median: number, mad: number, n = 30) {
  return { n, median, mad, min: median - mad * 2, max: median + mad * 2, p25: median, p75: median, mean: median };
}

function profile(over: { sideMad: number; carry?: number; carryMad?: number; n?: number }): ClubProfile {
  const carry = over.carry ?? 175;
  const n = over.n ?? 30;
  const blank = summary(0, 0, n);
  return {
    club: '7i', shotCount: n, representativeCount: n, mishitCount: 0, mishitRate: 0,
    distinctTargets: 0,
    clubSpeed: blank, attackAngle: blank, clubPath: blank, faceAngle: blank, faceToPath: blank,
    dynamicLoft: blank, spinLoft: blank, lowPointDistance: blank, impactOffset: blank,
    impactHeight: blank, ballSpeed: blank, smashFactor: blank, launchAngle: blank,
    launchDirection: blank, spinRate: blank, spinAxis: blank,
    carry: summary(carry, over.carryMad ?? carry * 0.03, n),
    carryError: blank, total: blank,
    side: summary(0, over.sideMad, n),
    curve: blank, apexHeight: blank, landingAngle: blank,
    dispersion: { centreCarry: carry, centreSide: 0, depth: 20, width: over.sideMad * 4 },
  } as ClubProfile;
}

const strike = (quality: number): StrikeBreakdown => ({
  total: 30, counts: [], qualityShare: quality, perShot: [],
});

describe('handicap from ball-striking', () => {
  it('puts tour-level dispersion at a plus handicap', () => {
    // Tour proximity from 150-175 yards is 27 ft 10 in, which works out at a
    // per-axis sigma near 7.4 yards. That is a tour card, not scratch.
    const h = estimateHandicap(profile({ sideMad: 7.4, carry: 160, carryMad: 7.4 }), strike(0.95));
    expect(h).not.toBeNull();
    expect(h!.estimate).toBeLessThan(-2);
  });

  it('puts a mid-handicap pattern in the mid handicaps', () => {
    // ~45-50 ft proximity from 150 yards is a 10-15 handicap.
    const sigma = 15.8 / Math.sqrt(Math.PI / 2);
    const h = estimateHandicap(
      profile({ sideMad: sigma, carry: 150, carryMad: sigma }), strike(0.8),
    );
    expect(h!.estimate).toBeGreaterThan(8);
    expect(h!.estimate).toBeLessThan(18);
  });

  it('agrees with the Dispersion score instead of contradicting it', () => {
    /*
     * The bug this exists to prevent: the two numbers were on separate
     * invented scales, and the app cheerfully showed "Dispersion 0/100"
     * directly above "handicap 7-12". They now share `benchmarks/skill.ts`,
     * so a pattern scoring badly must estimate badly and vice versa.
     */
    const tight = estimateHandicap(profile({ sideMad: 8, carry: 170, carryMad: 6 }), strike(0.9))!;
    const wide = estimateHandicap(profile({ sideMad: 20, carry: 170, carryMad: 6 }), strike(0.9))!;
    expect(dispersionScore(8 * 4, 170)).toBeGreaterThan(dispersionScore(20 * 4, 170));
    expect(tight.estimate).toBeLessThan(wide.estimate);
  });

  it('does not flatter a pattern that is only tight sideways', () => {
    // Twenty yards short is exactly as expensive as twenty yards left.
    const straightButWild = estimateHandicap(
      profile({ sideMad: 6, carry: 170, carryMad: 18 }), strike(0.9),
    )!;
    const balanced = estimateHandicap(
      profile({ sideMad: 6, carry: 170, carryMad: 6 }), strike(0.9),
    )!;
    expect(straightButWild.estimate).toBeGreaterThan(balanced.estimate + 5);
  });

  it('scales with the club, not with raw yards', () => {
    // 6 yards offline on a 100-yard wedge is the same control as 10.5 on a
    // 175-yard 7-iron, and should score the same.
    const wedge = estimateHandicap(
      profile({ sideMad: 6, carry: 100, carryMad: 6 }), strike(0.9),
    )!;
    const iron = estimateHandicap(
      profile({ sideMad: 10.5, carry: 175, carryMad: 10.5 }), strike(0.9),
    )!;
    expect(Math.abs(wedge.estimate - iron.estimate)).toBeLessThan(1.5);
  });

  it('penalises poor contact that dispersion alone would miss', () => {
    // A thin shot can finish perfectly straight.
    const clean = estimateHandicap(profile({ sideMad: 14 }), strike(0.95))!;
    const scrappy = estimateHandicap(profile({ sideMad: 14 }), strike(0.5))!;
    expect(scrappy.estimate).toBeGreaterThan(clean.estimate);
  });

  it('widens the range and lowers confidence on a thin sample', () => {
    const many = estimateHandicap(profile({ sideMad: 14, n: 40 }), strike(0.85))!;
    const few = estimateHandicap(profile({ sideMad: 14, n: 12 }), strike(0.85))!;
    expect(few.high - few.low).toBeGreaterThan(many.high - many.low);
    expect(few.confidence).toBe('low');
    expect(many.confidence).toBe('high');
  });

  it('refuses to estimate from too few shots', () => {
    expect(estimateHandicap(profile({ sideMad: 14, n: 6 }), strike(0.85))).toBeNull();
  });

  it('always says what it cannot see', () => {
    // Roughly 45% of scoring is inside 100 yards and invisible to a range.
    const h = estimateHandicap(profile({ sideMad: 14 }), strike(0.85))!;
    expect(h.caveat).toMatch(/short game|100 yards/i);
  });

  it('stays inside sane bounds at both ends', () => {
    const wild = estimateHandicap(profile({ sideMad: 60 }), strike(0.2))!;
    expect(wild.estimate).toBeLessThanOrEqual(36);
    // A pattern tighter than tour reads as a plus handicap rather than being
    // flattened to scratch — a player who gets there should see it.
    const elite = estimateHandicap(profile({ sideMad: 4, carry: 175, carryMad: 4 }), strike(0.99))!;
    expect(elite.estimate).toBeLessThan(0);
    expect(elite.estimate).toBeGreaterThanOrEqual(-6);
  });
});
