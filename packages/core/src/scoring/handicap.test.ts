import { describe, expect, it } from 'vitest';
import { estimateHandicap } from './handicap.js';
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
  it('puts tour-level dispersion at scratch', () => {
    // Published benchmark: tour holds about ±9 yards with a 7-iron at 175.
    const h = estimateHandicap(profile({ sideMad: 9 }), strike(0.95));
    expect(h).not.toBeNull();
    expect(h!.estimate).toBeLessThan(3);
  });

  it('puts the published 10-handicap dispersion near 10', () => {
    // ±17.5 yards is the midpoint of the quoted 15-20 band.
    const h = estimateHandicap(profile({ sideMad: 17.5 }), strike(0.8));
    expect(h!.estimate).toBeGreaterThan(6);
    expect(h!.estimate).toBeLessThan(15);
  });

  it('reads the benchmark as a typical miss, not a 95% band', () => {
    /*
     * Reading "±9 yards" as the outer edge of a 95% pattern doubles everyone's
     * dispersion and lands a competent striker near a 27 handicap — an
     * estimate that contradicted the tour-level strike efficiency shown
     * beside it. Tour dispersion must come out at scratch, not mid-handicap.
     */
    expect(estimateHandicap(profile({ sideMad: 9 }), strike(0.95))!.estimate).toBeLessThan(5);
  });

  it('scales with the club, not with raw yards', () => {
    // 6 yards offline on a 100-yard wedge is the same control as 10.5 on a
    // 175-yard 7-iron, and should score the same.
    const wedge = estimateHandicap(profile({ sideMad: 6, carry: 100 }), strike(0.9))!;
    const iron = estimateHandicap(profile({ sideMad: 10.5, carry: 175 }), strike(0.9))!;
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

  it("stays inside the handicap system bounds", () => {
    const wild = estimateHandicap(profile({ sideMad: 60 }), strike(0.2))!;
    expect(wild.estimate).toBeLessThanOrEqual(36);
    expect(wild.estimate).toBeGreaterThanOrEqual(0);
  });
});
