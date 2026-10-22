import { describe, expect, it } from 'vitest';
import { personalOptimals } from './personal.js';
import { tourRow } from './tour.js';

/**
 * Anchored to TrackMan's published optimiser and tour tables rather than to the
 * code's own output. Each of these was a number the old model got wrong.
 */
const window = (club: Parameters<typeof personalOptimals>[0], speed: number, metric: string) =>
  personalOptimals(club, speed)!.windows.find((w) => w.metric === metric)!;

describe('driver windows', () => {
  it('keeps spin in the optimiser band at any swing speed', () => {
    // 80 mph used to get ~2,090 rpm and 125 mph ~2,770; TrackMan sits at 2.3-2.8k.
    for (const speed of [75, 80, 90, 100, 115, 125]) {
      const spin = window('Dr', speed, 'spinRate').target;
      expect(spin, `${speed} mph`).toBeGreaterThanOrEqual(2400);
      expect(spin, `${speed} mph`).toBeLessThanOrEqual(2700);
    }
  });

  it('allows hitting up to about +5° at every speed', () => {
    // TrackMan's optimiser rewards +5° at 120 mph; the old window topped out below zero.
    for (const speed of [80, 95, 105, 115, 125]) {
      expect(window('Dr', speed, 'attackAngle').max, `${speed} mph`).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('carry targets for slow swings', () => {
  it('does not scale carry in proportion to speed below the lowest anchor', () => {
    // Published figures for an 80 mph driver are 160-180 yards; proportional
    // scaling of the LPGA row gave 186.
    const carry = window('Dr', 80, 'carry').target;
    expect(carry).toBeGreaterThan(155);
    expect(carry).toBeLessThan(182);
  });

  it('still rises with speed', () => {
    expect(window('Dr', 85, 'carry').target).toBeGreaterThan(window('Dr', 80, 'carry').target);
    expect(window('7i', 70, 'carry').target).toBeGreaterThan(window('7i', 62, 'carry').target);
  });
});

describe('smash targets', () => {
  it('stays between the two published tour smash figures at every speed', () => {
    // Smash is a ratio that plateaus. 60-70 mph used to extrapolate a 7-iron to 1.40
    // by extending the line past the tours; the published figures are 1.34 (PGA) and
    // 1.38 (LPGA), so no speed should ask for more than the higher or less than the lower.
    for (const club of ['7i', '8i', 'PW', '5i'] as const) {
      const published = [tourRow(club, 'pga')?.smashFactor, tourRow(club, 'lpga')?.smashFactor]
        .filter((v): v is number => v !== undefined);
      if (published.length < 2) continue;
      for (const speed of [45, 55, 62, 70, 78, 92, 100, 115]) {
        const smash = window(club, speed, 'smashFactor').target;
        expect(smash, `${club} ${speed} mph`).toBeLessThanOrEqual(Math.max(...published) + 1e-9);
        expect(smash, `${club} ${speed} mph`).toBeGreaterThanOrEqual(Math.min(...published) - 1e-9);
      }
    }
  });
});

describe('extreme speeds', () => {
  it('keeps the driver attack target upward at every speed, agreeing with the driver rule', () => {
    // At 125 mph the old window targeted -2.9° while the rule called any negative driver attack a fault.
    for (const speed of [70, 85, 100, 115, 125, 150]) {
      expect(window('Dr', speed, 'attackAngle').target, `${speed} mph`).toBeGreaterThanOrEqual(1);
    }
  });

  it('never lets slow-speed carry collapse toward zero', () => {
    // The two-tour line reached zero near 25-30 mph; a 40 mph PW still carries 40+ yards.
    expect(window('PW', 40, 'carry').target).toBeGreaterThan(40);
    expect(window('PW', 30, 'carry').target).toBeGreaterThan(25);
    for (const speed of [30, 40, 55, 70, 90]) {
      const w = window('PW', speed, 'carry');
      expect(Number.isFinite(w.target) && w.target > 0, `${speed} mph`).toBe(true);
    }
  });
});
