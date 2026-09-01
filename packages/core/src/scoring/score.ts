import type { Club } from '../schema.js';
import type { ClubConsistency } from '../analysis/consistency.js';
import type { StrikeBreakdown } from '../analysis/strike.js';
import type { OptimalComparison } from '../benchmarks/personal.js';
import type { ClubProfile } from '../stats/dispersion.js';

/**
 * Session scoring.
 *
 * Practice is dull because nothing keeps score. A range session gives a
 * golfer no way to know whether today went well, so improvement feels
 * invisible even when it is happening — and invisible progress is the reason
 * people stop practising.
 *
 * A score fixes that, but only if it is honest. Two rules hold everything
 * here together:
 *
 *   1. **It must be beatable by getting better, and only by that.** Nothing
 *      here rewards hitting more balls, hitting driver instead of a wedge, or
 *      picking an easy target. Every component is a rate or a spread.
 *   2. **It must not lie to be encouraging.** A bad session scores badly. A
 *      score that always says "nice work" is worth exactly nothing the first
 *      time a player notices, and they always notice.
 *
 * The components are weighted by what actually decides scoring: contact
 * first, repeatability second, then how close the delivery sits to what the
 * player's own swing speed should produce, then how tight the result was.
 */

export interface ScoreComponent {
  id: string;
  label: string;
  /** 0-100. */
  score: number;
  /** Share of the overall score this contributes. */
  weight: number;
  detail: string;
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface SessionScore {
  /** 0-100 overall. */
  total: number;
  grade: Grade;
  /** What the grade means, in one line. */
  verdict: string;
  components: ScoreComponent[];
  /** The component dragging the score down most, weighted. */
  weakest: ScoreComponent | null;
  /** Points available from fixing the weakest component alone. */
  headroom: number;
}

/** Clamp to 0-100 and round — a component score with fifteen decimal places
 * on it is a number nobody asked for and every display has to undo. */
function clamp(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)));
}

function gradeFor(total: number): Grade {
  if (total >= 88) return 'S';
  if (total >= 75) return 'A';
  if (total >= 60) return 'B';
  if (total >= 42) return 'C';
  return 'D';
}

const VERDICTS: Record<Grade, string> = {
  S: 'Everything held together. This is the session to repeat.',
  A: 'Strong. The pattern is there and it is repeatable.',
  B: 'Solid work with one clear thing holding it back.',
  C: 'The good swings are in there; they are not showing up often enough yet.',
  D: 'A grinding session. Worth knowing — these are the ones that make the next block matter.',
};

export function scoreSession(args: {
  profile: ClubProfile | null;
  strike: StrikeBreakdown;
  consistency: ClubConsistency | null;
  optimals: OptimalComparison[] | null;
}): SessionScore | null {
  const { profile, strike, consistency, optimals } = args;
  if (!profile || strike.total < 6) return null;

  const components: ScoreComponent[] = [];

  // --- Contact. The largest single driver of amateur scoring. -----------
  const strikeScore = clamp(strike.qualityShare * 100);
  components.push({
    id: 'strike',
    label: 'Contact',
    score: strikeScore,
    weight: 0.35,
    detail: `${Math.round(strike.qualityShare * 100)}% of your strikes were solid or better.`,
  });

  // --- Repeatability. Whether today's good swing is available tomorrow.
  if (consistency) {
    components.push({
      id: 'repeatability',
      label: 'Repeatability',
      score: clamp(consistency.overall),
      weight: 0.3,
      detail: consistency.weakest
        ? `Held together everywhere except ${consistency.weakest.label.toLowerCase()}.`
        : 'Measured across every metric with enough shots behind it.',
    });
  }

  // --- Delivery against the player's own optimal windows. ---------------
  if (optimals && optimals.length > 0) {
    const judged = optimals.filter((o) => o.status !== 'unknown');
    if (judged.length > 0) {
      const onTarget = judged.filter((o) => o.status === 'on-target').length;
      components.push({
        id: 'delivery',
        label: 'Delivery',
        score: clamp((onTarget / judged.length) * 100),
        weight: 0.2,
        detail: `${onTarget} of ${judged.length} numbers inside the window for your swing speed.`,
      });
    }
  }

  // --- Dispersion. What the player actually sees on the ground. ---------
  const d = profile.dispersion;
  const carry = profile.carry.median;
  if (d && Number.isFinite(d.width) && Number.isFinite(carry) && carry > 0) {
    // A pattern under 10% of carry is tight; over 30% is scattered.
    const relative = d.width / carry;
    components.push({
      id: 'dispersion',
      label: 'Dispersion',
      score: clamp(((0.3 - relative) / (0.3 - 0.1)) * 100),
      weight: 0.15,
      detail: `Your pattern is ${Math.round(d.width)} yards wide on a ${Math.round(carry)}-yard shot.`,
    });
  }

  // Renormalise so a missing component does not silently cost points — a
  // player whose launch monitor reports no club data should not be graded
  // down for what it could not measure.
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0) || 1;
  const total = Math.round(
    components.reduce((sum, c) => sum + c.score * (c.weight / totalWeight), 0),
  );

  const weakest = [...components].sort(
    (a, b) => (a.score * a.weight) - (b.score * b.weight),
  )[0] ?? null;

  const headroom = weakest
    ? Math.round((100 - weakest.score) * (weakest.weight / totalWeight))
    : 0;

  const grade = gradeFor(total);
  return { total, grade, verdict: VERDICTS[grade], components, weakest, headroom };
}

/**
 * Personal bests, so a session can be measured against the player's own
 * history rather than an abstract standard.
 *
 * Only records that reward *better golf* are tracked. Longest drive is
 * deliberately absent: it rewards one swing out of fifty and swinging out of
 * your shoes, which is the opposite of what this app is for.
 */
// Named PersonalRecord, not Record — the latter shadows TypeScript's built-in
// utility type and breaks every `Record<K, V>` in the file.
export interface PersonalRecord {
  id: string;
  label: string;
  club: Club;
  value: number;
  unit: string;
  sessionId: string;
  date: Date | null;
  /** True when this session set it. */
  isNew: boolean;
}

export interface RecordCandidate {
  id: string;
  label: string;
  unit: string;
  /** Higher is better for this record. */
  higherBetter: boolean;
  read: (p: ClubProfile, s: StrikeBreakdown) => number;
}

export const RECORDS: RecordCandidate[] = [
  {
    id: 'flush-rate', label: 'Best flush rate', unit: '%', higherBetter: true,
    read: (_p, s) => (s.counts.find((c) => c.klass === 'flush')?.share ?? 0) * 100,
  },
  {
    id: 'quality-rate', label: 'Best contact rate', unit: '%', higherBetter: true,
    read: (_p, s) => s.qualityShare * 100,
  },
  {
    id: 'tightest-carry', label: 'Tightest carry spread', unit: 'yds', higherBetter: false,
    read: (p) => p.carry.mad,
  },
  {
    id: 'tightest-pattern', label: 'Tightest pattern', unit: 'yds', higherBetter: false,
    read: (p) => p.dispersion?.width ?? Number.NaN,
  },
  {
    id: 'best-smash', label: 'Best strike efficiency', unit: '', higherBetter: true,
    read: (p) => p.smashFactor.median,
  },
];
