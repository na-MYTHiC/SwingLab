import type { ClubProfile } from '../stats/dispersion.js';
import type { StrikeBreakdown } from '../analysis/strike.js';

/**
 * An estimated handicap from ball-striking data.
 *
 * WHAT THIS IS, AND MORE IMPORTANTLY WHAT IT IS NOT. A handicap is a scoring
 * measure, and roughly 45% of scoring happens inside 100 yards — chipping,
 * bunkers and putting, none of which a range session can see. Course
 * management, nerve and the ability to avoid one blow-up hole are invisible
 * here too.
 *
 * So this estimates *the handicap a player's ball-striking would support*,
 * assuming an ordinary short game. Someone with a sharp short game will play
 * better than this; someone who three-putts will play worse. It is reported
 * as a range rather than a number, and it says out loud what it cannot see.
 *
 * THE ANCHORS. Published dispersion benchmarks for a 7-iron: tour players
 * hold roughly ±8-10 yards, elite amateurs ±10-12, and a 10-handicap ±15-20.
 * Reducing dispersion by five yards is worth something like one to two shots
 * a round. Those points define the curve below.
 *
 * Dispersion is expressed as a share of carry rather than in raw yards, so a
 * wedge and a driver can both feed it. The anchors were set with a 7-iron at
 * about 175 yards, which is where the percentages come from.
 *
 * READING THE ANCHOR CORRECTLY MATTERS ENORMOUSLY. "Tour players hold ±8-10
 * yards" describes a *typical* miss, not the outer edge of a 95% pattern —
 * tour 7-irons finish about 5% of their distance offline on average, which is
 * roughly nine yards at 175. Treating it as a 95% band doubles everyone's
 * dispersion and lands a competent player somewhere near a 27 handicap. The
 * first version of this did exactly that, and produced an estimate that
 * contradicted the strike-efficiency figure sitting next to it on the same
 * screen. So the comparison uses the robust spread directly.
 */

export interface HandicapEstimate {
  /** Midpoint of the estimate. */
  estimate: number;
  /** Honest bounds — the model is not precise enough for a single number. */
  low: number;
  high: number;
  /** What the estimate is built from. */
  basis: {
    club: string;
    dispersionPercent: number;
    strikeQuality: number;
    carryConsistency: number;
  };
  /** How much to trust it. */
  confidence: 'low' | 'medium' | 'high';
  headline: string;
  caveat: string;
}

/*
 * Anchor points: dispersion as a percentage of carry, and the handicap that
 * level of control typically supports.
 *
 *   5.1%  (±9 yds on a 175-yard 7-iron)   scratch
 *   10.0% (±17.5 yds)                     10 handicap
 *   14.3% (±25 yds)                       18 handicap
 *
 * Close enough to linear across that span to treat it as a line, which is a
 * more honest fit than a curve invented to look sophisticated.
 */
const SCRATCH_DISPERSION = 5.1;
const STROKES_PER_PERCENT = 1.93;

export function estimateHandicap(
  profile: ClubProfile | null,
  strike: StrikeBreakdown,
): HandicapEstimate | null {
  if (!profile || !profile.dispersion) return null;

  const carry = profile.carry.median;
  // The typical miss, matching how the published benchmarks are quoted.
  const typicalMiss = profile.side.mad;
  if (!Number.isFinite(carry) || carry <= 0 || !Number.isFinite(typicalMiss)) return null;

  const shots = profile.representativeCount;
  if (shots < 10) return null;

  const dispersionPercent = (typicalMiss / carry) * 100;
  let handicap = (dispersionPercent - SCRATCH_DISPERSION) * STROKES_PER_PERCENT;

  /*
   * Two adjustments, both small on purpose. Dispersion already carries most
   * of the signal — these stop a player who sprays it tidily from being
   * flattered, and stop one who is scattered but striking it beautifully from
   * being punished twice for the same thing.
   */

  // Poor contact costs shots that dispersion alone will not show, because a
  // thin shot can finish straight.
  const strikePenalty = strike.total >= 10 ? (1 - strike.qualityShare) * 6 : 0;

  // Distance control decides whether you can hold a green from the fairway.
  const relativeCarrySpread =
    profile.carry.n >= 8 && Number.isFinite(profile.carry.mad)
      ? profile.carry.mad / carry
      : 0;
  // Gentler than the dispersion term: distance control matters, but it is
  // partly the same fault seen from another angle and should not be counted
  // at full weight twice.
  const carryPenalty = Math.max(0, (relativeCarrySpread - 0.03) * 60);

  handicap += strikePenalty + carryPenalty;
  handicap = Math.max(0, Math.min(36, handicap));

  // The band widens for thinner samples, because it should.
  const spread = shots >= 30 ? 2.5 : shots >= 18 ? 3.5 : 5;
  const confidence = shots >= 30 ? 'high' : shots >= 18 ? 'medium' : 'low';

  const low = Math.max(0, Math.round((handicap - spread) * 10) / 10);
  const high = Math.min(36, Math.round((handicap + spread) * 10) / 10);

  return {
    estimate: Math.round(handicap * 10) / 10,
    low,
    high,
    basis: {
      club: profile.club,
      dispersionPercent,
      strikeQuality: strike.qualityShare,
      carryConsistency: relativeCarrySpread,
    },
    confidence,
    headline:
      handicap <= 2
        ? 'Your ball-striking is at scratch level'
        : `Your ball-striking supports roughly a ${Math.round(low)}–${Math.round(high)} handicap`,
    caveat:
      'Ball-striking only. Around 45% of scoring happens inside 100 yards, and none of it shows up on a range — a sharp short game plays better than this, a shaky one plays worse. Built from your ' +
      `${profile.club} pattern, which is ${dispersionPercent.toFixed(1)}% of your carry distance wide.`,
  };
}
