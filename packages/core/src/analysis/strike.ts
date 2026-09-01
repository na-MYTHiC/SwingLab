import type { Shot } from '../schema.js';
import { usable } from '../stats/outliers.js';
import { median, percentile, pluck } from '../stats/robust.js';

/**
 * Strike quality, classified against the player's own baseline.
 *
 * Deliberately relative rather than absolute. There is no launch angle that
 * is "thin" for every golfer with every club — thin means low *for you, with
 * this club*, and a fixed threshold would call a strong player's stinger a
 * mishit and miss a weaker player's genuine top.
 *
 * The signatures used are the ones that separate cleanly in launch monitor
 * data:
 *
 *   - A **thin** strike catches the ball above centre: it launches lower and
 *     spins less than usual, both at once. Either alone is just a variation.
 *   - A **heavy** strike loses energy to the ground before the ball: ball
 *     speed and carry drop while launch stays roughly normal.
 *   - A **flush** strike returns the most ball speed per unit of club speed
 *     the player produces.
 */

export type StrikeClass = 'flush' | 'solid' | 'thin' | 'heavy' | 'off-centre';

export interface StrikeCount {
  klass: StrikeClass;
  label: string;
  description: string;
  count: number;
  share: number;
}

export interface StrikeBreakdown {
  total: number;
  counts: StrikeCount[];
  /** Share of shots that were struck well (flush or solid). */
  qualityShare: number;
  /** Per-shot classification, in session order, for charting. */
  perShot: { sequence: number; klass: StrikeClass; carry: number | null }[];
}

const META: Record<StrikeClass, { label: string; description: string }> = {
  flush: { label: 'Flushed', description: 'Best ball speed you produced for the effort.' },
  solid: { label: 'Solid', description: 'Normal contact for you — nothing wrong with it.' },
  thin: { label: 'Thin', description: 'Caught above centre: launched low and spun low.' },
  heavy: { label: 'Heavy', description: 'Ground first: lost ball speed and came up short.' },
  'off-centre': { label: 'Off centre', description: 'Missed the middle of the face.' },
};

export function classifyStrikes(shots: Shot[]): StrikeBreakdown {
  const pool = usable(shots);
  if (pool.length < 5) {
    return { total: 0, counts: [], qualityShare: 0, perShot: [] };
  }

  const smashes = pluck(pool, (s) => s.smashFactor);
  const launches = pluck(pool, (s) => s.launchAngle);
  const spins = pluck(pool, (s) => s.spinRate);
  const carries = pluck(pool, (s) => s.carry);

  const smashHigh = smashes.length >= 5 ? percentile(smashes, 0.72) : Number.POSITIVE_INFINITY;
  const launchMid = median(launches);
  const spinMid = median(spins);
  const carryMid = median(carries);
  const smashMid = median(smashes);

  const perShot: StrikeBreakdown['perShot'] = [];
  const tally = new Map<StrikeClass, number>();

  for (const shot of pool) {
    const klass = classifyOne(shot, {
      smashHigh, smashMid, launchMid, spinMid, carryMid,
    });
    tally.set(klass, (tally.get(klass) ?? 0) + 1);
    perShot.push({ sequence: shot.sequence, klass, carry: shot.carry });
  }

  const counts: StrikeCount[] = [...tally.entries()]
    .map(([klass, count]) => ({
      klass,
      label: META[klass].label,
      description: META[klass].description,
      count,
      share: count / pool.length,
    }))
    .sort((a, b) => b.count - a.count);

  const good = (tally.get('flush') ?? 0) + (tally.get('solid') ?? 0);

  return { total: pool.length, counts, qualityShare: good / pool.length, perShot };
}

function classifyOne(
  shot: Shot,
  base: {
    smashHigh: number; smashMid: number;
    launchMid: number; spinMid: number; carryMid: number;
  },
): StrikeClass {
  const { launchAngle, spinRate, carry, smashFactor, impactOffset } = shot;

  // Thin first: it has the most specific signature, low launch *and* low spin
  // together, which nothing else produces.
  if (
    launchAngle !== null && spinRate !== null &&
    Number.isFinite(base.launchMid) && Number.isFinite(base.spinMid) &&
    launchAngle < base.launchMid * 0.72 &&
    spinRate < base.spinMid * 0.78
  ) {
    return 'thin';
  }

  // Heavy: the ball came up short with ball speed to match, but it still
  // launched roughly normally — energy went into the turf, not over the ball.
  if (
    carry !== null && smashFactor !== null &&
    Number.isFinite(base.carryMid) && Number.isFinite(base.smashMid) &&
    carry < base.carryMid * 0.85 &&
    smashFactor < base.smashMid * 0.94
  ) {
    return 'heavy';
  }

  if (impactOffset !== null && Math.abs(impactOffset) > 12) return 'off-centre';

  if (smashFactor !== null && smashFactor >= base.smashHigh) return 'flush';

  return 'solid';
}
