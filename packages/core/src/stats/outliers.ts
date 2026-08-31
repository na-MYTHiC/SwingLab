import type { Shot } from '../schema.js';
import { clubFamily } from '../clubs.js';
import { percentile, pluck } from './robust.js';

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
};

export function markImplausible(shots: Shot[]): void {
  for (const shot of shots) {
    for (const [field, range] of Object.entries(HARD_LIMITS) as [keyof Shot, [number, number]][]) {
      const v = shot[field];
      if (typeof v !== 'number') continue;
      if (v < range[0] || v > range[1]) {
        if (!shot.flags.includes('implausible')) shot.flags.push('implausible');
        break;
      }
    }
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
export function markMishits(shots: Shot[], opts: { madFloor?: number } = {}): void {
  const byClub = new Map<string, Shot[]>();
  for (const shot of shots) {
    if (shot.flags.includes('implausible')) continue;
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
  return shots.filter((s) => !s.flags.includes('implausible') && !s.flags.includes('mishit'));
}

/** Shots usable at all — implausible rows removed, mishits retained. */
export function usable(shots: Shot[]): Shot[] {
  return shots.filter((s) => !s.flags.includes('implausible'));
}
