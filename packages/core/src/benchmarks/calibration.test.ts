import { describe, expect, it } from 'vitest';
import {
  greenHoldRate, handicapFromPattern, meanRadius, MEAN_RADIUS_PER_SIGMA,
} from './skill.js';

/**
 * Calibration: does the scale still say what the published data says?
 *
 * Every other test in this package checks that the code does what the code
 * intends. This one checks that what the code intends still matches the
 * outside world, by feeding it patterns reconstructed from the figures cited
 * in `skill.ts` and asserting the skill level that comes back.
 *
 * It exists because the app spent a long time confidently over-rating people.
 * The scale was never the problem — it was fed the wrong quantity. The scale
 * is defined over radial distance from the TARGET, which is what ShotLink,
 * Arccos and Shot Scope all report; the app handed it the spread about the
 * player's own centre, from shots with the mishits already removed. That
 * compares a player's precision against everybody else's accuracy, and it
 * read a 50-yard-wide pattern sitting twelve yards right of the line as a
 * six handicap.
 *
 * ON REFRESHING THESE NUMBERS. An attempt was made to widen the anchor set
 * from Arccos and Shot Scope proximity tables. Every golf domain is blocked
 * by this environment's network policy, so no primary source could be opened,
 * and the search summaries that were readable did not survive arithmetic: one
 * put a 5 handicap 23.7 yards from the hole and a 10 handicap 22.3, against
 * the 16.7 yards already cited here for a 15 handicap — a 5 handicap cannot
 * be further from the flag than a 15. Re-sloping the scale on that would have
 * been worse than leaving it alone, so it was left alone. The anchors below
 * are the ones `skill.ts` already documents and nothing here is new data.
 */

/** The sigma of an unbiased two-axis pattern with a given mean radius. */
const sigmaFor = (proximityYards: number) => proximityYards / MEAN_RADIUS_PER_SIGMA;

const pattern = (proximityYards: number, carry: number) => ({
  sigmaSide: sigmaFor(proximityYards),
  sigmaCarry: sigmaFor(proximityYards),
  carry,
});

describe('calibration against the published anchors', () => {
  it('puts PGA Tour proximity at the tour end of the scale', () => {
    // ShotLink: 27 ft 10 in from 150-175 yards = 9.3 yards.
    expect(handicapFromPattern(pattern(9.3, 160))).toBeCloseTo(-4, 0);
  });

  it('puts the cited 15-handicap proximity at 15', () => {
    // ~50 ft at 150 yards = 16.7 yards.
    expect(handicapFromPattern(pattern(16.7, 150))).toBeCloseTo(15, 0);
  });

  it('agrees with itself about a 15 handicap from two directions', () => {
    /*
     * The invariant that would have caught the bug. A pattern is turned into
     * a skill level twice by completely separate routes — radial proximity
     * against the handicap line, and geometric green-holding against a
     * 13.9-yard circle. They have to land on the same player.
     *
     * `skill.ts` documents the second route putting a 15 handicap's pattern
     * "nearer 40%". Before the fix the same session read 6.2 handicap and a
     * 56% hold rate, which is not a player who exists.
     */
    const p = pattern(16.7, 150);
    expect(handicapFromPattern(p)).toBeCloseTo(15, 0);
    expect(greenHoldRate(p)).toBeGreaterThan(0.36);
    expect(greenHoldRate(p)).toBeLessThan(0.46);
  });

  it('keeps a tour pattern short of certainty on a green', () => {
    // A ceiling, not a prediction: flat lie, no wind, aimed at the middle.
    // Tour greens in regulation from this range runs nearer 70% in the real
    // world, so anything at or above ~95% here would mean the model had
    // stopped describing golf.
    const rate = greenHoldRate(pattern(9.3, 160));
    expect(rate).toBeGreaterThan(0.7);
    expect(rate).toBeLessThan(0.9);
  });
});

describe('aim bias is part of the measurement', () => {
  const spread = { sigmaSide: 12.58, sigmaCarry: 9.21, carry: 175 };

  it('charges for a pattern that sits off the target line', () => {
    const centred = handicapFromPattern({ ...spread, biasSide: 0 });
    const offset = handicapFromPattern({ ...spread, biasSide: 12.46 });
    expect(offset).toBeGreaterThan(centred + 5);
  });

  it('gets steadily worse the further off line the pattern sits', () => {
    const at = (b: number) => handicapFromPattern({ ...spread, biasSide: b });
    expect(at(0)).toBeLessThan(at(6));
    expect(at(6)).toBeLessThan(at(12));
    expect(at(12)).toBeLessThan(at(20));
  });

  it('costs green-holding too, by the same pattern', () => {
    const at = (b: number) => greenHoldRate({ ...spread, biasSide: b });
    expect(at(0)).toBeGreaterThan(at(12));
    expect(at(12)).toBeGreaterThan(at(20));
  });

  it('treats left and right alike', () => {
    expect(handicapFromPattern({ ...spread, biasSide: 11 }))
      .toBeCloseTo(handicapFromPattern({ ...spread, biasSide: -11 }), 6);
  });

  it('reduces to the closed form when there is no bias', () => {
    const s = { sigmaSide: 9, sigmaCarry: 9, carry: 160 };
    expect(meanRadius(s)).toBeCloseTo(9 * MEAN_RADIUS_PER_SIGMA, 3);
    expect(meanRadius({ ...s, biasSide: 0 })).toBeCloseTo(9 * MEAN_RADIUS_PER_SIGMA, 3);
  });
});

describe('the session that exposed all of this', () => {
  /*
   * Reconstructed from a real 35-shot 7-iron range session: 50 yards of
   * lateral width, carry repeating to nine yards, and the whole pattern
   * sitting twelve and a half yards right of the target line. The app read it
   * as a 2-10 handicap next to a Reliability score of 14 out of 100.
   */
  const real = { sigmaSide: 12.58, sigmaCarry: 9.21, carry: 174.95, biasSide: 12.46 };

  it('does not call it single figures', () => {
    expect(handicapFromPattern(real)).toBeGreaterThan(10);
  });

  it('does not claim it holds half the greens it plays to', () => {
    expect(greenHoldRate(real)).toBeLessThan(0.45);
  });
});
