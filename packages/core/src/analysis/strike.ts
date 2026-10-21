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

/** Shots a club needs before its own medians are a fair yardstick. */
const MIN_PER_CLUB = 3;

/**
 * Every shot restated relative to its own club.
 *
 * The classifier used to pool raw values across the whole session, so in a
 * bag session a driver's 1.47 smash was "flush" next to a wedge's 1.20 by
 * definition, every wedge carry sat below the session median, and every
 * wedge launch sat above it. "Thin means low for you, with this club" was in
 * the comment at the top of this file and not in the code.
 *
 * Each value becomes a ratio to that club's median. For a single club that
 * is a pure rescaling — the spread and its 2% floor both scale with it — so
 * a one-club session is classified exactly as before. Clubs the parser could
 * not name are left out: their bucket can hold several different clubs.
 */
function relativeToOwnClub(pool: Shot[]): Shot[] {
  const byClub = new Map<string, Shot[]>();
  for (const s of pool) {
    if (!s.club || s.club === 'unknown') continue;
    const list = byClub.get(s.club) ?? [];
    list.push(s);
    byClub.set(s.club, list);
  }
  const out: Shot[] = [];
  for (const group of byClub.values()) {
    if (group.length < MIN_PER_CLUB) continue;
    const mid = {
      smash: median(pluck(group, (s) => s.smashFactor)),
      launch: median(pluck(group, (s) => s.launchAngle)),
      spin: median(pluck(group, (s) => s.spinRate)),
      carry: median(pluck(group, (s) => s.carry)),
    };
    const ratio = (v: number | null, m: number) =>
      v === null || !Number.isFinite(m) || m === 0 ? null : v / m;
    for (const s of group) {
      out.push({
        ...s,
        smashFactor: ratio(s.smashFactor, mid.smash),
        launchAngle: ratio(s.launchAngle, mid.launch),
        spinRate: ratio(s.spinRate, mid.spin),
        carry: ratio(s.carry, mid.carry),
      });
    }
  }
  return out;
}

export function classifyStrikes(shots: Shot[]): StrikeBreakdown {
  const raw = usable(shots);
  const pool = relativeToOwnClub(raw);
  if (pool.length < 5) {
    return { total: 0, counts: [], qualityShare: 0, perShot: [] };
  }
  // The chart wants real yards, not ratios.
  const realCarry = new Map(raw.map((s) => [s.id, s.carry]));

  const smashes = pluck(pool, (s) => s.smashFactor);
  const launches = pluck(pool, (s) => s.launchAngle);
  const spins = pluck(pool, (s) => s.spinRate);
  const carries = pluck(pool, (s) => s.carry);

  const smashHigh = smashes.length >= 5 ? percentile(smashes, 0.72) : Number.POSITIVE_INFINITY;

  /*
   * Judge every signature in the player's own spread, not as a fixed
   * percentage of their median.
   *
   * A fixed cut — "carry below 85% of median" — is a different bar for a
   * tight player and a wild one, and against a wide distribution it puts a
   * third of the session below it. That produced a 33% "heavy" reading for a
   * player whose contact was fine, because a third of anyone's shots are
   * below their median by some margin. Measuring the deviation in the
   * player's own units asks the right question instead: is this shot unusual
   * *for you*?
   */
  const base = {
    smashHigh,
    launch: { mid: median(launches), spread: spreadOf(launches) },
    spin: { mid: median(spins), spread: spreadOf(spins) },
    carry: { mid: median(carries), spread: spreadOf(carries) },
    smash: { mid: median(smashes), spread: spreadOf(smashes) },
  };

  const perShot: StrikeBreakdown['perShot'] = [];
  const tally = new Map<StrikeClass, number>();

  for (const shot of [...pool].sort((a, b) => a.sequence - b.sequence)) {
    const klass = classifyOne(shot, base);
    tally.set(klass, (tally.get(klass) ?? 0) + 1);
    perShot.push({ sequence: shot.sequence, klass, carry: realCarry.get(shot.id) ?? null });
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

interface Band { mid: number; spread: number }

/** Robust spread with a floor, so a very tight group cannot divide by ~zero. */
function spreadOf(values: number[]): number {
  if (values.length < 4) return Number.POSITIVE_INFINITY;
  const q1 = percentile(values, 0.25);
  const q3 = percentile(values, 0.75);
  const iqr = q3 - q1;
  const mid = Math.abs(median(values)) || 1;
  // Never tighter than 2% of the typical value: below that the classifier is
  // reading measurement noise as technique.
  return Math.max(iqr / 1.35, mid * 0.02);
}

function below(value: number | null, band: Band, multiples: number): boolean {
  if (value === null || !Number.isFinite(band.mid) || !Number.isFinite(band.spread)) return false;
  return value < band.mid - multiples * band.spread;
}

function classifyOne(
  shot: Shot,
  base: {
    smashHigh: number;
    launch: Band; spin: Band; carry: Band; smash: Band;
  },
): StrikeClass {
  const { launchAngle, spinRate, carry, smashFactor, impactOffset, impactHeight } = shot;

  /*
   * Measured impact location beats inferring it from ball flight.
   *
   * Thin and heavy were being deduced from carry and smash, which is the
   * shadow of the thing rather than the thing. Where the unit reports where on
   * the face the ball was struck, that is a direct measurement and it wins.
   * The real export carries it on only fifteen shots of forty-five, so the
   * inference below stays as the fallback rather than being replaced.
   *
   * Millimetres from centre. Roughly a dime's width vertically is the band
   * inside which a strike stops costing ball speed.
   */
  if (impactHeight !== null && Math.abs(impactHeight) > 9) {
    return impactHeight < 0 ? 'thin' : 'heavy';
  }
  if (impactOffset !== null && Math.abs(impactOffset) > 12) return 'off-centre';
  if (impactHeight !== null && impactOffset !== null
    && Math.abs(impactHeight) <= 4 && Math.abs(impactOffset) <= 5) {
    return 'flush';
  }

  // Thin first: it has the most specific signature, low launch *and* low spin
  // together, which nothing else produces.
  if (below(launchAngle, base.launch, 1.5) && below(spinRate, base.spin, 1.2)) {
    return 'thin';
  }

  // Heavy: the ball came up short with ball speed to match, but it still
  // launched roughly normally — energy went into the turf, not over the ball.
  if (below(carry, base.carry, 1.5) && below(smashFactor, base.smash, 1.0)) {
    return 'heavy';
  }

  if (smashFactor !== null && smashFactor >= base.smashHigh) return 'flush';

  return 'solid';
}
