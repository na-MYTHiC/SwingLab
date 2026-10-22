import { describe, expect, it } from 'vitest';
import { personalOptimals } from './personal.js';

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
  it('never asks a 7-iron for more than the tour ceiling at any speed', () => {
    // 60-70 mph used to extrapolate to 1.40, while the ceiling for the club is 1.34.
    for (const speed of [55, 62, 70, 78, 92, 100]) {
      expect(window('7i', speed, 'smashFactor').target, `${speed} mph`).toBeLessThanOrEqual(1.38);
    }
  });
});
