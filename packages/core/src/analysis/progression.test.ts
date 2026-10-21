import { describe, expect, it } from 'vitest';
import { sessionProgression } from './progression.js';
import type { Club, Shot } from '../schema.js';

let seq = 0;
function shot(club: Club, carry: number): Shot {
  seq += 1;
  return {
    id: `p${seq}`, source: 'trackman-csv', time: null, sequence: seq, club,
    clubSpeed: 87, ballSpeed: 115, smashFactor: 1.32, attackAngle: -3.4, clubPath: 0,
    faceAngle: 0, faceToPath: 0, dynamicLoft: 25, spinLoft: 28, lowPointDistance: 3,
    impactOffset: 0, impactHeight: 0, launchAngle: 17, launchDirection: 0,
    spinRate: 6800, spinAxis: 0, carry, total: carry + 9, side: 0, curve: 0,
    apexHeight: 30, landingAngle: 47, targetDistance: null, proximity: null, shotScore: null,
    spinMeasured: true, smashIndex: null, spinIndex: null,
    lowPointSide: null, swingRadius: null, dynamicLie: null, flags: [],
  } as Shot;
}
const wob = (i: number) => ((i * 7) % 5) - 2;

describe('how the session went', () => {
  it('does not mistake working down the bag for fatigue', () => {
    /*
     * The bug: carry was pooled across clubs, so drivers first and wedges
     * last read as "You lost 109 yards over the session. That is usually
     * fatigue." It was club order.
     */
    const shots = [
      ...Array.from({ length: 10 }, (_, i) => shot('Dr', 240 + wob(i))),
      ...Array.from({ length: 10 }, (_, i) => shot('7i', 160 + wob(i))),
      ...Array.from({ length: 10 }, (_, i) => shot('PW', 120 + wob(i))),
    ];
    const p = sessionProgression(shots);
    expect(p.mixedClubs).toBe(true);
    expect(p.verdict).toBe('steady');
    expect(p.headline).not.toMatch(/lost/i);
  });

  it('still catches a real fade across several clubs, in percent', () => {
    // Every club drops about 8% in the last third.
    const shots: Shot[] = [];
    for (let i = 0; i < 30; i += 1) {
      const club = (['Dr', '7i', 'PW'] as const)[i % 3];
      const base = club === 'Dr' ? 240 : club === '7i' ? 160 : 120;
      shots.push(shot(club, base * (i >= 20 ? 0.92 : 1) + wob(i) * 0.3));
    }
    const p = sessionProgression(shots);
    expect(p.verdict).toBe('faded');
    expect(p.headline).toMatch(/% of your normal carry/);
    expect(p.detail).toMatch(/own normal distance/);
  });

  it('reads a single club in yards', () => {
    const shots = Array.from({ length: 30 }, (_, i) => shot('7i', (i < 20 ? 165 : 153) + wob(i)));
    const p = sessionProgression(shots);
    expect(p.mixedClubs).toBe(false);
    expect(p.verdict).toBe('faded');
    expect(p.headline).toMatch(/You lost \d+ yards over the session/);
    expect(p.carryChange).toBeLessThan(-5);
  });

  it('reads a warm-up as a warm-up', () => {
    const shots = Array.from({ length: 30 }, (_, i) => shot('7i', (i < 10 ? 150 : 162) + wob(i)));
    expect(sessionProgression(shots).verdict).toBe('warmed-up');
  });

  it('says nothing from too few shots', () => {
    expect(sessionProgression(Array.from({ length: 8 }, () => shot('7i', 160))).verdict).toBe('unknown');
  });
});

import { classifyStrikes } from './strike.js';

describe('strike quality across a bag', () => {
  it('does not hand every flush to the club with the highest smash factor', () => {
    /*
     * Pooled across clubs, a driver's 1.47 was "flush" next to a wedge's 1.20
     * by definition. Before the fix the slicer sample gave the driver ten
     * flushes in twelve and the 7-iron none in fourteen. Same relative
     * pattern for every club here, so flushes should spread evenly.
     */
    const smashOf = { Dr: 1.47, '7i': 1.33, PW: 1.21 } as const;
    const shots: Shot[] = [];
    for (const club of ['Dr', '7i', 'PW'] as const) {
      for (let i = 0; i < 12; i += 1) {
        const s = shot(club, 100);
        s.smashFactor = smashOf[club] * (1 + (((i * 5) % 12) - 6) * 0.002);
        s.impactOffset = null; s.impactHeight = null;
        shots.push(s);
      }
    }
    const strikes = classifyStrikes(shots);
    const clubOf = new Map(shots.map((s) => [s.sequence, s.club]));
    const flushes = (club: string) =>
      strikes.perShot.filter((p) => p.klass === 'flush' && clubOf.get(p.sequence) === club).length;
    const counts = ['Dr', '7i', 'PW'].map(flushes);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});
