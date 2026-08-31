import { describe, expect, it } from 'vitest';
import type { Shot } from '../schema.js';
import { markImplausible, markMishits, representative, usable } from './outliers.js';

function shot(over: Partial<Shot>): Shot {
  return {
    id: Math.random().toString(36).slice(2),
    source: 'manual',
    time: null,
    sequence: 1,
    club: '7i',
    rawClub: '7 Iron',
    clubSpeed: 82, attackAngle: -3, clubPath: -1, faceAngle: 0, faceToPath: 1,
    dynamicLoft: 27, spinLoft: 30, swingPlane: null, swingDirection: null,
    lowPointDistance: 2, impactOffset: 0, impactHeight: 0,
    ballSpeed: 107, smashFactor: 1.31, launchAngle: 17, launchDirection: 0,
    spinRate: 6800, spinAxis: 2,
    carry: 158, total: 162, side: 2, sideTotal: 2, curve: 2,
    apexHeight: 90, landingAngle: 45, hangTime: 6,
    flags: [],
    ...over,
  };
}

describe('implausible values', () => {
  it('flags numbers that cannot be real', () => {
    const shots = [shot({ ballSpeed: 400 }), shot({ carry: -20 }), shot({})];
    markImplausible(shots);
    expect(shots[0]?.flags).toContain('implausible');
    expect(shots[1]?.flags).toContain('implausible');
    expect(shots[2]?.flags).toEqual([]);
  });

  it('removes them from every downstream view', () => {
    const shots = [shot({ ballSpeed: 400 }), shot({})];
    markImplausible(shots);
    expect(usable(shots)).toHaveLength(1);
  });
});

describe('mishit detection', () => {
  it('flags the duffed shot but not the good ones', () => {
    const shots = [
      ...Array.from({ length: 9 }, () => shot({})),
      shot({ smashFactor: 1.05, carry: 118 }),
    ];
    markImplausible(shots);
    markMishits(shots);
    expect(shots[9]?.flags).toContain('mishit');
    expect(shots.slice(0, 9).every((s) => !s.flags.includes('mishit'))).toBe(true);
  });

  it('keeps mishits usable but out of the representative sample', () => {
    const shots = [
      ...Array.from({ length: 9 }, () => shot({})),
      shot({ smashFactor: 1.05, carry: 118 }),
    ];
    markImplausible(shots);
    markMishits(shots);
    // Still counted for "how often does this happen"...
    expect(usable(shots)).toHaveLength(10);
    // ...but excluded from "what is your typical delivery".
    expect(representative(shots)).toHaveLength(9);
  });

  it('does not judge outliers from a tiny sample', () => {
    const shots = [shot({}), shot({ smashFactor: 1.0, carry: 100 })];
    markImplausible(shots);
    markMishits(shots);
    expect(shots[1]?.flags).not.toContain('mishit');
  });

  it('does not flag every wedge as a mishit for smashing below a driver', () => {
    // Thresholds are relative to the club's own group, not an absolute smash.
    const wedges = Array.from({ length: 10 }, () =>
      shot({ club: 'SW', smashFactor: 1.16, carry: 82, clubSpeed: 70, ballSpeed: 81 }),
    );
    markImplausible(wedges);
    markMishits(wedges);
    expect(wedges.every((s) => !s.flags.includes('mishit'))).toBe(true);
  });
});

describe('skewed data does not manufacture mishits', () => {
  it('leaves a naturally left-skewed smash distribution alone', () => {
    /*
     * Real smash factor is not symmetric: good strikes cluster near the
     * ceiling and bad ones trail below it. A symmetric spread measure reads
     * that tail as ordinary width and then flags a slice of it every time,
     * which produced a 17% "mishit rate" for a player striking it fine.
     */
    const smashes = [
      1.34, 1.34, 1.33, 1.33, 1.33, 1.32, 1.32, 1.32, 1.31, 1.31,
      1.30, 1.29, 1.28, 1.27, 1.25,
    ];
    const shots = smashes.map((smashFactor, i) =>
      shot({ sequence: i + 1, smashFactor, carry: 160 - (1.34 - smashFactor) * 200 }),
    );
    markImplausible(shots);
    markMishits(shots);
    expect(shots.filter((s) => s.flags.includes('mishit'))).toHaveLength(0);
  });

  it('still catches a shot that is genuinely off the bottom of the pattern', () => {
    const shots = [
      ...Array.from({ length: 14 }, (_, i) => shot({ sequence: i + 1 })),
      shot({ sequence: 15, smashFactor: 1.02, carry: 112 }),
    ];
    markImplausible(shots);
    markMishits(shots);
    expect(shots[14]?.flags).toContain('mishit');
  });
});
