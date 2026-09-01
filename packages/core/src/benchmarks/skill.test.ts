import { describe, expect, it } from 'vitest';
import {
  dispersionScore, handicapFromPattern, meanRadius, radialPercent, skillBand,
  tourWidthFor, widthPctForHandicap, FLOOR_WIDTH_PCT, TOUR_WIDTH_PCT, SCALE_FLOOR_HANDICAP,
} from './skill.js';

/**
 * These lock the published anchors in place. If someone changes the constants
 * in `skill.ts`, these are the numbers that have to still come out — because
 * the whole value of the scale is that it is calibrated against measured golf
 * rather than against what felt about right.
 */
describe('the skill scale', () => {
  it('puts PGA Tour proximity at a plus handicap', () => {
    // ShotLink: 27 ft 10 in from 150-175 yards in the fairway. A tour card is
    // worth roughly +4 to +6, so this must not come out at scratch.
    const pattern = { sigmaSide: 7.4, sigmaCarry: 7.4, carry: 160 };
    expect(radialPercent(pattern)).toBeCloseTo(5.8, 0);
    expect(handicapFromPattern(pattern)).toBeLessThan(-3);
    expect(handicapFromPattern(pattern)).toBeGreaterThan(-6);
  });

  it('puts a 50-foot proximity from 150 yards near a 15 handicap', () => {
    // Arccos/Shot Scope: ~15 handicap averages about 50 ft from 150 yards.
    const sigma = 16.7 / Math.sqrt(Math.PI / 2);
    const h = handicapFromPattern({ sigmaSide: sigma, sigmaCarry: sigma, carry: 150 });
    expect(h).toBeGreaterThan(13);
    expect(h).toBeLessThan(17);
  });

  it('puts a 10 handicap between the two', () => {
    // ~45 ft from 150 yards.
    const sigma = 15 / Math.sqrt(Math.PI / 2);
    const h = handicapFromPattern({ sigmaSide: sigma, sigmaCarry: sigma, carry: 150 });
    expect(h).toBeGreaterThan(8);
    expect(h).toBeLessThan(13);
  });

  it('counts both axes, so distance control cannot be ignored', () => {
    const carry = 170;
    const lateralOnly = { sigmaSide: 14, sigmaCarry: 4, carry };
    const bothWide = { sigmaSide: 14, sigmaCarry: 14, carry };
    expect(handicapFromPattern(bothWide)).toBeGreaterThan(handicapFromPattern(lateralOnly));
  });

  it('treats a yard offline as worse on a wedge than on a driver', () => {
    const wedge = handicapFromPattern({ sigmaSide: 6, sigmaCarry: 6, carry: 100 });
    const midIron = handicapFromPattern({ sigmaSide: 6, sigmaCarry: 6, carry: 175 });
    expect(wedge).toBeGreaterThan(midIron);
  });

  it('gives 100 for dispersion only at tour width, not before', () => {
    const carry = 170;
    expect(dispersionScore(tourWidthFor(carry), carry)).toBeCloseTo(100, 0);
    // A hair wider than tour is no longer a perfect score.
    expect(dispersionScore(tourWidthFor(carry) * 1.1, carry)).toBeLessThan(100);
    // And better than tour does not overflow.
    expect(dispersionScore(tourWidthFor(carry) * 0.5, carry)).toBe(100);
  });

  it('bottoms out at the 30-handicap width rather than well inside it', () => {
    const carry = 150;
    const floorWidth = (FLOOR_WIDTH_PCT / 100) * carry;
    expect(dispersionScore(floorWidth, carry)).toBeCloseTo(0, 0);
    // The old scale gave zero at 30% of carry, which is ordinary for a mid
    // handicap. Anything in that region must now score well above zero.
    expect(dispersionScore(carry * 0.3, carry)).toBeGreaterThan(30);
  });

  it('places tour width around a fifth of the carry distance', () => {
    // 30 yards wide on a 160-yard 7-iron. The widely quoted "tour is inside
    // 15 yards" cannot be a 95% band and is not what this uses.
    expect(TOUR_WIDTH_PCT).toBeGreaterThan(17);
    expect(TOUR_WIDTH_PCT).toBeLessThan(21);
    expect(tourWidthFor(160)).toBeGreaterThan(28);
    expect(tourWidthFor(160)).toBeLessThan(33);
  });

  it('spans tour to 30 handicap across the width scale', () => {
    expect(FLOOR_WIDTH_PCT / TOUR_WIDTH_PCT).toBeGreaterThan(2);
    expect(SCALE_FLOOR_HANDICAP).toBe(30);
  });

  it('survives a missing axis rather than returning NaN', () => {
    expect(meanRadius({ sigmaSide: 10, sigmaCarry: Number.NaN, carry: 150 })).toBeCloseTo(10 * Math.sqrt(Math.PI / 2), 3);
    expect(Number.isNaN(meanRadius({ sigmaSide: NaN, sigmaCarry: NaN, carry: 150 }))).toBe(true);
  });

  it('describes bands in words a player would use', () => {
    expect(skillBand(-2)).toContain('tour');
    expect(skillBand(8)).toContain('single figures');
    expect(skillBand(28)).toContain('high handicap');
  });
});

/**
 * Cross-checks against the rest of the engine. These exist because the whole
 * point of one shared scale is that nothing else in the app is allowed to
 * carry its own private idea of what "wide" means.
 */
describe('nothing contradicts the scale', () => {
  it('never calls a tour-standard pattern a fault', () => {
    // The old rule flagged anything wider than 16% of carry, which is inside
    // tour standard — it reported a tour player's pattern to them as a
    // problem. Nothing may be flagged until well past tour.
    expect(widthPctForHandicap(5)).toBeGreaterThan(TOUR_WIDTH_PCT);
    expect(widthPctForHandicap(-4)).toBeCloseTo(TOUR_WIDTH_PCT, 5);
  });

  it('orders the handicap thresholds the way handicaps are ordered', () => {
    expect(widthPctForHandicap(0)).toBeLessThan(widthPctForHandicap(10));
    expect(widthPctForHandicap(10)).toBeLessThan(widthPctForHandicap(20));
    expect(widthPctForHandicap(30)).toBeCloseTo(FLOOR_WIDTH_PCT, 5);
  });

  it('makes the tour-width milestone reachable rather than superhuman', () => {
    // The old milestone asked for 30 yards on any club. On a 170-yard iron
    // that is tighter than tour, so nobody could ever earn it.
    expect(tourWidthFor(170)).toBeGreaterThan(30);
  });
});
