import type { Shot } from '../schema.js';
import { clubFamily } from '../clubs.js';
import { median, percentile, pluck } from './robust.js';

/**
 * Mishit and implausible-value detection.
 *
 * Two separate jobs, deliberately not merged:
 *
 *  - `implausible` means the number cannot be real — a 400 mph ball speed, a
 *    negative carry. Almost always a unit or parsing bug rather than a swing.
 *    These are excluded from everything.
 *
 *  - `mishit` means the swing was real but unrepresentative — the toe-hook,
 *    the chunk. These are excluded from the medians that describe "your
 *    typical delivery", but they are counted for miss-frequency, because how
 *    often you mishit is one of the most coachable numbers there is.
 */

const HARD_LIMITS: Partial<Record<keyof Shot, [number, number]>> = {
  clubSpeed: [20, 160],
  ballSpeed: [20, 240],
  smashFactor: [0.5, 1.7],
  spinRate: [0, 16000],
  launchAngle: [-20, 70],
  attackAngle: [-25, 25],
  clubPath: [-30, 30],
  faceAngle: [-40, 40],
  dynamicLoft: [-5, 80],
  carry: [0, 450],
  total: [0, 500],
  apexHeight: [0, 300],
  landingAngle: [0, 90],
  hangTime: [0, 15],

  /*
   * The directional fields, which had no limits at all.
   *
   * That was the more dangerous half of the gap: `side` feeds the dispersion
   * ellipse, and the ellipse feeds the Direction score, the green rate and the
   * handicap. One corrupt side value would have moved all four at once, and
   * because a median is robust to a *plausible* outlier but not to a value of
   * minus two billion, nothing downstream would have absorbed it.
   */
  faceToPath: [-45, 45],
  launchDirection: [-45, 45],
  spinAxis: [-90, 90],
  spinLoft: [-10, 90],
  lowPointDistance: [-24, 24],
  impactOffset: [-80, 80],
  impactHeight: [-80, 80],
  side: [-250, 250],
  curve: [-250, 250],
  swingRadius: [0, 100],
  dynamicLie: [20, 100],
};

/**
 * A number no golf measurement can ever be.
 *
 * Launch monitors write sentinel values when a sensor fails, and they arrive
 * as ordinary numbers in an ordinary column. The public 10,000-shot TrackMan
 * dataset carries a spin rate of −21,474,836,480 — a scaled 32-bit integer
 * overflow — sitting in the same column as real spin rates.
 *
 * Range checks catch it wherever a field has a range, but they cannot catch it
 * in a field whose plausible range is wide, and they would not catch a new
 * sentinel in a field added later. Nothing in golf is measured in billions, so
 * this is the backstop that does not need to know what the field means.
 */
const NON_PHYSICAL = 1e9;

export function markImplausible(shots: Shot[]): void {
  for (const shot of shots) {
    let bad = false;

    // The backstop first: any field at all, not just the ones with ranges.
    for (const value of Object.values(shot)) {
      if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) >= NON_PHYSICAL)) {
        bad = true;
        break;
      }
    }

    if (!bad) {
      for (const [field, range] of Object.entries(HARD_LIMITS) as [keyof Shot, [number, number]][]) {
        const v = shot[field];
        if (typeof v !== 'number') continue;
        if (v < range[0] || v > range[1]) {
          bad = true;
          break;
        }
      }
    }

    if (bad && !shot.flags.includes('implausible')) shot.flags.push('implausible');
  }
}

/**
 * Flag mishits within each club group.
 *
 * A shot is a mishit if its smash factor is well below the group's median, or
 * its carry is far short of the group median. Both tests are relative to the
 * player's own club group — an absolute smash threshold would flag every
 * wedge shot for every golfer, since wedges legitimately smash around 1.2.
 *
 * `madFloor` stops a very consistent group from having a near-zero MAD and
 * flagging perfectly good shots as outliers.
 */
/**
 * Flag shots there is nothing to learn from.
 *
 * A topped 7-iron that goes 30 yards is not a data point about the player's
 * 7-iron. Its face angle, path and spin describe a collision, not a swing,
 * and leaving it in drags every median and inflates every spread — the
 * player already knows they topped it, and does not need it counted twice.
 *
 * Distinct from a mishit, which stays in the count because how often you
 * mis-strike is worth knowing. This is for shots where even that is not
 * informative: they are excluded everywhere and reported only as a number,
 * so nothing is hidden.
 *
 * The bar is deliberately extreme. Judged against the club's own median,
 * which is robust enough not to be dragged by the very shots being caught.
 */
