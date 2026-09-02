import type { Club } from '../schema.js';
import type { ClubProfile } from '../stats/dispersion.js';
import { greenHoldRate, handicapFromPattern } from '../benchmarks/skill.js';
import { plural } from '../units.js';

/**
 * How much of this player's pattern is aim, and how much is swing?
 *
 * The most useful question the data can answer, and the one no launch monitor
 * asks. A shot pattern costs strokes in two quite different currencies. Part
 * of the cost is spread — the scatter around wherever the middle of the
 * pattern happens to be — and buying that back takes months. The rest is
 * offset: the whole pattern sitting to one side of the target. That part
 * costs exactly as many strokes and can be removed on the walk to the first
 * tee, by pointing somewhere else.
 *
 * Amateurs almost universally aim at the flag with a pattern that is not
 * centred on it, and then practise to fix a miss that was never a swing
 * fault. Separating the two tells a player which of their problems is worth
 * an hour on the range and which is worth thirty seconds behind the ball.
 *
 * The arithmetic is the same model used for the handicap estimate, run twice:
 * once on the pattern as it is played, once on the same pattern centred. The
 * difference is what aiming is worth.
 */

export interface ClubAim {
  club: Club;
  shots: number;
  /** Yards the pattern centre sits from the target line; + is right. */
  offsetYards: number;
  /** Which way to move the aim, and how far. */
  moveYards: number;
  moveSide: 'left' | 'right';
  /** Handicap the pattern supports played as it is now. */
  asPlayed: number;
  /** Handicap the same spread would support centred on the target. */
  aimed: number;
  /** Green-holding now, and centred. */
  greenNow: number;
  greenAimed: number;
}

export interface AimValue {
  clubs: ClubAim[];
  /** Shot-weighted strokes available from aim alone, across the bag. */
  strokesFromAim: number;
  /** The club with the most to gain. */
  worst: ClubAim | null;
  /**
   * How much of the total pattern cost is aim rather than spread, 0-1.
   *
   * The number that decides where the next hour goes.
   */
  shareOfCost: number;
  headline: string;
  detail: string;
  /** True when there is enough offset to be worth telling the player about. */
  worthSaying: boolean;
}

/**
 * Below this the offset is inside what anyone can aim to anyway, and telling
 * a player to shift their alignment by less is noise dressed as insight.
 */
const MIN_OFFSET_YARDS = 4;
/** Fewer shots than this and the pattern centre is not established. */
const MIN_SHOTS = 8;

function forClub(profile: ClubProfile): ClubAim | null {
  const carry = profile.carry.median;
  const offset = profile.side.median;
  if (!Number.isFinite(carry) || carry <= 0) return null;
  if (!Number.isFinite(offset)) return null;
  if (profile.representativeCount < MIN_SHOTS) return null;

  const base = { sigmaSide: profile.side.mad, sigmaCarry: profile.carry.mad, carry };
  const played = { ...base, biasSide: offset };
  const centred = { ...base, biasSide: 0 };

  const asPlayed = handicapFromPattern(played);
  const aimed = handicapFromPattern(centred);
  if (!Number.isFinite(asPlayed) || !Number.isFinite(aimed)) return null;

  return {
    club: profile.club,
    shots: profile.representativeCount,
    offsetYards: offset,
    moveYards: Math.abs(offset),
    moveSide: offset > 0 ? 'left' : 'right',
    asPlayed,
    aimed,
    greenNow: greenHoldRate(played),
    greenAimed: greenHoldRate(centred),
  };
}

export function aimValue(profiles: ClubProfile[]): AimValue {
  const clubs = profiles
    .map(forClub)
    .filter((c): c is ClubAim => c !== null)
    .sort((a, b) => (b.asPlayed - b.aimed) - (a.asPlayed - a.aimed));

  const empty: AimValue = {
    clubs: [], strokesFromAim: 0, worst: null, shareOfCost: 0,
    headline: 'Not enough shots to say where your pattern is centred',
    detail: 'Eight or so with one club is enough to tell an aim problem from a spread problem.',
    worthSaying: false,
  };
  if (clubs.length === 0) return empty;

  const weight = clubs.reduce((sum, c) => sum + c.shots, 0);
  const strokesFromAim =
    clubs.reduce((sum, c) => sum + (c.asPlayed - c.aimed) * c.shots, 0) / weight;

  /*
   * Cost is measured against scratch rather than against zero, because a
   * pattern that already supports a plus handicap has no cost to apportion
   * and dividing by it would produce a nonsense share.
   */
  const totalCost = clubs.reduce((sum, c) => sum + Math.max(0, c.asPlayed) * c.shots, 0) / weight;
  const shareOfCost = totalCost > 0 ? Math.min(1, strokesFromAim / totalCost) : 0;

  const worst = clubs[0] as ClubAim;
  const worthSaying = worst.moveYards >= MIN_OFFSET_YARDS && strokesFromAim >= 0.5;

  if (!worthSaying) {
    return {
      clubs, strokesFromAim, worst, shareOfCost,
      headline: 'Your pattern is already centred on the target',
      detail:
        'What is left is spread rather than aim, which is the harder half but the half that ' +
        'practice actually moves. Nothing to gain here by pointing somewhere else.',
      worthSaying: false,
    };
  }

  const pct = Math.round(shareOfCost * 100);
  return {
    clubs,
    strokesFromAim,
    worst,
    shareOfCost,
    headline: `About ${strokesFromAim.toFixed(1)} strokes of this is aim, not swing`,
    detail:
      `Your ${worst.club} pattern sits ${plural(Math.round(worst.moveYards), 'yard')} ` +
      `${worst.offsetYards > 0 ? 'right' : 'left'} of where you were aiming. Move your aim ` +
      `${worst.moveSide} by that much and the same swing, with the same spread, holds ` +
      `${Math.round(worst.greenAimed * 100)}% of greens instead of ` +
      `${Math.round(worst.greenNow * 100)}% — worth roughly ` +
      `${(worst.asPlayed - worst.aimed).toFixed(1)} strokes on its own. That is ${pct}% of what ` +
      `your pattern is costing you, available without changing anything about how you swing. ` +
      `Confirm it holds over a second session before you rebuild your alignment around it: one ` +
      `session can be one day's aim rather than a habit.`,
    worthSaying: true,
  };
}
