import { describe, expect, it } from 'vitest';
import { scoringZone } from './scoringZone.js';
import type { Club, Shot } from '../schema.js';

let seq = 0;
function shot(club: Club, target: number | null, carry: number, extra: Partial<Shot> = {}): Shot {
  seq += 1;
  return {
    id: `z${seq}`, source: 'trackman-csv', time: null, sequence: seq, club,
    clubSpeed: 70, ballSpeed: 85, smashFactor: 1.2, attackAngle: -4, clubPath: 0,
    faceAngle: 0, faceToPath: 0, dynamicLoft: 40, spinLoft: 44, lowPointDistance: 3,
    impactOffset: 0, impactHeight: 0, launchAngle: 28, launchDirection: 0,
    spinRate: 9000, spinAxis: 0, carry, total: carry + 2, side: 0, curve: 0,
    apexHeight: 20, landingAngle: 50, targetDistance: target, proximity: null, shotScore: null,
    spinMeasured: true, smashIndex: null, spinIndex: null,
    lowPointSide: null, swingRadius: null, dynamicLie: null, flags: [], ...extra,
  } as Shot;
}
const four = (club: Club, target: number, carries: number[], extra: Partial<Shot> = {}) =>
  carries.map((c) => shot(club, target, c, extra));

describe('the scoring zone', () => {
  it('reads each club and distance on its own', () => {
    const z = scoringZone([{ shots: [
      ...four('SW', 60, [58, 59, 60, 61]),
      ...four('GW', 80, [72, 73, 74, 75]),
    ] }]);
    expect(z.cells.map((c) => `${c.club}@${c.target}`)).toEqual(['SW@60', 'GW@80']);
    expect(z.cells[0]!.bias).toBeCloseTo(-0.5, 1);
    expect(z.cells[1]!.bias).toBeCloseTo(-6.5, 1);
  });

  it('calls a systematic short miss calibration, not technique', () => {
    const z = scoringZone([{ shots: [
      ...four('SW', 60, [52, 53, 54, 55]),
      ...four('GW', 80, [72, 73, 74, 75]),
      ...four('PW', 100, [92, 93, 94, 95]),
    ] }]);
    expect(z.overallBias).toBeLessThan(-5);
    expect(z.detail).toMatch(/short of the number/);
    expect(z.detail).toMatch(/take more club/);
  });

  it('judges worst by distance, not by raw feet', () => {
    // 30 ft from 140 is good golf; 30 ft from 50 is not.
    const z = scoringZone([{ shots: [
      ...four('SW', 50, [50, 50, 50, 50], { proximity: 10 }),
      ...four('8i', 140, [140, 140, 140, 140], { proximity: 10 }),
    ] }]);
    expect(z.worst?.target).toBe(50);
    expect(z.best?.target).toBe(140);
  });

  it('ignores shots that were plainly not an attempt at the number', () => {
    const z = scoringZone([{ shots: [
      ...four('SW', 60, [59, 60, 61, 60]),
      // A Combine driver with a stray target, or a mislabelled row.
      ...four('Dr', 95, [240, 245, 250, 243]),
    ] }]);
    expect(z.cells.some((c) => c.club === 'Dr')).toBe(false);
  });

  it('pools target practice from every session', () => {
    const z = scoringZone([
      { shots: four('SW', 60, [59, 60, 61, 60]) },
      { shots: [shot('7i', null, 160), shot('7i', null, 162)] },
      { shots: four('SW', 60, [55, 56, 57, 58]) },
    ]);
    expect(z.sessions).toBe(2);
    expect(z.cells[0]!.shots).toBe(8);
  });

  it('needs three attempts before it will judge a distance', () => {
    const z = scoringZone([{ shots: [shot('SW', 60, 58), shot('SW', 60, 61)] }]);
    expect(z.cells).toHaveLength(0);
    expect(z.headline).toMatch(/No target practice/);
  });
});
