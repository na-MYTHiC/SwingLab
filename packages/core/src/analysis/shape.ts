import type { Shot } from '../schema.js';
import { representative } from '../stats/outliers.js';

/**
 * Shot shape breakdown.
 *
 * Two independent questions decide a golf shot's shape, and collapsing them
 * into one label is how people end up "fixing a slice" that is actually a
 * pull. Where it *starts* is face angle. Which way it *bends* is face
 * relative to path. A ball that starts left and bends further left is a
 * different fault from one that starts right and bends back — so both axes
 * are reported, and the combined label is derived rather than guessed.
 */

export type StartLine = 'left' | 'straight' | 'right';
export type Curvature = 'draw' | 'straight' | 'fade';

export interface ShapeCount {
  start: StartLine;
  curve: Curvature;
  /** The name a golfer would use for this combination. */
  label: string;
  count: number;
  share: number;
}

export interface ShapeBreakdown {
  total: number;
  counts: ShapeCount[];
  /** The single most common shape, when one clearly dominates. */
  dominant: ShapeCount | null;
  /** How many distinct shapes make up most of the session. */
  spreadOfShapes: number;
}

/** Degrees of launch direction before a shot counts as started off line. */
const START_TOLERANCE = 2.0;
/** Yards of curve before a shot counts as bending. */
const CURVE_TOLERANCE = 5;

function label(start: StartLine, curve: Curvature): string {
  if (start === 'straight' && curve === 'straight') return 'Straight';
  if (start === 'straight') return curve === 'draw' ? 'Draw' : 'Fade';
  if (curve === 'straight') return start === 'left' ? 'Pull' : 'Push';
  // Starting and bending the same way is the big miss in that direction.
  if (start === 'left' && curve === 'draw') return 'Pull hook';
  if (start === 'right' && curve === 'fade') return 'Push slice';
  if (start === 'left' && curve === 'fade') return 'Pull fade';
  return 'Push draw';
}

export function shapeBreakdown(shots: Shot[]): ShapeBreakdown {
  const usable = representative(shots).filter(
    (s) => s.launchDirection !== null && s.curve !== null,
  );

  const counts = new Map<string, ShapeCount>();
  for (const shot of usable) {
    const dir = shot.launchDirection as number;
    const curveYds = shot.curve as number;

    const start: StartLine =
      dir < -START_TOLERANCE ? 'left' : dir > START_TOLERANCE ? 'right' : 'straight';
    const curve: Curvature =
      curveYds < -CURVE_TOLERANCE ? 'draw' : curveYds > CURVE_TOLERANCE ? 'fade' : 'straight';

    const key = `${start}:${curve}`;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { start, curve, label: label(start, curve), count: 1, share: 0 });
  }

  const list = [...counts.values()].sort((a, b) => b.count - a.count);
  for (const entry of list) entry.share = usable.length ? entry.count / usable.length : 0;

  const dominant = list[0] && list[0].share >= 0.4 ? list[0] : null;
  // How many shapes it takes to account for 80% of the session — a rough
  // measure of whether the player has one pattern or several. Reported as
  // "most of your session" rather than as a total, because the long tail of
  // one-off shapes is not the point and quoting it alongside a longer list
  // reads as a contradiction.
  let cumulative = 0;
  let spreadOfShapes = 0;
  for (const entry of list) {
    cumulative += entry.share;
    spreadOfShapes++;
    if (cumulative >= 0.8) break;
  }

  return { total: usable.length, counts: list, dominant, spreadOfShapes };
}
