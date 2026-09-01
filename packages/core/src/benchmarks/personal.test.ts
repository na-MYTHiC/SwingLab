import { describe, expect, it } from 'vitest';
import { compareToOptimal, personalOptimals } from './personal.js';
import { tourRow } from './tour.js';

const target = (club: Parameters<typeof personalOptimals>[0], speed: number, metric: string) =>
  personalOptimals(club, speed)?.windows.find((w) => w.metric === metric)?.target as number;

describe('targets interpolate between the two tours', () => {
  it('reproduces each tour exactly at its own club speed', () => {
    const pga = tourRow('7i', 'pga')!;
    const lpga = tourRow('7i', 'lpga')!;
    expect(target('7i', pga.clubSpeed, 'launchAngle')).toBeCloseTo(pga.launchAngle, 1);
    expect(target('7i', lpga.clubSpeed, 'launchAngle')).toBeCloseTo(lpga.launchAngle, 1);
    expect(target('7i', pga.clubSpeed, 'attackAngle')).toBeCloseTo(pga.attackAngle, 1);
    expect(target('7i', lpga.clubSpeed, 'attackAngle')).toBeCloseTo(lpga.attackAngle, 1);
  });

  it('lands between the tours for a speed between them', () => {
    const mid = target('7i', 85, 'launchAngle');
    expect(mid).toBeLessThan(18.5); // LPGA at 78 mph
    expect(mid).toBeGreaterThan(16.1); // PGA at 92 mph
  });

  it('tells a slower swing to hit UP more on the driver', () => {
    // The relation the two tables actually show: tour men average -0.9° and
    // tour women +2.8°. Hitting up is how you buy carry without speed, so a
    // slower player's target must be the more positive one.
    expect(target('Dr', 95, 'attackAngle')).toBeGreaterThan(target('Dr', 115, 'attackAngle'));
  });

  it('tells a slower swing to launch the ball higher', () => {
    expect(target('7i', 78, 'launchAngle')).toBeGreaterThan(target('7i', 92, 'launchAngle'));
  });

  it('does not assume smash falls with speed, because the tables say otherwise', () => {
    // LPGA 7-iron smash is 1.38 against PGA's 1.34 — higher, not lower. A
    // scaling law would have got this backwards.
    expect(target('7i', 78, 'smashFactor')).toBeGreaterThan(target('7i', 92, 'smashFactor'));
  });
});

describe('targets stay sensible outside the anchors', () => {
  it('keeps carry tracking speed all the way down', () => {
    // Freezing magnitudes at the clamp handed a 75 mph and an 85 mph player
    // the same driver carry target, which is nonsense at one end.
    const speeds = [70, 80, 90, 100, 110, 120];
    const carries = speeds.map((s) => target('Dr', s, 'carry'));
    for (let i = 1; i < carries.length; i++) {
      expect(carries[i], `carry at ${speeds[i]}`).toBeGreaterThan(carries[i - 1] as number);
    }
  });

  it('does not let attack angle run away past the anchors', () => {
    // Nobody should be told to hit eight degrees up on a driver because the
    // line kept going.
    expect(target('Dr', 55, 'attackAngle')).toBeLessThan(7);
    expect(target('Dr', 140, 'attackAngle')).toBeGreaterThan(-6);
  });

  it('flags an extrapolated target as less certain and widens its band', () => {
    const inside = personalOptimals('7i', 85)!.windows[0]!;
    const outside = personalOptimals('7i', 60)!.windows[0]!;
    expect(inside.basis).toBe('between-tours');
    expect(outside.basis).toBe('extrapolated');
    expect(outside.max - outside.min).toBeGreaterThan(inside.max - inside.min);
  });

  it('returns nothing for a club neither tour publishes', () => {
    // A made-up sand wedge target is worse than no target.
    expect(personalOptimals('SW', 70)).toBeNull();
  });
});

describe('comparing a measurement to its window', () => {
  const window = personalOptimals('7i', 85)!.windows.find((w) => w.metric === 'launchAngle')!;

  it('reports on-target inside the band', () => {
    expect(compareToOptimal(window, window.target).status).toBe('on-target');
  });

  it('reports which side it missed, and by how much', () => {
    const high = compareToOptimal(window, window.max + 2);
    expect(high.status).toBe('above');
    expect(high.miss).toBeCloseTo(2, 5);

    const low = compareToOptimal(window, window.min - 1.5);
    expect(low.status).toBe('below');
    expect(low.miss).toBeCloseTo(1.5, 5);
  });

  it('says unknown rather than guessing when the metric was not measured', () => {
    expect(compareToOptimal(window, Number.NaN).status).toBe('unknown');
  });
});
