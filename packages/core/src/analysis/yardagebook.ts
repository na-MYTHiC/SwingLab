import type { Club, Shot } from '../schema.js';
import { CLUB_ORDER, clubRank, compareClubs } from '../clubs.js';
import { median, percentile, pluck } from '../stats/robust.js';
import { usable } from '../stats/outliers.js';
import { toReference, type Conditions } from '../benchmarks/conditions.js';

/**
 * The yardage book: what to actually do with a club on the course.
 *
 * Everything else in this engine looks backwards — what happened, why, and
 * what to practise. None of it survives the walk from the range to the first
 * tee, because standing over a shot nobody needs a spin-loft diagnosis. They
 * need a number and an aim point.
 *
 * Two habits cost amateurs more shots than any swing fault, and both are
 * arithmetic rather than technique:
 *
 *   1. They club off the best one they ever hit. A launch monitor is
 *      complicit here — it shows a 7-iron carrying 168 once and that becomes
 *      "my 7-iron". The shot that matters is the one they hit four times in
 *      five, which is a long way short of it.
 *   2. They aim at the flag with a pattern that is centred eight yards right
 *      of it. The pattern is not the problem; pointing it at the pin is.
 *
 * Neither needs a better swing to fix, which is why this file exists. It is
 * the only part of the app that pays off on the very next round.
 *
 * Deliberately built from `usable()` rather than `representative()`. Every
 * other statistic here drops mishits, because a mishit does not describe how
 * a player swings. A yardage book is the exception: on the course there is no
 * discard pile, and a club whose bad ones come up fifteen yards short is a
 * club that plays shorter. Only rows the radar misread are removed.
 */

export type MissSide = 'left' | 'right' | 'straight';
export type Confidence = 'firm' | 'rough' | 'thin';

/**
 * Carry matched or beaten four shots in five.
 *
 * Not a median. Clubbing off the median leaves you short of the number half
 * the time, and short is the more expensive miss almost everywhere: front
 * bunkers, false fronts and water sit in front of greens far more often than
 * behind them. The fifth-shot tail is where the chunk lives, and no amount
 * of club selection saves that one, so it is left out of the promise.
 */
const PLAYS_PERCENTILE = 0.2;
/** The one you remember. Used only to show the gap against it. */
const FLUSHED_PERCENTILE = 0.9;
/** The miss to plan for — bad enough to matter, not the worst ever hit. */
const MISS_PERCENTILE = 0.8;

const FIRM_SHOTS = 12;
const ROUGH_SHOTS = 6;
/** Below this nothing is reported: a number from four swings misleads. */
const MIN_SHOTS = 4;

/**
 * Carry spread that means the club was played to several distances on
 * purpose, rather than swung at fully. A wedge hit to 60, 75 and 90 in a
 * Combine has no single playing number and must not be given one.
 */
const MULTI_TARGET_SPREAD = 0.28;

export interface ClubYardage {
  club: Club;
  shots: number;
  /** Carry to club off: matched or beaten four shots in five. */
  plays: number;
  /** Median carry — what the launch monitor screen showed you most often. */
  typical: number;
  /** Ninth-decile carry: the one you tell people about. */
  flushed: number;
  /**
   * Yards between the number you remember and the number to trust.
   *
   * The single most useful figure in the book. A player carrying a 12-yard
   * ego gap on a 7-iron is coming up short of pins all day and blaming the
   * strike.
   */
  egoGap: number;
  /** Where to aim, in yards left (-) or right (+) of the target. */
  aimYards: number;
  aimDegrees: number;
  aimSide: MissSide;
  /** The side the pattern spills to, and how far, at `MISS_PERCENTILE`. */
  missSide: MissSide;
  missYards: number;
  /** `plays` corrected to sea level at 70 °F, so it travels between venues. */
  playsAtSeaLevel: number | null;
  confidence: Confidence;
}

