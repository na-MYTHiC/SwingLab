import type { Shot } from '../schema.js';
import { representative } from '../stats/outliers.js';
import { median, percentile, pluck } from '../stats/robust.js';

/**
 * The gap between your best golf and your normal golf.
 *
 * Golfers quote their best number — "I hit my 7-iron 175" — and then play to
 * it, which is why so many approach shots finish short. The useful figure is
 * the one you can rely on, and the useful *insight* is the size of the gap
 * between the two: it is a direct measure of what consistency is costing,
 * and unlike most coaching numbers it needs no baseline to interpret.
 *
 * Deliberately framed as headroom rather than as a target. The player already
 * owns the good swing; the work is making it typical.
 */

export interface Potential {
  /** What you should actually play to. */
  reliableCarry: number;
  /** Your typical carry. */
  medianCarry: number;
  /** The average of your best quarter of strikes. */
  bestCarry: number;
  /** Yards between typical and best. */
  headroom: number;
  /** Share of the gap that comes from strike rather than speed. */
  fromStrike: number;
  headline: string;
  detail: string;
}

export function potential(shots: Shot[]): Potential | null {
  const pool = representative(shots).filter((s) => s.carry !== null);
  if (pool.length < 10) return null;

  const carries = pluck(pool, (s) => s.carry);
  const medianCarry = median(carries);
  const bestCarry = percentile(carries, 0.875);
  // The number to club off: you will reach it most of the time, and being
  // long is usually a smaller error than being short.
  const reliableCarry = percentile(carries, 0.35);
  const headroom = bestCarry - medianCarry;

  /*
   * How much of the gap is strike rather than speed?
   *
   * Club speed and smash factor both feed ball speed, but only one of them is
   * available today. If the long shots came from swinging harder, the gap is
   * speed; if they came from finding the middle, it is strike — and strike is
   * the one that responds to practice this week.
   */
  const sorted = [...pool].sort((a, b) => (b.carry as number) - (a.carry as number));
  const topQuarter = sorted.slice(0, Math.max(3, Math.floor(sorted.length / 4)));
  const rest = sorted.slice(topQuarter.length);

  const smashGap = median(pluck(topQuarter, (s) => s.smashFactor)) -
    median(pluck(rest, (s) => s.smashFactor));
  const speedGap = median(pluck(topQuarter, (s) => s.clubSpeed)) -
    median(pluck(rest, (s) => s.clubSpeed));

  // Convert both to the ball speed each contributes, then take strike's share.
  const speedMid = median(pluck(pool, (s) => s.clubSpeed));
  const smashMid = median(pluck(pool, (s) => s.smashFactor));
  const fromSmash = Number.isFinite(smashGap) && Number.isFinite(speedMid)
    ? Math.abs(smashGap * speedMid) : 0;
  const fromSpeed = Number.isFinite(speedGap) && Number.isFinite(smashMid)
    ? Math.abs(speedGap * smashMid) : 0;
  const fromStrike = fromSmash + fromSpeed > 0 ? fromSmash / (fromSmash + fromSpeed) : 0;

  const strikeLed = fromStrike >= 0.5;

  return {
    reliableCarry,
    medianCarry,
    bestCarry,
    headroom,
    fromStrike,
    headline: `${Math.round(headroom)} yards of headroom in the swing you already have`,
    detail:
      `Your best strikes carry about ${Math.round(bestCarry)} yards and your typical one goes ` +
      `${Math.round(medianCarry)}. You are not missing distance — you are missing it ` +
      `consistently. ` +
      (strikeLed
        ? 'Most of that gap came from finding the middle of the face rather than from swinging harder, which is the half that responds to practice quickly.'
        : 'Most of that gap came from swinging harder on the good ones, which is worth knowing: chasing speed will widen the spread before it lengthens the average.') +
      ` Club off ${Math.round(reliableCarry)} yards, not ${Math.round(bestCarry)}.`,
  };
}