export function markUnusable(shots: Shot[]): void {
  const byClub = new Map<string, Shot[]>();
  for (const shot of shots) {
    if (shot.flags.includes('implausible')) continue;
    const list = byClub.get(shot.club) ?? [];
    list.push(shot);
    byClub.set(shot.club, list);
  }

  for (const [club, group] of byClub) {
    if (clubFamily(club as Shot['club']) === 'putter') continue;
    if (group.length < 6) continue;

    const carries = pluck(group, (s) => s.carry);
    const speeds = pluck(group, (s) => s.ballSpeed);
    const carryMid = carries.length >= 6 ? median(carries) : Number.NaN;
    const speedMid = speeds.length >= 6 ? median(speeds) : Number.NaN;

    for (const shot of group) {
      // Under half the club's normal carry, or under two thirds of its
      // normal ball speed, is not a version of the shot — it is a different
      // event. Either alone is enough; a shank keeps its ball speed and
      // loses its distance, a top loses both.
      const carryDead =
        Number.isFinite(carryMid) && shot.carry !== null && shot.carry < carryMid * 0.5;
      const speedDead =
        Number.isFinite(speedMid) && shot.ballSpeed !== null && shot.ballSpeed < speedMid * 0.66;

      if ((carryDead || speedDead) && !shot.flags.includes('unusable')) {
        shot.flags.push('unusable');
      }
    }
  }
}

export function markMishits(shots: Shot[], opts: { madFloor?: number } = {}): void {
  const byClub = new Map<string, Shot[]>();
  for (const shot of shots) {
    if (shot.flags.includes('implausible') || shot.flags.includes('unusable')) continue;
    const list = byClub.get(shot.club) ?? [];
    list.push(shot);
    byClub.set(shot.club, list);
  }

  for (const [club, group] of byClub) {
    if (clubFamily(club as Shot['club']) === 'putter') continue;
    // Below this, group statistics are not stable enough to judge an outlier.
    if (group.length < 5) continue;

    flagLowTail(group, (s) => s.smashFactor, opts.madFloor ?? 0.02);
    flagLowTail(group, (s) => s.carry, opts.madFloor ?? 3);
  }
}

/**
 * Flag the low tail using Tukey's lower fence rather than a MAD multiple.
 *
 * Smash factor and carry are not symmetric. A golfer's good strikes cluster
 * near their ceiling while bad ones trail off below it, so the distribution
 * has a long low tail by nature. A symmetric spread measure reads that tail
 * as ordinary width and then flags a slice of it on every session — which
 * produced a 20% "mishit rate" for a player who was striking it perfectly
 * well, and a confident 2.6-shots-a-round claim off the back of it.
 *
 * The quartile fence is built for skewed data: it measures spread from the
 * middle half only, so a long tail widens the fence instead of being counted
 * as normal variation. `floor` keeps a very tight group from producing a
 * fence so narrow that ordinary shots fall outside it.
 */
function flagLowTail(
  group: Shot[],
  get: (s: Shot) => number | null,
  floor: number,
): void {
  const values = pluck(group, get);
  if (values.length < 5) return;

  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  const iqr = Math.max(q3 - q1, floor);
  const fence = q1 - 1.5 * iqr;

  for (const shot of group) {
    const v = get(shot);
    if (v === null || !Number.isFinite(v)) continue;
    if (v < fence && !shot.flags.includes('mishit')) shot.flags.push('mishit');
  }
}

/** Shots usable for "what does this player typically do" statistics. */
export function representative(shots: Shot[]): Shot[] {
  return shots.filter(
    (s) =>
      !s.flags.includes('implausible') &&
      !s.flags.includes('unusable') &&
      !s.flags.includes('mishit'),
  );
}

/**
 * Shots usable at all — mishits retained because their frequency matters,
 * tops and shanks removed because nothing about them is informative.
 */
export function usable(shots: Shot[]): Shot[] {
  return shots.filter(
    (s) => !s.flags.includes('implausible') && !s.flags.includes('unusable'),
  );
}

/** Shots thrown out entirely, for reporting the count honestly. */
export function discarded(shots: Shot[]): Shot[] {
  return shots.filter(
    (s) => s.flags.includes('implausible') || s.flags.includes('unusable'),
  );
}

/**
 * Shots the *player* wasted, as against shots the *radar* misread.
 *
 * These are two completely different things and lumping them together was
 * charging golfers for their launch monitor's sensor errors: a Combine with
 * six unreadable rows scored zero for reliability and was told it had topped
 * ten percent of the session. A top is a stroke; a bad radar return is not.
 */
export function badStrikes(shots: Shot[]): Shot[] {
  return shots.filter((s) => s.flags.includes('unusable'));
}

/** Rows the launch monitor reported values for that cannot be true. */
export function unreadable(shots: Shot[]): Shot[] {
  return shots.filter(
    (s) => s.flags.includes('implausible') && !s.flags.includes('unusable'),
  );
}
