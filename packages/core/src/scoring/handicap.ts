import type { ClubProfile } from '../stats/dispersion.js';
import type { StrikeBreakdown } from '../analysis/strike.js';
import {
  handicapFromPattern, radialPercent, skillBand, SCALE_FLOOR_HANDICAP,
} from '../benchmarks/skill.js';

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
 * The scale itself lives in `benchmarks/skill.ts`, together with the published
 * data behind it and an honest note about where two credible datasets
 * disagree. It is deliberately shared with the Dispersion score so that the
 * two numbers on screen are two views of one measurement rather than two
 * independent guesses — an earlier version had them separate and showed
 * "Dispersion 0/100" directly above "handicap 7-12".
 *
 * BOTH AXES COUNT. Proximity is radial: a shot twenty yards short costs what a
 * shot twenty yards left costs. Judging a player on lateral spread alone
 * flatters someone who sprays it a consistent distance and punishes someone
 * whose only fault is distance control, so the estimate uses the two spreads
 * together.
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
    /** Mean distance from the centre of the pattern, as % of carry. */
    radialPercent: number;
    /** Lateral 95% width in yards. */
    widthYards: number;
    /** Carry spread (one sigma) in yards. */
    carrySigma: number;
    strikeQuality: number;
  };
  /** How much to trust it. */
  confidence: 'low' | 'medium' | 'high';
  headline: string;
  band: string;
  caveat: string;
}

/**
 * Across the bag, not just the most-hit club.
 *
 * Every session-level number used to come from whichever club had the most
 * shots, so a bag session was graded on its 7-iron and the driver might as
 * well not have been hit. Each club's pattern is expressed as a share of its
 * own carry, so they are directly comparable and can be averaged — weighted by
 * shots, because a club hit six times should not outvote one hit thirty.
 *
 * Falls back to the single-club behaviour when there is only one club, which
 * is the common case and gives exactly the same answer.
 */
export function estimateHandicapAcrossBag(
  profiles: ClubProfile[],
  strike: StrikeBreakdown,
): HandicapEstimate | null {
  const usable = profiles.filter((p) => p.representativeCount >= 10);
  if (usable.length === 0) return null;
  if (usable.length === 1) return estimateHandicap(usable[0] as ClubProfile, strike);

  const parts = usable
    .map((p) => ({ profile: p, estimate: estimateHandicap(p, strike) }))
    .filter((x): x is { profile: ClubProfile; estimate: HandicapEstimate } => x.estimate !== null);
  if (parts.length === 0) return null;

  const weight = parts.reduce((sum, x) => sum + x.profile.representativeCount, 0);
  const mean = (read: (x: (typeof parts)[number]) => number) =>
    parts.reduce((sum, x) => sum + read(x) * x.profile.representativeCount, 0) / weight;

  const estimate = mean((x) => x.estimate.estimate);
  const shots = parts.reduce((sum, x) => sum + x.profile.representativeCount, 0);
  const spreadBand = shots >= 45 ? 2.5 : shots >= 30 ? 3 : 4;
  const clubs = parts.map((x) => x.profile.club).join(', ');

  return {
    estimate: Math.round(estimate * 10) / 10,
    low: Math.round((estimate - spreadBand) * 10) / 10,
    high: Math.round((estimate + spreadBand) * 10) / 10,
    basis: {
      club: clubs,
      radialPercent: mean((x) => x.estimate.basis.radialPercent),
      widthYards: mean((x) => x.estimate.basis.widthYards),
      carrySigma: mean((x) => x.estimate.basis.carrySigma),
      strikeQuality: strike.qualityShare,
    },
    // More clubs is a better sample of a player than more shots with one club.
    confidence: parts.length >= 3 && shots >= 40 ? 'high' : shots >= 25 ? 'medium' : 'low',
    band: skillBand(estimate),
    headline: estimate <= 0
      ? 'Your ball-striking is at scratch level or better'
      : `Your ball-striking supports roughly a ${Math.round(estimate - spreadBand)}-` +
        `${Math.round(estimate + spreadBand)} handicap`,
    caveat:
      `Averaged across ${parts.length} clubs (${clubs}), weighted by how many shots you hit with ` +
      `each. Ball-striking only — around 45% of scoring happens inside 100 yards and none of it ` +
      `shows up on a range.`,
  };
}

export function estimateHandicap(
  profile: ClubProfile | null,
  strike: StrikeBreakdown,
): HandicapEstimate | null {
  if (!profile) return null;

  const carry = profile.carry.median;
  const sigmaSide = profile.side.mad;
  const sigmaCarry = profile.carry.mad;
  if (!Number.isFinite(carry) || carry <= 0) return null;
  if (!Number.isFinite(sigmaSide) && !Number.isFinite(sigmaCarry)) return null;

  const shots = profile.representativeCount;
  if (shots < 10) return null;

  const spread = { sigmaSide, sigmaCarry, carry };
  const pct = radialPercent(spread);
  if (!Number.isFinite(pct)) return null;

  let handicap = handicapFromPattern(spread);

  /*
   * One adjustment, and a small one. The pattern already carries almost all
   * of the signal — it is, after all, the thing that decides where the ball
   * finishes. Strike quality is added because a thin or heel-struck shot can
   * still finish near the target on a mat while costing a stroke on grass out
   * of a real lie, which is a cost the pattern cannot see.
   */
  const strikePenalty = strike.total >= 10 ? (1 - strike.qualityShare) * 5 : 0;
  handicap += strikePenalty;
  handicap = Math.max(-6, Math.min(SCALE_FLOOR_HANDICAP + 6, handicap));

  /*
   * The band has to be wide enough to contain the disagreement between the
   * two datasets behind the scale, not just sampling noise. Three strokes
   * either side at a good sample size is roughly that gap; thinner samples
   * widen it further.
   */
  const spreadBand = shots >= 30 ? 3 : shots >= 18 ? 4 : 5.5;
  const confidence = shots >= 30 ? 'high' : shots >= 18 ? 'medium' : 'low';

  const low = Math.round((handicap - spreadBand) * 10) / 10;
  const high = Math.round((handicap + spreadBand) * 10) / 10;
  const width = Number.isFinite(sigmaSide) ? sigmaSide * 4 : Number.NaN;

  return {
    estimate: Math.round(handicap * 10) / 10,
    low,
    high,
    basis: {
      club: profile.club,
      radialPercent: pct,
      widthYards: width,
      carrySigma: sigmaCarry,
      strikeQuality: strike.qualityShare,
    },
    confidence,
    band: skillBand(handicap),
    headline:
      handicap <= 0
        ? 'Your ball-striking is at scratch level or better'
        : `Your ball-striking supports roughly a ${Math.round(low)}-${Math.round(high)} handicap`,
    caveat:
      `Your ${profile.club} finishes an average of ${pct.toFixed(1)}% of its carry from the ` +
      `middle of your own pattern; a tour player is nearer 5.8%. Ball-striking only — around ` +
      `45% of scoring happens inside 100 yards and none of it shows up on a range, so a sharp ` +
      `short game plays better than this and a shaky one plays worse.`,
  };
}
