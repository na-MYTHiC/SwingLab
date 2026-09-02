import type { Club } from '../schema.js';
import { tourRow, type TourRow, type TourSet } from './tour.js';

/**
 * Personal optimal numbers, interpolated between the two tours by swing speed.
 *
 * This is the useful form of a benchmark. "Tour players carry a 7-iron 176"
 * is trivia to someone who swings it at 80 mph. "At your speed, a well-struck
 * 7-iron should launch 17° with 6,900 rpm and carry 164" is a target they can
 * work towards and check themselves against.
 *
 * WHY INTERPOLATE RATHER THAN SCALE. An earlier version of this assumed
 * attack angle and launch angle were speed-independent and scaled the rest
 * linearly. Having both tour tables side by side shows that is wrong, and
 * interestingly so:
 *
 *   - PGA driver attack angle is -0.9°; LPGA is **+2.8°**. Slower swings
 *     should hit *up* on a driver considerably more, because that is how you
 *     buy carry when you cannot buy it with speed.
 *   - PGA 7-iron launches 16.1°; LPGA launches **18.5°**. Slower swings need
 *     a higher launch to hold the same flight.
 *   - PGA 7-iron smash is 1.34; LPGA is **1.38** — higher, not lower.
 *
 * None of that falls out of a scaling law. It falls out of two populations
 * who have each optimised for their own speed, which is exactly what a player
 * in between should be aiming at. So every metric is interpolated between the
 * two rows using the player's club speed, and the tables do the work instead
 * of an assumption.
 *
 * OUTSIDE THE ANCHORS. Below LPGA speed or above PGA speed the figures are
 * extrapolated, which is a weaker claim — the trend is real but nothing
 * guarantees it continues. Those windows are widened and flagged, because a
 * confident target for a 60 mph swing is not something these tables can
 * support.
 */

/** Where a target came from, so the player can judge how much to trust it. */
export type OptimalBasis =
  /** Your speed sits between the two tours; the target is interpolated. */
  | 'between-tours'
  /** Your speed is outside both; the trend is extended and is less certain. */
  | 'extrapolated';

export interface OptimalWindow {
  metric: string;
  label: string;
  /** The number to aim at. */
  target: number;
  /** Bottom of the acceptable band. */
  min: number;
  /** Top of the acceptable band. */
  max: number;
  unit: string;
  basis: OptimalBasis;
  /** Why this target is this number, for a player who wants to argue with it. */
  why: string;
}

export interface PersonalOptimals {
  club: Club;
  /** The club speed these were derived for. */
  clubSpeed: number;
  tourClubSpeed: number;
  /** How the player's speed compares, as a ratio. */
  speedRatio: number;
  windows: OptimalWindow[];
}

/**
 * Build the optimal windows for one club at one swing speed.
 *
 * Returns null rather than guessing when there is no tour row for the club —
 * gap and sand wedges have no published figures, and a made-up target is
 * worse than no target.
 */
interface Anchor { speed: number; row: TourRow }

/**
 * The two reference rows for a club, ordered slower first.
 *
 * Some clubs appear in only one table — there is no LPGA 3-iron — in which
 * case there is one anchor and the older scaling behaviour is the only option
 * available. That is stated rather than hidden.
 */
function anchorsFor(club: Club): { slow: Anchor | null; fast: Anchor | null } {
  const pga = tourRow(club, 'pga');
  const lpga = tourRow(club, 'lpga');
  return {
    slow: lpga ? { speed: lpga.clubSpeed, row: lpga } : null,
    fast: pga ? { speed: pga.clubSpeed, row: pga } : null,
  };
}

/** Linear blend of one field between the anchors; t may fall outside [0,1]. */
function blend(slow: TourRow, fast: TourRow, key: keyof TourRow, t: number): number {
  return slow[key] + (fast[key] - slow[key]) * t;
}