export interface YardageGap {
  longer: Club;
  shorter: Club;
  /** Difference between the two playing numbers, yards. */
  gap: number;
}

export interface YardageBook {
  clubs: ClubYardage[];
  /** Gaps between adjacent playing numbers, longest club first. */
  gaps: YardageGap[];
  /** Clubs seen but not given a number, and the reason why. */
  omitted: { club: Club; reason: string }[];
  conditionsNote: string | null;
}

/** Degrees of aim per yard of offset at a given carry. */
function degreesFor(offsetYards: number, carry: number): number {
  if (!Number.isFinite(carry) || carry <= 0) return 0;
  return (Math.atan2(offsetYards, carry) * 180) / Math.PI;
}

function sideOf(yards: number, deadband: number): MissSide {
  if (Math.abs(yards) < deadband) return 'straight';
  return yards > 0 ? 'right' : 'left';
}

function confidenceFor(n: number): Confidence {
  if (n >= FIRM_SHOTS) return 'firm';
  if (n >= ROUGH_SHOTS) return 'rough';
  return 'thin';
}

/**
 * Was this club swung at fully, or played to a number somebody else chose?
 *
 * The distinction the whole book rests on. A Combine asks for a 9-iron to 105
 * yards and a Test Center ladder asks for a wedge to 60, 75 and 90 — in both
 * the player is controlling distance on request, so the carry that comes back
 * describes the protocol, not the club. Publishing "your 9-iron plays 104"
 * off that would be the app inventing a yardage out of an instruction, and a
 * player would take one club too few for the rest of the season on it.
 *
 * The export says so outright: TrackMan records a target distance on exactly
 * the shots that were aimed at one, and leaves it empty on free swings. That
 * column is checked first. The carry-spread fallback catches free-range wedge
 * practice, where a player ladders distances with nothing written down.
 */
function playedToANumber(shots: Shot[], carries: number[]): string | null {
  const aimed = shots.filter(
    (s) => s.targetDistance !== null && Number.isFinite(s.targetDistance),
  ).length;
  if (aimed * 2 >= shots.length && aimed > 0) {
    return 'played to set distances rather than swung freely, so the carry describes the drill';
  }
  const mid = median(carries);
  if (Number.isFinite(mid) && mid > 0) {
    const spread = percentile(carries, 0.9) - percentile(carries, 0.1);
    if (spread / mid > MULTI_TARGET_SPREAD) {
      return 'hit to several distances, so it has no single full-swing number';
    }
  }
  return null;
}

