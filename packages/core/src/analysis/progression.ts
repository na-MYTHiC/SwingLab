import type { Shot } from '../schema.js';
import { representative } from '../stats/outliers.js';
import { median, pluck } from '../stats/robust.js';

/**
 * How the session went, start to finish.
 *
 * A session average flattens the thing a player most wants to know: did it
 * get better, or did it fall apart? Those have opposite lessons. Improving
 * through a session usually means the warm-up was too short; falling away
 * usually means the session was too long, or that a change was being forced
 * past the point of usefulness.
 *
 * Compared in thirds rather than halves, so a slow start and a tired finish
 * are separable rather than averaging each other out.
 */

export interface Progression {
  /** Median carry in each third of the session. */
  thirds: { label: string; carry: number; strikeQuality: number; n: number }[];
  /** Change from the first third to the last, in yards of carry. */
  carryChange: number;
  verdict: 'warmed-up' | 'faded' | 'steady' | 'unknown';
  headline: string;
  detail: string;
}

export function sessionProgression(shots: Shot[]): Progression {
  const pool = representative(shots)
    .filter((s) => s.carry !== null)
    .sort((a, b) => a.sequence - b.sequence);

  const empty: Progression = {
    thirds: [], carryChange: 0, verdict: 'unknown',
    headline: 'Not enough shots to read the shape of the session.',
    detail: 'Around fifteen shots with a club is enough to see whether you warmed into it or faded.',
  };
  if (pool.length < 15) return empty;

  const size = Math.floor(pool.length / 3);
  const slices = [pool.slice(0, size), pool.slice(size, size * 2), pool.slice(size * 2)];
  const labels = ['First third', 'Middle', 'Last third'];

  const thirds = slices.map((slice, i) => {
    const carries = pluck(slice, (s) => s.carry);
    const smashes = pluck(slice, (s) => s.smashFactor);
    return {
      label: labels[i] as string,
      carry: median(carries),
      strikeQuality: median(smashes),
      n: slice.length,
    };
  });

  const first = thirds[0]?.carry ?? Number.NaN;
  const last = thirds[2]?.carry ?? Number.NaN;
  if (!Number.isFinite(first) || !Number.isFinite(last)) return empty;

  const carryChange = last - first;

  // Roughly half a club. Below that it is shot-to-shot noise, not a trend.
  const MEANINGFUL = 5;

  if (carryChange >= MEANINGFUL) {
    return {
      thirds, carryChange, verdict: 'warmed-up',
      headline: `You got ${Math.round(carryChange)} yards longer as the session went on`,
      detail:
        'Your best golf was at the end, which usually means the warm-up was too short rather than that the session was good. On the course you only get the first tee shot once — a longer warm-up moves this ground into the round instead of the range.',
    };
  }

  if (carryChange <= -MEANINGFUL) {
    return {
      thirds, carryChange, verdict: 'faded',
      headline: `You lost ${Math.round(Math.abs(carryChange))} yards over the session`,
      detail:
        'Contact fell away as you went. That is usually fatigue or a change being drilled past the point where it was still being absorbed. Shorter sessions, or a break in the middle, will get you more out of the same hour.',
    };
  }

  return {
    thirds, carryChange, verdict: 'steady',
    headline: 'You held your level right through the session',
    detail:
      'Carry stayed where it started. Consistency across a session is worth having — it means the numbers here describe your golf rather than your warm-up.',
  };
}
