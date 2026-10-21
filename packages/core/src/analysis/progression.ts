import type { Club, Shot } from '../schema.js';
import { representative } from '../stats/outliers.js';
import { median, pluck } from '../stats/robust.js';
import { plural } from '../units.js';

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
 *
 * EVERY SHOT IS JUDGED AGAINST ITS OWN CLUB. This used to pool raw carry
 * across the whole session, so a player who hit drivers first and wedges last
 * — which is how most people work through a bag — was told "You lost 109
 * yards over the session. That is usually fatigue." It was club order. Each
 * shot is now expressed as a share of that club's own median carry, which
 * means the same thing for a driver and a sand wedge, and the thirds compare
 * those shares. A single-club session still reads in yards, because there the
 * yards are honest.
 */

export interface ProgressionThird {
  label: string;
  /** Median carry in this third, yards. Only meaningful with a single club. */
  carry: number;
  /** Median carry as a percentage of each shot's own club's normal carry. */
  share: number;
  strikeQuality: number;
  n: number;
}

export interface Progression {
  thirds: ProgressionThird[];
  /** True when more than one club was hit, so yards cannot be compared. */
  mixedClubs: boolean;
  /** First third to last, in yards. Single-club sessions only; else NaN. */
  carryChange: number;
  /** First third to last, in percentage points of normal carry. */
  shareChange: number;
  verdict: 'warmed-up' | 'faded' | 'steady' | 'unknown';
  headline: string;
  detail: string;
}

/** A club needs this many shots before its median is a fair "normal". */
const MIN_PER_CLUB = 3;
/** About five yards on a 160-yard club. Below this it is noise. */
const MEANINGFUL_SHARE = 3;

export function sessionProgression(shots: Shot[]): Progression {
  const empty: Progression = {
    thirds: [], mixedClubs: false, carryChange: Number.NaN, shareChange: Number.NaN,
    verdict: 'unknown',
    headline: 'Not enough shots to read the shape of the session.',
    detail: 'Around fifteen shots is enough to see whether you warmed into it or faded.',
  };

  const flying = representative(shots).filter(
    (s) => s.carry !== null && Number.isFinite(s.carry) && s.club && s.club !== 'unknown',
  );

  // Each club's own normal, from the shots that flew.
  const byClub = new Map<Club, number[]>();
  for (const s of flying) {
    const list = byClub.get(s.club) ?? [];
    list.push(s.carry as number);
    byClub.set(s.club, list);
  }
  const normal = new Map<Club, number>();
  for (const [club, carries] of byClub) {
    if (carries.length >= MIN_PER_CLUB) normal.set(club, median(carries));
  }

  const pool = flying
    .filter((s) => (normal.get(s.club) ?? 0) > 0)
    .sort((a, b) => a.sequence - b.sequence);
  if (pool.length < 15) return empty;

  const mixedClubs = normal.size > 1;
  const share = (s: Shot) => ((s.carry as number) / (normal.get(s.club) as number)) * 100;

  const size = Math.floor(pool.length / 3);
  const slices = [pool.slice(0, size), pool.slice(size, size * 2), pool.slice(size * 2)];
  const labels = ['First third', 'Middle', 'Last third'];

  const thirds: ProgressionThird[] = slices.map((slice, i) => ({
    label: labels[i] as string,
    carry: median(pluck(slice, (s) => s.carry)),
    share: median(slice.map(share)),
    strikeQuality: median(pluck(slice, (s) => s.smashFactor)),
    n: slice.length,
  }));

  const first = thirds[0] as ProgressionThird;
  const last = thirds[2] as ProgressionThird;
  const shareChange = last.share - first.share;
  const carryChange = mixedClubs ? Number.NaN : last.carry - first.carry;

  // One sentence for the size of the change, in yards when yards are honest.
  const amount = mixedClubs
    ? `${Math.round(Math.abs(shareChange))}% of your normal carry`
    : plural(Math.round(Math.abs(carryChange)), 'yard');
  const acrossClubs = mixedClubs
    ? ' Each shot is measured against that club’s own normal distance, so switching clubs does not count as a change.'
    : '';

  if (shareChange >= MEANINGFUL_SHARE) {
    return {
      thirds, mixedClubs, carryChange, shareChange, verdict: 'warmed-up',
      headline: mixedClubs
        ? `You gained ${amount} as the session went on`
        : `You got ${amount} longer as the session went on`,
      detail:
        'Your best golf was at the end, which usually means the warm-up was too short rather ' +
        'than that the session was good. On the course you only get the first tee shot once — ' +
        `a longer warm-up moves this ground into the round instead of the range.${acrossClubs}`,
    };
  }

  if (shareChange <= -MEANINGFUL_SHARE) {
    return {
      thirds, mixedClubs, carryChange, shareChange, verdict: 'faded',
      headline: `You lost ${amount} over the session`,
      detail:
        'Contact fell away as you went. That is usually fatigue or a change being drilled past ' +
        'the point where it was still being absorbed. Shorter sessions, or a break in the ' +
        `middle, will get you more out of the same hour.${acrossClubs}`,
    };
  }

  return {
    thirds, mixedClubs, carryChange, shareChange, verdict: 'steady',
    headline: 'You held your level right through the session',
    detail:
      'Carry stayed where it started. Consistency across a session is worth having — it means ' +
      `the numbers here describe your golf rather than your warm-up.${acrossClubs}`,
  };
}