export function buildYardageBook(
  shots: Shot[],
  conditions?: Conditions | null,
): YardageBook {
  const pool = usable(shots).filter((s) => s.carry !== null && Number.isFinite(s.carry));

  const byClub = new Map<Club, Shot[]>();
  for (const shot of pool) {
    if (!shot.club) continue;
    const bucket = byClub.get(shot.club);
    if (bucket) bucket.push(shot);
    else byClub.set(shot.club, [shot]);
  }

  const clubs: ClubYardage[] = [];
  const omitted: { club: Club; reason: string }[] = [];

  for (const [club, rows] of byClub) {
    const carries = pluck(rows, (s) => s.carry);
    if (carries.length < MIN_SHOTS) {
      omitted.push({
        club,
        reason: `${carries.length} shot${carries.length === 1 ? '' : 's'} — too few to promise a number`,
      });
      continue;
    }

    const notFullSwing = playedToANumber(rows, carries);
    if (notFullSwing) {
      omitted.push({ club, reason: notFullSwing });
      continue;
    }

    const plays = percentile(carries, PLAYS_PERCENTILE);
    const typical = median(carries);
    const flushed = percentile(carries, FLUSHED_PERCENTILE);

    const sides = pluck(rows, (s) => s.side);
    const aimYards = sides.length >= MIN_SHOTS ? -median(sides) : 0;

    // A yard of offset matters less the further the shot flies, so the
    // deadband is angular: under half a degree is inside anyone's ability to
    // aim, and telling a player to shift their alignment by that is noise.
    const deadband = Math.abs(typical * Math.tan((0.5 * Math.PI) / 180));

    // The miss is measured about the pattern's own centre, not about the
    // target. Once you aim the pattern correctly, what remains is the spread,
    // and that is the part you actually have to leave room for.
    const centre = sides.length >= MIN_SHOTS ? median(sides) : 0;
    const rightTail = sides.filter((v) => v - centre > 0).map((v) => v - centre);
    const leftTail = sides.filter((v) => v - centre < 0).map((v) => centre - v);
    const right = rightTail.length >= 2 ? percentile(rightTail, MISS_PERCENTILE) : 0;
    const left = leftTail.length >= 2 ? percentile(leftTail, MISS_PERCENTILE) : 0;
    const missYards = Math.max(right, left);
    const missSide: MissSide =
      sides.length < MIN_SHOTS || Math.abs(right - left) < 1
        ? 'straight'
        : right > left
          ? 'right'
          : 'left';

    clubs.push({
      club,
      shots: carries.length,
      plays: Math.round(plays),
      typical: Math.round(typical),
      flushed: Math.round(flushed),
      egoGap: Math.round(flushed - plays),
      aimYards: Math.round(aimYards * 10) / 10,
      aimDegrees: Math.round(degreesFor(aimYards, typical) * 10) / 10,
      aimSide: sideOf(aimYards, deadband),
      missSide,
      missYards: Math.round(missYards),
      playsAtSeaLevel: conditions ? Math.round(toReference(plays, conditions)) : null,
      confidence: confidenceFor(carries.length),
    });
  }

  clubs.sort((a, b) => compareClubs(a.club, b.club));

  const gaps: YardageGap[] = [];
  for (let i = 0; i < clubs.length - 1; i++) {
    const longer = clubs[i] as ClubYardage;
    const shorter = clubs[i + 1] as ClubYardage;
    // Only adjacent clubs. Two clubs with a 4-iron missing between them have
    // a gap the player did not create by swinging badly, and reporting it
    // here would repeat a mistake the gapping rule already avoids.
    if (Math.abs(clubRank(longer.club) - clubRank(shorter.club)) !== 1) continue;
    gaps.push({
      longer: longer.club,
      shorter: shorter.club,
      gap: longer.plays - shorter.plays,
    });
  }

  omitted.sort((a, b) => compareClubs(a.club, b.club));

  return {
    clubs,
    gaps,
    omitted,
    // Only worth saying when the air actually moved a number. At sea level
    // the correction is a no-op, and printing "expect 224 somewhere else"
    // next to a playing number of 224 is a line that teaches nothing.
    conditionsNote: clubs.some(
      (c) => c.playsAtSeaLevel !== null && Math.abs(c.playsAtSeaLevel - c.plays) >= 2,
    )
      ? 'These are the numbers this venue gave you. Somewhere else, expect the sea-level figures.'
      : null,
  };
}

/** One line of advice per club, in the words a player would use over the ball. */
export function yardageAdvice(entry: ClubYardage): string {
  const parts: string[] = [`Club it as ${entry.plays}, not ${entry.flushed}.`];
  if (entry.aimSide !== 'straight') {
    parts.push(
      `Aim ${Math.abs(entry.aimYards).toFixed(0)} yards ${entry.aimSide} of the flag (${Math.abs(entry.aimDegrees).toFixed(1)}°).`,
    );
  }
  if (entry.missSide !== 'straight' && entry.missYards >= 4) {
    parts.push(`Leave ${entry.missYards} yards of room ${entry.missSide}.`);
  }
  return parts.join(' ');
}

/** Guard: `CLUB_ORDER` is the ladder this file's gap logic walks. */
export const YARDAGE_CLUB_ORDER = CLUB_ORDER;
