import { tourWidthFor } from '../benchmarks/skill.js';
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
    requirement: 'Every measured number repeating inside your optimal window',
    meaning: 'Your delivery matches what your own swing speed should produce, shot after shot rather than on average. Nothing left to correct, only to repeat.',
    tier: 'gold',
    /*
     * Counts a number as dialled in only when a typical shot lands in the
     * window, not merely the median. Judging medians handed this gold medal —
     * "nothing left to correct" — to a session with three duffs, a fifty-yard
     * pattern and spin running from 3,500 to 7,200 rpm, because the middle of
     * every one of those ranges happened to sit in the right place.
     */
    measure: (r) => {
      const judged = r.optimals?.comparisons.filter((c) => c.status !== 'unknown') ?? [];
      if (judged.length < 4) return null;
      return judged.filter((c) => c.repeatablyInside).length / judged.length;
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
    name: 'Tour Width',
    requirement: 'Pattern as tight as tour standard for that carry distance',
    meaning: 'Tour players hold about a fifth of their carry distance in width — roughly 31 yards on a 170-yard shot. Inside that you are aiming at flags rather than at the middle and hoping.',
    tier: 'gold',
    measure: (r) => {
      /*
       * Relative to the shot, not a fixed thirty yards. Thirty yards is
       * excellent for a driver and poor for a wedge, and on a 170-yard iron it
       * is *tighter than tour* — so the old absolute version was a milestone
       * nobody could reach, dressed up as an achievable one.
       */
      const main = [...r.profiles].sort((a, b) => b.shotCount - a.shotCount)[0];
      const width = main?.dispersion?.width;
      const carry = main?.carry.median;
      if (width === undefined || !Number.isFinite(width)) return null;
      if (carry === undefined || !Number.isFinite(carry) || carry <= 0) return null;
      return Math.min(1, tourWidthFor(carry) / width);
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
  {
    id: 'few-mishits',
    name: 'Clean Card',
    requirement: 'Fewer than one shot in ten outside your normal pattern',
    meaning: 'On the course every stray one is a stroke, sometimes two. Getting the rate under 10% is where a round stops having a hole that ruins it.',
    tier: 'bronze',
    measure: (r) => {
      const main = [...r.profiles].sort((a, b) => b.shotCount - a.shotCount)[0];
      if (!main || main.shotCount < 15) return null;
      // Progress runs from a 30% rate up to the 10% threshold.
      return (0.3 - main.mishitRate) / 0.2;
    },
  },
  {
    id: 'finished-strong',
    name: 'Finished Strong',
    requirement: 'Not fading over the course of the session',
    meaning: 'Almost everybody gets worse as a session goes on, and the last third is the part that most resembles the back nine. Holding your golf to the end is a skill on its own.',
    tier: 'bronze',
    measure: (r) => {
      if (r.progression.verdict === 'unknown') return null;
      return r.progression.verdict === 'faded' ? 0 : 1;
    },
  },
  {
    id: 'full-bag',
    name: 'Full Bag',
    requirement: 'Four clubs in one session with enough shots to read each',
    meaning: 'One club tells you about one club. Four is where gapping, and whether a fault is in the swing or in that club, become visible at all.',
    tier: 'bronze',
    measure: (r) => {
      const readable = r.profiles.filter((p) => p.representativeCount >= 5).length;
      return readable / 4;
    },
  },
  {
    id: 'one-shape',
    name: 'One Shape',
    requirement: 'The same shot shape on 60% of your swings',
    meaning: 'A ball that always moves the same way can be aimed. Good players are not straighter than everyone else so much as more repetitive, and half a golf course opens up once you can commit to a side.',
    tier: 'silver',
    measure: (r) => {
      if (r.shape.total < 15 || !r.shape.dominant) return null;
      return r.shape.dominant.share / 0.6;
    },
  },
  {
    id: 'square-face',
    name: 'Square At Impact',
    requirement: 'Face angle repeating inside 2 degrees',
    meaning: 'Face angle decides about three quarters of where the ball starts. Two degrees is roughly the width of a green from 150 yards, so inside that you are aiming at flags rather than at the middle.',
    tier: 'silver',
    measure: (r) => {
      const main = [...r.profiles].sort((a, b) => b.shotCount - a.shotCount)[0];
      const spread = main?.faceAngle.mad;
      if (spread === undefined || !Number.isFinite(spread) || (main?.faceAngle.n ?? 0) < 12) {
        return null;
      }
      // From 5 degrees of spread down to the 2-degree threshold.
      return (5 - spread) / 3;
    },
  },
  {
    id: 'low-point-control',
    name: 'Low Point Control',
    requirement: 'Low point repeating inside 2 inches',
    meaning: 'Where the club bottoms out is what separates a flush strike from a thin or a fat one, and it is the single most trainable thing in the golf swing. Two inches is the band good ball strikers live in.',
    tier: 'silver',
    measure: (r) => {
      const main = [...r.profiles].sort((a, b) => b.shotCount - a.shotCount)[0];
      const spread = main?.lowPointDistance.mad;
      if (spread === undefined || !Number.isFinite(spread)
        || (main?.lowPointDistance.n ?? 0) < 12) {
        return null;
      }
      return (5 - spread) / 3;
    },
  },
  {
    id: 'distance-control',
    name: 'Distance Control',
    requirement: 'Carry repeating inside 8% of the distance',
    meaning: 'Direction gets the attention and distance costs the shots. Inside 8% you can take a number and trust it, which is what lets you aim past a bunker instead of short of one.',
    tier: 'silver',
    measure: (r) => {
      const main = [...r.profiles].sort((a, b) => b.shotCount - a.shotCount)[0];
      const carry = main?.carry.median;
      const spread = main?.carry.mad;
      if (!main || carry === undefined || spread === undefined) return null;
      if (!Number.isFinite(carry) || carry <= 0 || !Number.isFinite(spread)) return null;
      if (main.carry.n < 12 || main.distinctTargets > 1) return null;
      const relative = (spread / carry) * 100;
      // From 16% down to the 8% threshold.
      return (16 - relative) / 8;
    },
  },
  {
    id: 'tour-distance-control',
    name: 'Yardage Book',
    requirement: 'Carry repeating inside 5% of the distance — tour standard',
    meaning: 'The level at which a number on a yardage book is a number you will actually hit. Very few amateurs are here and it is worth more strokes than another ten yards of speed.',
    tier: 'gold',
    measure: (r) => {
      const main = [...r.profiles].sort((a, b) => b.shotCount - a.shotCount)[0];
      const carry = main?.carry.median;
      const spread = main?.carry.mad;
      if (!main || carry === undefined || spread === undefined) return null;
      if (!Number.isFinite(carry) || carry <= 0 || !Number.isFinite(spread)) return null;
      if (main.carry.n < 12 || main.distinctTargets > 1) return null;
      const relative = (spread / carry) * 100;
      return (12 - relative) / 7;
    },
  },
  {
    id: 'graded-a',
    name: 'A Grade',
    requirement: 'A session scoring 75 or better',
    meaning: 'Everything held together at once — contact, repeatability, delivery and pattern. Sessions like this are the ones worth going back and reading.',
    tier: 'silver',
    measure: (r) => (r.score ? r.score.total / 75 : null),
  },
  {
    id: 'graded-s',
    name: 'Complete Session',
    requirement: 'A session scoring 88 or better',
    meaning: 'The top grade. Nothing was carrying anything else, which is rarer than any single good number.',
    tier: 'gold',
    measure: (r) => (r.score ? r.score.total / 88 : null),
  },
  {
    id: 'single-figures',
    name: 'Single Figures',
    requirement: 'Ball-striking that supports a handicap under 10',
    meaning: 'The line most golfers spend years trying to cross. This is the ball-striking half of it — the short game still has to hold up its end.',
    tier: 'silver',
    measure: (r) => {
      if (!r.handicap) return null;
      // Progress runs from 24 down to the 10 threshold.
      return (24 - r.handicap.estimate) / 14;
    },
  },
  {
    id: 'scratch-striker',
    name: 'Scratch Striker',
    requirement: 'Ball-striking that supports a scratch handicap',
    meaning: 'Your pattern is as tight as a scratch player\u2019s. Whether you shoot their scores is now a question about the fifty yards around the green.',
    tier: 'gold',
    measure: (r) => {
      if (!r.handicap) return null;
      return (14 - r.handicap.estimate) / 14;
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