export function personalOptimals(
  club: Club,
  clubSpeed: number,
  _set: TourSet = 'pga',
): PersonalOptimals | null {
  if (!Number.isFinite(clubSpeed) || clubSpeed <= 0) return null;
  const { slow, fast } = anchorsFor(club);
  if (!slow && !fast) return null;

  // With only one anchor there is nothing to interpolate along, so fall back
  // to scaling that row — less well grounded, and said so.
  if (!slow || !fast) {
    const only = (slow ?? fast) as Anchor;
    const ratio = clubSpeed / only.speed;
    return build(club, clubSpeed, only.row, ratio, 'extrapolated', only.speed, only.speed);
  }

  const t = (clubSpeed - slow.speed) / (fast.speed - slow.speed);
  const inside = t >= 0 && t <= 1;

  /*
   * Clamp the *shape* of the delivery, but not its magnitude.
   *
   * Attack angle, launch and smash plateau sensibly outside the anchors —
   * nobody should be told to hit 8° up on a driver because the line kept
   * going. Carry, ball speed and spin do not plateau: they track speed all
   * the way down, and freezing them produced a 75 mph and an 85 mph player
   * being handed the same 188-yard driver target, which is nonsense at one
   * end and demoralising at the other.
   *
   * So the two kinds are computed differently: shape from the clamped blend,
   * magnitude from the nearer anchor scaled by the player's actual speed.
   */
  const tSafe = Math.max(-0.6, Math.min(1.6, t));
  const nearer = Math.abs(clubSpeed - slow.speed) <= Math.abs(clubSpeed - fast.speed) ? slow : fast;

  const row: TourRow = {
    clubSpeed,
    attackAngle: blend(slow.row, fast.row, 'attackAngle', tSafe),
    smashFactor: blend(slow.row, fast.row, 'smashFactor', tSafe),
    launchAngle: blend(slow.row, fast.row, 'launchAngle', tSafe),
    spinRate: blend(slow.row, fast.row, 'spinRate', tSafe),
    apexHeight: blend(slow.row, fast.row, 'apexHeight', tSafe),
    landingAngle: blend(slow.row, fast.row, 'landingAngle', tSafe),
    carry: blend(slow.row, fast.row, 'carry', tSafe),
  };

  // Inside the anchors the blend already tracks speed correctly, so the
  // magnitudes are taken from it. Outside, they are scaled from the nearer
  // anchor instead, which keeps them moving with the player's real speed.
  const magnitudeScale = inside ? 1 : clubSpeed / nearer.speed;
  if (!inside) {
    row.spinRate = nearer.row.spinRate;
    row.carry = nearer.row.carry;
  }

  return build(
    club, clubSpeed, row, magnitudeScale,
    inside ? 'between-tours' : 'extrapolated',
    slow.speed, fast.speed,
  );
}

