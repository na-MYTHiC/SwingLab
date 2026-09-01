import { describe, expect, it } from 'vitest';
import {
  carryFactor, describe as describeConditions, parseConditions, toReference, toReferenceFrame,
} from './conditions.js';

/**
 * The line the real TrackMan export actually carries. Every number in this
 * file was inflated 6% by air until it was read.
 */
const REAL = 'Data are normalized to no wind conditions at 4700 ft altitude, '
  + '76.99999999999994 ℉ with a Premium ball';

describe('conditions', () => {
  it('reads the line the real export carries', () => {
    const c = parseConditions(REAL);
    expect(c.altitudeFeet).toBe(4700);
    expect(Math.round(c.temperatureF as number)).toBe(77);
    expect(c.ball).toBe('Premium');
    expect(c.windNormalised).toBe(true);
  });

  it('matches the published altitude coefficient', () => {
    // Titleist: 1.16% per 1,000 ft, so Denver's 5,280 ft is about 6.1%.
    const denver = carryFactor(parseConditions('at 5280 ft altitude, 70 F'));
    expect((denver - 1) * 100).toBeCloseTo(6.1, 1);
  });

  it('turns a mountain carry back into a sea-level one', () => {
    // 169 yards at 4,700 ft and 77 °F is about 159 at sea level.
    const back = toReference(169, parseConditions(REAL));
    expect(back).toBeGreaterThan(157);
    expect(back).toBeLessThan(161);
  });

  it('reads metric and Celsius exports too', () => {
    const c = parseConditions('normalized at 1500 m altitude, 21 ℃');
    expect(Math.round(c.altitudeFeet as number)).toBe(4921);
    expect(Math.round(c.temperatureF as number)).toBe(70);
  });

  it('does nothing at all when it cannot read the line', () => {
    expect(carryFactor(parseConditions('some future wording'))).toBe(1);
    expect(carryFactor(parseConditions(null))).toBe(1);
    // Sessions stored before this existed have no conditions field.
    expect(carryFactor(undefined)).toBe(1);
    expect(describeConditions(undefined)).toBeNull();
  });

  it('scales flight distances and leaves impact numbers alone', () => {
    const shots = [{
      carry: 169, total: 178, side: 5, apexHeight: 30, ballSpeed: 115, spinRate: 5930,
    }];
    const [out] = toReferenceFrame(shots as never, parseConditions(REAL)) as unknown as typeof shots;
    expect(out!.carry).toBeLessThan(162);
    // Ball speed and spin happen at impact; the air afterwards cannot change them.
    expect(out!.ballSpeed).toBe(115);
    expect(out!.spinRate).toBe(5930);
  });

  it('refuses an implausible correction rather than trusting a misread line', () => {
    expect(carryFactor(parseConditions('at 900000 ft altitude'))).toBeLessThanOrEqual(1.3);
  });
});
