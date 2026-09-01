import type { SessionReport } from '../diagnose/index.js';

/**
 * Achievements.
 *
 * The point of these is not novelty, it is attention. Each one marks a
 * threshold that genuinely means something in golf, so earning it tells the
 * player they crossed a real line rather than that they showed up.
 *
 * Two things deliberately absent: nothing rewards volume, and nothing
 * rewards a single swing. Both are easy to farm and neither makes anybody
 * better — a longest-drive badge just teaches people to swing out of their
 * shoes once.
 */

export interface Achievement {
  id: string;
  name: string;
  /** What it takes, stated plainly enough to aim at. */
  requirement: string;
  /** Why this threshold is worth caring about. */
  meaning: string;
  tier: 'bronze' | 'silver' | 'gold';
  earned: boolean;
  /** 0-1 towards earning it, for the ones worth showing progress on. */
  progress: number;
}

interface Definition {
  id: string;
  name: string;
  requirement: string;
  meaning: string;
  tier: Achievement['tier'];
  /** Returns progress 0-1; at or above 1 the achievement is earned. */
  measure: (report: SessionReport) => number | null;
}

const DEFINITIONS: Definition[] = [
  {
    id: 'clean-contact',
    name: 'Clean Contact',
    requirement: '80% of shots struck solid or better',
    meaning: 'Contact is the single biggest lever an amateur has. This is the threshold where it stops costing you shots.',
    tier: 'bronze',
    measure: (r) => (r.strike.total >= 10 ? r.strike.qualityShare / 0.8 : null),
  },
  {
    id: 'flusher',
    name: 'Flusher',
    requirement: '35% of shots in your top strike band',
    meaning: 'Not just avoiding bad ones — finding the middle often enough that your good number becomes your normal number.',
    tier: 'silver',
    measure: (r) => {
      if (r.strike.total < 10) return null;
      const flush = r.strike.counts.find((c) => c.klass === 'flush')?.share ?? 0;
      return flush / 0.35;
    },
  },
  {
    id: 'dialled-in',
    name: 'Dialled In',
    requirement: 'Every measured number inside your optimal window',
    meaning: 'Your delivery matches what your own swing speed should produce. Nothing left to correct, only to repeat.',
    tier: 'gold',
    measure: (r) => {
      const judged = r.optimals?.comparisons.filter((c) => c.status !== 'unknown') ?? [];
      if (judged.length < 4) return null;
      return judged.filter((c) => c.status === 'on-target').length / judged.length;
    },
  },
  {
    id: 'repeatable',
    name: 'Repeatable',
    requirement: 'Repeatability score of 75 or better',
    meaning: 'The difference between owning a swing and borrowing one. At this level today’s golf is available tomorrow.',
    tier: 'silver',
    measure: (r) => (r.consistency ? r.consistency.overall / 75 : null),
  },
  {
    id: 'tight-pattern',
    name: 'Green In Regulation',
    requirement: 'Pattern narrower than 30 yards — the width of a green',
    meaning: 'A green is about thirty yards across. Inside this, you are aiming at flags rather than at the middle and hoping.',
    tier: 'gold',
    measure: (r) => {
      const main = [...r.profiles].sort((a, b) => b.shotCount - a.shotCount)[0];
      const width = main?.dispersion?.width;
      if (width === undefined || !Number.isFinite(width)) return null;
      // Progress rises as the pattern narrows towards 30 yards.
      return Math.min(1, 30 / width);
    },
  },
  {
    id: 'no-blow-ups',
    name: 'No Blow-Ups',
    requirement: 'A full session without a single unusable strike',
    meaning: 'On the course a topped shot costs a whole stroke on its own. A session without one is a session you could have scored on.',
    tier: 'bronze',
    measure: (r) => {
      if (r.shotCount < 15) return null;
      return r.discardedCount === 0 ? 1 : 0;
    },
  },
  {
    id: 'tour-strike',
    name: 'Tour Strike',
    requirement: 'Strike efficiency at or above the tour figure for your club',
    meaning: 'Smash factor is a ratio, so it is the one headline number you can match outright at any swing speed. This is that.',
    tier: 'gold',
    measure: (r) => {
      const smash = r.optimals?.comparisons.find((c) => c.window.metric === 'smashFactor');
      if (!smash || smash.status === 'unknown') return null;
      return smash.actual / smash.window.target;
    },
  },
];

export function evaluateAchievements(report: SessionReport): Achievement[] {
  const out: Achievement[] = [];
  for (const def of DEFINITIONS) {
    const raw = def.measure(report);
    if (raw === null || !Number.isFinite(raw)) continue;
    const progress = Math.max(0, Math.min(1, raw));
    out.push({
      id: def.id,
      name: def.name,
      requirement: def.requirement,
      meaning: def.meaning,
      tier: def.tier,
      earned: raw >= 1,
      progress,
    });
  }
  // Earned first, then whatever is closest to being earned — the list should
  // read as "here is what you did, and here is what is nearly in reach".
  return out.sort(
    (a, b) => Number(b.earned) - Number(a.earned) || b.progress - a.progress,
  );
}

/**
 * Practice streak, counted in distinct days rather than sessions.
 *
 * Counting sessions would reward importing the same afternoon twice. Days
 * are what a habit is actually made of.
 */
export interface Streak {
  /** Consecutive days with a session, counting back from the most recent. */
  current: number;
  /** The best run on record. */
  best: number;
  /** Distinct days practised, all time. */
  totalDays: number;
  /** True when the streak includes today. */
  liveToday: boolean;
}

export function practiceStreak(dates: (Date | null)[], now = new Date()): Streak {
  const days = [
    ...new Set(
      dates
        .filter((d): d is Date => d !== null)
        .map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()),
    ),
  ].sort((a, b) => b - a);

  if (days.length === 0) return { current: 0, best: 0, totalDays: 0, liveToday: false };

  const DAY = 86_400_000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if ((days[i - 1] as number) - (days[i] as number) === DAY) run++;
    else run = 1;
    best = Math.max(best, run);
  }

  // The current streak only counts if it reaches today or yesterday —
  // otherwise it is a run that already ended, and calling it "current" would
  // be flattering the player rather than informing them.
  let current = 0;
  const gapFromToday = (today - (days[0] as number)) / DAY;
  if (gapFromToday <= 1) {
    current = 1;
    for (let i = 1; i < days.length; i++) {
      if ((days[i - 1] as number) - (days[i] as number) === DAY) current++;
      else break;
    }
  }

  return { current, best, totalDays: days.length, liveToday: gapFromToday === 0 };
}