function build(
  club: Club,
  clubSpeed: number,
  row: TourRow,
  scale: number,
  basis: OptimalBasis,
  slowSpeed: number,
  fastSpeed: number,
): PersonalOptimals {
  // An extrapolated target deserves a wider band than an interpolated one.
  const slack = basis === 'extrapolated' ? 1.5 : 1;
  const anchorNote =
    basis === 'between-tours'
      ? `Interpolated between the two tours, who swing this club at ${slowSpeed} and ${fastSpeed} mph.`
      : `Your speed is outside both tour averages (${slowSpeed}-${fastSpeed} mph), so this extends the trend rather than reading it off. Treat it as a direction.`;

  const spin = row.spinRate * scale;
  const carry = row.carry * scale;
  const ballSpeed = clubSpeed * row.smashFactor;

  const windows: OptimalWindow[] = [
    {
      metric: 'attackAngle',
      label: 'Attack angle',
      target: row.attackAngle,
      min: row.attackAngle - 1.5 * slack,
      max: row.attackAngle + 1.5 * slack,
      unit: '°',
      basis,
      why:
        club === 'Dr'
          ? `Slower swings should hit further up on a driver — tour men average -0.9° and tour women +2.8°, because hitting up buys carry you cannot buy with speed. ${anchorNote}`
          : `Both tours strike down on this club, and the slower one does so less steeply. ${anchorNote}`,
    },
    {
      metric: 'smashFactor',
      label: 'Smash factor',
      target: row.smashFactor,
      min: row.smashFactor - 0.04 * slack,
      max: row.smashFactor + 0.02,
      unit: '',
      basis,
      why: `A ratio, so it is the one headline number you can match outright at any speed. ${anchorNote}`,
    },
    {
      metric: 'launchAngle',
      label: 'Launch angle',
      target: row.launchAngle,
      min: row.launchAngle - 2 * slack,
      max: row.launchAngle + 2 * slack,
      unit: '°',
      basis,
      why: `Slower swings need a higher launch to hold the same flight — the two tours differ by over two degrees with a 7-iron. ${anchorNote}`,
    },
    {
      metric: 'spinRate',
      label: 'Spin rate',
      target: Math.round(spin),
      min: Math.round(spin * (1 - 0.15 * slack)),
      max: Math.round(spin * (1 + 0.15 * slack)),
      unit: 'rpm',
      basis,
      why: `The spin your delivery should produce at your speed. ${anchorNote}`,
    },
    {
      metric: 'ballSpeed',
      label: 'Ball speed',
      target: ballSpeed,
      min: clubSpeed * (row.smashFactor - 0.04 * slack),
      max: clubSpeed * (row.smashFactor + 0.02),
      unit: 'mph',
      basis,
      why: 'Your club speed multiplied by a strike as good as tour makes at your speed. This ball speed is already available to you.',
    },
    {
      metric: 'carry',
      label: 'Carry',
      target: carry,
      min: carry * (1 - 0.06 * slack),
      max: carry * (1 + 0.06 * slack),
      unit: 'yds',
      basis,
      why: `Not a tour player's distance — yours, if you struck it as well as they do. ${anchorNote}`,
    },
  ];

  return { club, clubSpeed, tourClubSpeed: fastSpeed, speedRatio: clubSpeed / fastSpeed, windows };
}

export type OptimalStatus = 'on-target' | 'below' | 'above' | 'unknown';

export interface OptimalComparison {
  window: OptimalWindow;
  actual: number;
  status: OptimalStatus;
  /** Distance outside the window, in the metric's own unit. Zero when inside. */
  miss: number;
  /** Shot-to-shot spread of this metric, one sigma, in the metric's own unit. */
  spread: number;
  /**
   * Does a typical shot land in the window, rather than only the middle one?
   *
   * The median can sit dead centre while the shots either side of it are
   * nowhere near. A session with a spin median of 6,028 inside a 5,946-8,045
   * window looks settled until you notice the shots ran from 3,509 to 7,193.
   * This asks the stronger question, and it is what a claim like "every
   * number is dialled in" has to be built on — otherwise the app hands out a
   * gold medal reading "nothing left to correct" to a session with three
   * duffs and a fifty-yard pattern, which it did.
   */
  repeatablyInside: boolean;
}

/** Compare one measured median against its window. */
export function compareToOptimal(
  window: OptimalWindow,
  actual: number,
  spread = Number.NaN,
): OptimalComparison {
  const inside = (v: number) => v >= window.min && v <= window.max;
  // Unknown spread must not be read as a tight one, so it fails the test.
  const repeatablyInside =
    Number.isFinite(actual) && Number.isFinite(spread) &&
    inside(actual) && inside(actual - spread) && inside(actual + spread);

  if (!Number.isFinite(actual)) {
    return { window, actual, status: 'unknown', miss: 0, spread, repeatablyInside: false };
  }
  if (actual < window.min) {
    return {
      window, actual, status: 'below', miss: window.min - actual, spread, repeatablyInside,
    };
  }
  if (actual > window.max) {
    return {
      window, actual, status: 'above', miss: actual - window.max, spread, repeatablyInside,
    };
  }
  return { window, actual, status: 'on-target', miss: 0, spread, repeatablyInside };
}
