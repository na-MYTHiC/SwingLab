import type { Club, Shot } from '../schema.js';
import { compareClubs } from '../clubs.js';
import { median, percentile } from '../stats/robust.js';
import { markImplausible, markUnusable, usable } from '../stats/outliers.js';
import { plural } from '../units.js';

/**
 * The scoring zone: how close you get, distance by distance.
 *
 * A Combine or a Test Center ladder is the most informative session a
 * simulator can run — every shot has a number it was meant to hit — and the
 * rest of the app deliberately throws that information away. The yardage book
 * refuses to call a 9-iron hit to 105 yards "a 9-iron" because it was not a
 * full swing; the pattern rules refuse to call a wedge laddered from 60 to 90
 * "inconsistent". Both are right. This is where those shots get read for what
 * they are: a player trying to hit a number, and how far they missed it by.
 *
 * Three things per club and distance, because they need three different
 * fixes:
 *
 *   bias      — the median miss, signed. Eight short every time is not a
 *               swing problem, it is the wrong number written down.
 *   spread    — how far the misses scatter around that median. This is the
 *               part practice actually moves.
 *   proximity — how far from the target the ball finished, both axes, in
 *               feet, because that is the unit a wedge is judged in.
 *
 * Built from every readable strike, mishits included — in the scoring zone a
 * chunked wedge is not an outlier to be filtered, it is the shot that costs
 * the stroke. Only rows the radar misread and outright duffs are left out.
 *
 * No tour comparison per cell. The skill scale in `benchmarks/skill.ts` is
 * anchored on 150-175 yard approaches and does not transfer to a 60-yard
 * wedge, and short-game proximity tables could not be verified when this was
 * written. So the reading is self-referential: your best distance against
 * your worst. That is also the comparison that tells you where to practise.
 */

export interface ScoringCell {
  club: Club;
  /** Target distance, yards, rounded to the nearest five. */
  target: number;
  shots: number;
  /** Median carry minus target, yards. Negative is short. */
  bias: number;
  /** Half the middle-50% range of carry error, yards — the typical miss. */
  spread: number;
  /** Median finish distance from the target, feet, where the unit reported it. */
  proximityFt: number | null;
  /** Share of shots carrying within 5% of the target. */
  withinFive: number;
}

export interface ScoringZone {
  cells: ScoringCell[];
  sessions: number;
  shots: number;
  /** Median signed error across every target shot. */
  overallBias: number;
  best: ScoringCell | null;
  worst: ScoringCell | null;
  headline: string;
  detail: string;
}

/** A cell needs this many attempts before its median means anything. */
const MIN_PER_CELL = 3;
/** Bias below this is noise; above it is a number worth rewriting. */
const BIAS_WORTH_SAYING = 3;

const roundTo5 = (v: number) => Math.round(v / 5) * 5;

/** Proximity if the unit gave one, else derived from carry error and side. */
function finishYards(s: Shot): number | null {
  if (s.proximity !== null && Number.isFinite(s.proximity)) return s.proximity;
  if (s.carry === null || s.targetDistance === null) return null;
  const depth = s.carry - s.targetDistance;
  const side = s.side ?? 0;
  return Math.sqrt(depth * depth + side * side);
}

export function scoringZone(sessions: { shots: Shot[] }[]): ScoringZone {
  /*
   * Outliers are marked here, on copies, rather than trusted from the caller:
   * sessions read straight out of storage have never been through the outlier
   * pass, and their flags would otherwise all be empty — letting tops and
   * sensor misreads into every median below.
   */
  const marked = sessions.map((s) => {
    const shots = s.shots.map((x) => ({ ...x, flags: [] as Shot['flags'] }));
    markImplausible(shots);
    markUnusable(shots);
    return shots;
  });
  const pool = marked.flatMap((shots) => usable(shots)).filter(
    (s) => s.targetDistance !== null && Number.isFinite(s.targetDistance)
      && s.carry !== null && Number.isFinite(s.carry)
      && s.club && s.club !== 'unknown'
      // A miss by more than half the distance was not an attempt at that
      // number: a fairway target in a Combine, or a row that was mislabelled.
      && Math.abs((s.carry as number) - (s.targetDistance as number)) <= 0.5 * (s.targetDistance as number),
  );
  const sessionsWithTargets = sessions.filter((s) =>
    s.shots.some((x) => x.targetDistance !== null)).length;

  const groups = new Map<string, Shot[]>();
  for (const s of pool) {
    const key = `${s.club}@${roundTo5(s.targetDistance as number)}`;
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }

  const cells: ScoringCell[] = [];
  for (const [key, shots] of groups) {
    if (shots.length < MIN_PER_CELL) continue;
    const [club, target] = key.split('@') as [Club, string];
    const t = Number(target);
    const errors = shots.map((s) => (s.carry as number) - (s.targetDistance as number));
    const finishes = shots.map(finishYards).filter((v): v is number => v !== null);
    cells.push({
      club,
      target: t,
      shots: shots.length,
      bias: median(errors),
      spread: (percentile(errors, 0.75) - percentile(errors, 0.25)) / 2,
      proximityFt: finishes.length >= MIN_PER_CELL ? median(finishes) * 3 : null,
      withinFive: shots.filter((s) =>
        Math.abs((s.carry as number) - (s.targetDistance as number))
          <= 0.05 * (s.targetDistance as number)).length / shots.length,
    });
  }
  cells.sort((a, b) => a.target - b.target || compareClubs(a.club, b.club));

  const empty: ScoringZone = {
    cells: [], sessions: sessionsWithTargets, shots: pool.length, overallBias: Number.NaN,
    best: null, worst: null,
    headline: 'No target practice yet',
    detail:
      'Run a Combine, a Test Center ladder or Target Practice and every shot gets read against ' +
      'the number it was meant to hit — the closest thing a simulator has to a round of golf.',
  };
  if (cells.length === 0) return empty;

  const overallBias = median(pool.map((s) => (s.carry as number) - (s.targetDistance as number)));

  /*
   * Best and worst by proximity relative to distance. Raw feet would always
   * name the longest club the worst: twenty feet from 160 is good golf and
   * twenty feet from 60 is not.
   */
  const score = (c: ScoringCell) =>
    c.proximityFt !== null ? c.proximityFt / c.target : Math.hypot(c.bias, c.spread) * 3 / c.target;
  const ranked = [...cells].sort((a, b) => score(a) - score(b));
  const best = ranked.length >= 2 ? (ranked[0] as ScoringCell) : null;
  const worst = ranked.length >= 2 ? (ranked.at(-1) as ScoringCell) : null;

  const shortOrLong = overallBias < 0 ? 'short' : 'long';
  const biasLine = Math.abs(overallBias) >= BIAS_WORTH_SAYING
    ? `Across ${plural(pool.length, 'shot')} you finish a median ` +
      `${plural(Math.round(Math.abs(overallBias)), 'yard')} ${shortOrLong} of the number. That is ` +
      `calibration, not technique — ${overallBias < 0 ? 'take more club' : 'take less club'} ` +
      'than you think, or rewrite the numbers you are playing to.'
    : `Across ${plural(pool.length, 'shot')} your misses are balanced short and long, so the ` +
      'numbers you play to are right and what is left is spread.';

  return {
    cells,
    sessions: sessionsWithTargets,
    shots: pool.length,
    overallBias,
    best,
    worst,
    headline: worst
      ? `Your weakest number is ${worst.target} yards with the ${worst.club}`
      : `${cells[0]!.target} yards with the ${cells[0]!.club}`,
    detail: biasLine,
  };
}
