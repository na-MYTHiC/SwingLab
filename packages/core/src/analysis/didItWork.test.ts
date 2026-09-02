import { describe, expect, it } from 'vitest';
import { compareSessions, previousSessionFor } from './didItWork.js';
import type { Shot, ShotSession } from '../schema.js';

let seq = 0;
function shot(over: Partial<Shot> = {}): Shot {
  seq += 1;
  return {
    id: `s${seq}`, source: 'trackman-csv', time: null, sequence: seq, club: '7i',
    clubSpeed: 87, ballSpeed: 115, smashFactor: 1.32, attackAngle: -3.4, clubPath: 0,
    faceAngle: 0, faceToPath: 0, dynamicLoft: 25, spinLoft: 28, lowPointDistance: 3,
    impactOffset: 0, impactHeight: 0, launchAngle: 17, launchDirection: 0,
    spinRate: 6800, spinAxis: 0, carry: 165, total: 174, side: 0, curve: 0,
    apexHeight: 30, landingAngle: 47, targetDistance: null, proximity: null, shotScore: null,
    spinMeasured: true, smashIndex: null, spinIndex: null,
    lowPointSide: null, swingRadius: null, dynamicLie: null, flags: [],
    ...over,
  } as Shot;
}

/** Alternating ± so every median is exact and every spread is predictable. */
const wob = (i: number) => (i % 2 === 0 ? 1 : -1);

function session(id: string, daysAgo: number, make: (i: number) => Partial<Shot>): ShotSession {
  return {
    id, source: 'trackman-csv', kind: 'range', sourceRef: id, handedness: 'right',
    startedAt: new Date(Date.UTC(2026, 8, 1) - daysAgo * 86_400_000),
    conditions: undefined,
    shots: Array.from({ length: 20 }, (_, i) => shot(make(i))),
  } as ShotSession;
}

const find = (c: ReturnType<typeof compareSessions>, metric: string) =>
  c!.deltas.find((d) => d.metric === metric)!;

describe('did the work show up', () => {
  it('does not call extra carry an improvement', () => {
    /*
     * The bug this file was written after. Carry was 'higher-better', so a
     * 7-iron that went six yards further than last week counted as a win in a
     * card asking whether practice had worked — while the yardage book on the
     * next screen was telling the same player to stop clubbing off their
     * longest one.
     */
    const before = session('a', 7, (i) => ({ carry: 159 + wob(i) }));
    const after = session('b', 0, (i) => ({ carry: 175 + wob(i) }));
    const c = compareSessions(before, after, '7i');

    const carry = find(c, 'carry');
    expect(carry.meaningful).toBe(true);
    expect(carry.improved).toBeNull();
    expect(carry.direction).toBe('context');
  });

  it('leaves carry out of the better-worse tally', () => {
    // Carry up a long way, one real metric worse, nothing else moved.
    const before = session('a', 7, (i) => ({ carry: 159 + wob(i), faceToPath: 1 + wob(i) * 0.2 }));
    const after = session('b', 0, (i) => ({ carry: 178 + wob(i), faceToPath: 5 + wob(i) * 0.2 }));
    const c = compareSessions(before, after, '7i')!;

    expect(c.meaningful.some((d) => d.metric === 'carry')).toBe(true);
    // One thing got worse and nothing got better, whatever carry did.
    expect(c.headline).toMatch(/went backwards/i);
    expect(c.headline).not.toMatch(/better/i);
  });

  it('says nothing moved when only carry moved', () => {
    const before = session('a', 7, (i) => ({ carry: 160 + wob(i) }));
    const after = session('b', 0, (i) => ({ carry: 172 + wob(i) }));
    const c = compareSessions(before, after, '7i')!;
    expect(c.headline).toMatch(/Nothing moved further than your normal/i);
  });

  it('scores the spread metrics as better when they tighten', () => {
    const before = session('a', 7, (i) => ({
      carry: 165 + wob(i) * 12, lowPointDistance: 3 + wob(i) * 2.5,
      dynamicLoft: 25 + wob(i) * 3, faceAngle: wob(i) * 3,
    }));
    const after = session('b', 0, (i) => ({
      carry: 165 + wob(i) * 3, lowPointDistance: 3 + wob(i) * 0.6,
      dynamicLoft: 25 + wob(i) * 1, faceAngle: wob(i) * 0.8,
    }));
    const c = compareSessions(before, after, '7i');
    for (const m of ['carrySpread', 'lowPointSpread', 'dynamicLoftSpread', 'faceSpread']) {
      const d = find(c, m);
      expect(d.meaningful, `${m} did not clear its floor`).toBe(true);
      expect(d.improved, `${m} should read better`).toBe(true);
    }
  });

  it('reads the angles by distance from zero, across a change of sign', () => {
    // 4 degrees out-to-in becoming 1 degree in-to-out is an improvement, even
    // though the number went up.
    const before = session('a', 7, (i) => ({ clubPath: -4 + wob(i) * 0.2 }));
    const after = session('b', 0, (i) => ({ clubPath: 1 + wob(i) * 0.2 }));
    expect(find(compareSessions(before, after, '7i'), 'clubPath').improved).toBe(true);

    // And the reverse: a path drifting away from zero is worse.
    const c2 = compareSessions(
      session('a', 7, (i) => ({ clubPath: 0.1 + wob(i) * 0.1 })),
      session('b', 0, (i) => ({ clubPath: -3.5 + wob(i) * 0.1 })),
      '7i',
    );
    expect(find(c2, 'clubPath').improved).toBe(false);
  });

  it('does not reassure the player that a bad half is bedding in', () => {
    const before = session('a', 7, (i) => ({
      lowPointDistance: 3 + wob(i) * 2.5, faceToPath: 1 + wob(i) * 0.2,
    }));
    const after = session('b', 0, (i) => ({
      lowPointDistance: 3 + wob(i) * 0.6, faceToPath: 5 + wob(i) * 0.2,
    }));
    const c = compareSessions(before, after, '7i')!;
    expect(c.headline).toMatch(/1 better, 1 worse/);
    expect(c.headline).not.toMatch(/bedding in rather than that it failed/i);
    // It may say a third session settles it; it must not pre-judge which way.
    expect(c.headline).toMatch(/third/i);
  });

  it('orders wins first, then losses, then the rows with no verdict', () => {
    const before = session('a', 7, (i) => ({
      carry: 158 + wob(i), lowPointDistance: 3 + wob(i) * 2.5, faceToPath: 1 + wob(i) * 0.2,
    }));
    const after = session('b', 0, (i) => ({
      carry: 176 + wob(i), lowPointDistance: 3 + wob(i) * 0.6, faceToPath: 5 + wob(i) * 0.2,
    }));
    const order = compareSessions(before, after, '7i')!.meaningful.map((d) => d.improved);
    expect(order[0]).toBe(true);
    expect(order.at(-1)).toBeNull();
    expect(order.indexOf(false)).toBeGreaterThan(order.indexOf(true));
  });

  it('picks the most recent earlier session that used the club', () => {
    const old = session('old', 30, () => ({}));
    const recent = session('recent', 3, () => ({}));
    const current = session('now', 0, () => ({}));
    const wrongClub = { ...session('driver', 1, () => ({ club: 'Dr' })) } as ShotSession;
    const picked = previousSessionFor([old, recent, wrongClub, current], current, '7i');
    expect(picked?.id).toBe('recent');
  });
});
