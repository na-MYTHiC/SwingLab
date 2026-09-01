import { describe, expect, it } from 'vitest';
import { evaluateTargets, nextTarget, targetFrom } from './targets.js';
import type { Shot, ShotSession } from '../schema.js';

function shots(over: (i: number) => Partial<Shot>, n = 30): Shot[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, source: 'trackman-csv' as const, time: new Date(2026, 0, 1, 10, i),
    club: '7i' as const, clubSpeed: 87, ballSpeed: 115, smashFactor: 1.32,
    attackAngle: -3.4, clubPath: 0.2, faceAngle: 0.3, faceToPath: 0.1,
    dynamicLoft: 25, spinLoft: 28, lowPointDistance: 3, impactOffset: 0, impactHeight: 0,
    launchAngle: 17, launchDirection: 0.3, spinRate: 6800, spinAxis: 0,
    carry: 169, total: 178, side: 0, curve: 0, apexHeight: 30, landingAngle: 47,
    targetDistance: null, proximity: null, shotScore: null, spinMeasured: true,
    lowPointSide: null, swingRadius: null, dynamicLie: null, flags: [],
    ...over(i),
  } as Shot));
}

function session(list: Shot[]): ShotSession {
  return {
    id: 'x', source: 'trackman-csv', kind: 'range', sourceRef: 'x',
    handedness: 'right', startedAt: new Date(2026, 0, 2), shots: list,
  };
}

/** Alternating spread of ±`s`, so the robust spread is predictable. */
const spread = (s: number) => (i: number) => ({ carry: 169 + (i % 2 ? s : -s) });

describe('practice targets', () => {
  it('asks for a step from where the player is, not for the benchmark', () => {
    const t = targetFrom('carrySpread', '7i', 12, 7.9);
    expect(t.value).toBeLessThan(12);
    expect(t.value).toBeGreaterThan(7.9);
    expect(t.baseline).toBe(12);
  });

  it('asks for a smaller step the closer the player already is', () => {
    const farAway = targetFrom('carrySpread', '7i', 20, 7.9);
    const nearly = targetFrom('carrySpread', '7i', 9, 7.9);
    const cut = (t: { baseline: number | null; value: number }) =>
      ((t.baseline as number) - t.value) / (t.baseline as number);
    expect(cut(farAway)).toBeGreaterThan(cut(nearly));
  });

  it('never sets a target the player has already beaten', () => {
    // Already better than tour: the bar must not move backwards to meet them.
    const t = targetFrom('carrySpread', '7i', 6, 7.9);
    expect(t.value).toBeLessThanOrEqual(6);
  });

  it('never sets a target that rounds to today’s number', () => {
    // "Get your 4% down to 4%" is not a target, it is today with a label on it.
    const t = targetFrom('unusableRate', null, 4.44, 0);
    expect(t.value).not.toBe(t.baseline);
    expect(t.value).toBeLessThan(t.baseline as number);
  });

  it('respects physical bounds', () => {
    /*
     * A player who topped nothing was being asked for "no more than -0.1% of
     * shots topped", because the no-op nudge pushed a zero one display unit
     * further down. A rate cannot go below zero and a share cannot exceed 100.
     */
    const clean = targetFrom('unusableRate', null, 0, 0);
    expect(clean.value).toBe(0);
    expect(clean.label).toMatch(/Hold/);

    const perfect = targetFrom('strikeQuality', null, 100, 95);
    expect(perfect.value).toBeLessThanOrEqual(100);
  });

  it('marks a session that met the mark', () => {
    const target = targetFrom('carrySpread', '7i', 12, 7.9);
    const [result] = evaluateTargets([target], session(shots(spread(2))));
    expect(result!.met).toBe(true);
    expect(result!.improved).toBe(true);
    expect(result!.verdict).toMatch(/Hit it/);
  });

  it('separates moving the right way from actually hitting the mark', () => {
    const target = targetFrom('carrySpread', '7i', 20, 7.9);
    // Better than the 20 it was set from, still short of the target.
    const [result] = evaluateTargets([target], session(shots(spread(12.8))));
    expect(result!.met).toBe(false);
    expect(result!.improved).toBe(true);
    expect(result!.verdict).toMatch(/right way/);
  });

  it('says so rather than guessing when the club is absent', () => {
    const target = targetFrom('carrySpread', 'Dr', 12, 7.9);
    const [result] = evaluateTargets([target], session(shots(spread(2))));
    expect(result!.met).toBeNull();
    expect(result!.verdict).toMatch(/No Dr shots/);
  });

  it('cleans the follow-up the same way the baseline was cleaned', () => {
    /*
     * The baseline came from outlier-flagged numbers. Measuring a raw
     * follow-up against it would show an improvement that is entirely an
     * artefact of the two being computed differently.
     */
    const withDuff = shots(spread(2));
    withDuff[0] = { ...(withDuff[0] as Shot), carry: 40, ballSpeed: 55 };
    const target = targetFrom('carrySpread', '7i', 12, 7.9);
    const [result] = evaluateTargets([target], session(withDuff));
    expect(result!.actual).toBeLessThan(6);
  });

  it('tightens after a hit and holds after one miss', () => {
    const target = targetFrom('carrySpread', '7i', 12, 7.9);
    const [hit] = evaluateTargets([target], session(shots(spread(2))));
    const tightened = nextTarget(hit!, 7.9);
    expect(tightened.value).toBeLessThan(target.value);

    const [missed] = evaluateTargets([target], session(shots(spread(14))));
    expect(nextTarget(missed!, 7.9).value).toBe(target.value);
  });

  it('resets the bar after two misses rather than blaming the player', () => {
    const target = targetFrom('carrySpread', '7i', 12, 7.9);
    const [missed] = evaluateTargets([target], session(shots(spread(14))));
    const loosened = nextTarget(missed!, 7.9, 2);
    expect(loosened.value).toBeGreaterThan(target.value);
    expect(loosened.value).toBeLessThan(missed!.actual as number);
  });
});
