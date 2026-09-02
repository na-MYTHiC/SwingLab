import { describe, expect, it } from 'vitest';
import type { Shot } from '../schema.js';
import {
  discarded, markImplausible, markMishits, markUnusable, representative, usable,
} from './outliers.js';
import { classifyStrikes } from '../analysis/strike.js';

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

describe('strike classification is judged in the player’s own spread', () => {
  it('does not call a third of a tidy session heavy', () => {
    /*
     * A fixed cut — "carry below 85% of median" — is a different bar for a
     * tight player and a wild one, and against a wide distribution it puts a
     * third of the session below it. Some of anyone's shots are below their
     * own median; that is what a median is.
     */
    const shots = Array.from({ length: 24 }, (_, i) =>
      shot({
        sequence: i + 1,
        carry: 160 + (i % 6) - 3,
        smashFactor: 1.33 + ((i % 5) - 2) * 0.006,
        launchAngle: 17 + ((i % 4) - 1.5) * 0.4,
        spinRate: 6800 + ((i % 5) - 2) * 90,
      }),
    );
    markImplausible(shots);
    const result = classifyStrikes(shots);
    const heavy = result.counts.find((c: { klass: string }) => c.klass === 'heavy');
    expect(heavy?.share ?? 0).toBeLessThan(0.1);
  });
});

describe('shots there is nothing to learn from', () => {
  it('throws out a top that goes a fraction of the normal distance', () => {
    // A topped 7-iron that goes 20 yards is not a data point about the
    // player's 7-iron. Its path and face describe a collision, not a swing.
    const shots = [
      ...Array.from({ length: 14 }, (_, i) => shot({ sequence: i + 1 })),
      shot({ sequence: 15, carry: 20, ballSpeed: 55, launchAngle: 3, spinRate: 1500 }),
    ];
    markImplausible(shots);
    markUnusable(shots);
    expect(shots[14]?.flags).toContain('unusable');
  });

  it('excludes them from everything, not just from the medians', () => {
    const shots = [
      ...Array.from({ length: 14 }, (_, i) => shot({ sequence: i + 1 })),
      shot({ sequence: 15, carry: 20, ballSpeed: 55 }),
    ];
    markImplausible(shots);
    markUnusable(shots);
    markMishits(shots);
    // Unlike a mishit, which stays in the count because its frequency matters.
    expect(usable(shots)).toHaveLength(14);
    expect(representative(shots)).toHaveLength(14);
    expect(discarded(shots)).toHaveLength(1);
  });

  it('leaves an ordinary bad shot alone', () => {
    // A 15% miss is a mishit worth counting, not a discard.
    const shots = [
      ...Array.from({ length: 14 }, (_, i) => shot({ sequence: i + 1 })),
      shot({ sequence: 15, carry: 136, ballSpeed: 100 }),
    ];
    markImplausible(shots);
    markUnusable(shots);
    expect(shots[14]?.flags).not.toContain('unusable');
  });
});

/**
 * Sentinel values, found in the wild.
 *
 * The public 10,000-shot TrackMan dataset carries a spin rate of
 * −21,474,836,480 — a scaled 32-bit integer overflow — in the same column as
 * real spin rates. These lock the guard against that whole class of value.
 */
describe('corrupt sensor values', () => {
  const base = (over: Partial<Shot>): Shot => ({
    id: 's', source: 'trackman-csv', time: null, club: '7i',
    clubSpeed: 87, ballSpeed: 115, smashFactor: 1.32, attackAngle: -3.4, clubPath: 0.2,
    faceAngle: 0.3, faceToPath: 0.1, dynamicLoft: 25, spinLoft: 28, lowPointDistance: 3,
    impactOffset: 0, impactHeight: 0, launchAngle: 17, launchDirection: 0.3,
    spinRate: 6800, spinAxis: 0, carry: 169, total: 178, side: 0, curve: 0,
    apexHeight: 30, landingAngle: 47, targetDistance: null, proximity: null,
    shotScore: null, spinMeasured: true, smashIndex: null, spinIndex: null,
    lowPointSide: null, swingRadius: null, dynamicLie: null, flags: [],
    ...over,
  } as Shot);

  it('rejects the exact value the public dataset contains', () => {
    const shots = [base({ spinRate: -21474836480 })];
    markImplausible(shots);
    expect(shots[0]!.flags).toContain('implausible');
  });

  it('rejects a sentinel in a field with no range of its own', () => {
    /*
     * `side` had no hard limit, and it feeds the dispersion ellipse — which
     * feeds the Direction score, the green rate and the handicap. A median is
     * robust to a plausible outlier and helpless against minus two billion.
     */
    const shots = [base({ side: -2147483648 })];
    markImplausible(shots);
    expect(shots[0]!.flags).toContain('implausible');
  });

  it('rejects non-finite readings', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      const shots = [base({ curve: bad })];
      markImplausible(shots);
      expect(shots[0]!.flags).toContain('implausible');
    }
  });

  it('leaves a perfectly ordinary shot alone', () => {
    const shots = [base({})];
    markImplausible(shots);
    expect(shots[0]!.flags).toEqual([]);
  });

  it('still accepts a wide but real miss', () => {
    // 60 yards offline is a terrible shot, not a broken sensor.
    const shots = [base({ side: -60, curve: 45 })];
    markImplausible(shots);
    expect(shots[0]!.flags).toEqual([]);
  });
});
