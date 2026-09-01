import type { Club, ShotSession } from '../schema.js';
import { buildClubProfiles, type ClubProfile } from '../stats/dispersion.js';
import { classifyStrikes } from '../analysis/strike.js';
import { markImplausible, markMishits, markUnusable } from '../stats/outliers.js';

/**
 * Closing the practice loop.
 *
 * The app could already say what to work on and how. What it could not say is
 * whether the work landed — `didItWork` compares a handful of generic metrics
 * between two sessions, but nothing checked the thing the player was actually
 * told to achieve. So a block could say "get 75% of them inside 11 yards", the
 * player could go and do it, and the app would never mention it again.
 *
 * A target is that pass mark made machine-readable: one measurement, one
 * comparator, one number, and the value it was set from. When the next session
 * is imported it is measured against them and reported hit or missed, with the
 * actual figure and the movement from baseline.
 *
 * TARGETS ARE SET FROM THE PLAYER'S OWN NUMBERS, NOT FROM TOUR. A tour figure
 * is a destination, not a next step, and a target nobody can reach in one
 * session is one they stop reading. Each is a demanding-but-plausible step
 * from where the player is now — and the step shrinks as they get closer to
 * the benchmark, because the last yard of a dispersion is far harder than the
 * first.
 */

export type TargetMetric =
  | 'carrySpread'
  | 'containment75'
  | 'sideSpread'
  | 'strikeQuality'
  | 'faceSpread'
  | 'lowPointSpread'
  | 'smashFactor'
  | 'unusableRate';

export interface PracticeTarget {
  id: string;
  metric: TargetMetric;
  club: Club | null;
  /** Which way counts as passing. */
  comparator: 'at-most' | 'at-least';
  value: number;
  unit: string;
  /** What the measurement was when the target was set. */
  baseline: number | null;
  /** One line a player can check against the screen in front of them. */
  label: string;
}

export interface TargetResult {
  target: PracticeTarget;
  /** What the new session measured, or null when it could not be measured. */
  actual: number | null;
  met: boolean | null;
  /** Signed movement from the baseline, in the metric's own unit. */
  movement: number | null;
  /** True when it moved the right way, whether or not the target was hit. */
  improved: boolean | null;
  verdict: string;
}

interface MetricSpec {
  label: string;
  unit: string;
  dp: number;
  /** Passing means going down for most of these. */
  comparator: PracticeTarget['comparator'];
  /** Overrides the default wording where "<metric> under <n>" reads badly. */
  phrase?: (club: Club | null, value: number, unit: string) => string;
  /** Physical bounds. A rate cannot go below zero and a share cannot exceed 100. */
  min?: number;
  max?: number;
  read(profile: ClubProfile | null, session: ShotSession): number | null;
}

const METRICS: Record<TargetMetric, MetricSpec> = {
  carrySpread: {
    min: 0,
    label: 'Carry spread', unit: 'yds', dp: 1, comparator: 'at-most',
    read: (p) => (p && p.carry.n >= 8 ? finite(p.carry.mad) : null),
  },
  containment75: {
    min: 0,
    label: '75% of shots inside', unit: 'yds', dp: 1, comparator: 'at-most',
    phrase: (club, v, u) => `Three in four ${club ?? 'shots'} inside ${v}${u} of the middle`,
    read: (p) => (p?.containment ? finite(p.containment.p75) : null),
  },
  sideSpread: {
    min: 0,
    label: 'Sideways spread', unit: 'yds', dp: 1, comparator: 'at-most',
    read: (p) => (p && p.side.n >= 8 ? finite(p.side.mad) : null),
  },
  strikeQuality: {
    label: 'Solid strikes', unit: '%', dp: 0, comparator: 'at-least',
    phrase: (_c, v, u) => `Solid or better on ${v}${u} of strikes`,
    min: 0, max: 100,
    read: (_p, session) => {
      const strike = classifyStrikes(session.shots);
      return strike.total >= 10 ? strike.qualityShare * 100 : null;
    },
  },
  faceSpread: {
    min: 0,
    label: 'Face angle spread', unit: '°', dp: 1, comparator: 'at-most',
    read: (p) => (p && p.faceAngle.n >= 8 ? finite(p.faceAngle.mad) : null),
  },
  lowPointSpread: {
    min: 0,
    label: 'Low point spread', unit: 'in', dp: 1, comparator: 'at-most',
    read: (p) => (p && p.lowPointDistance.n >= 8 ? finite(p.lowPointDistance.mad) : null),
  },
  smashFactor: {
    label: 'Strike efficiency', unit: '', dp: 3, comparator: 'at-least',
    read: (p) => (p && p.smashFactor.n >= 8 ? finite(p.smashFactor.median) : null),
  },
  unusableRate: {
    label: 'Tops and duffs', unit: '%', dp: 1, comparator: 'at-most',
    phrase: (_c, v, u) => `No more than ${v}${u} of shots topped or duffed`,
    min: 0, max: 100,
    read: (_p, session) => {
      if (session.shots.length < 15) return null;
      const bad = session.shots.filter((s) => s.flags.includes('unusable')).length;
      return (bad / session.shots.length) * 100;
    },
  },
};

function finite(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

/**
 * How big a step to ask for: a quarter of the way to the benchmark.
 *
 * A fixed percentage is wrong at both ends. Cutting a 25-yard spread by 15% is
 * a comfortable session's work; cutting an 8-yard one by 15% is asking for
 * tour-standard distance control by Thursday. Taking a fixed share of the
 * remaining *gap* scales itself — a long way from the mark it is a big ask, and
 * close to it a small one — without a curve pretending to a precision this
 * does not have.
 */
const STEP_OF_GAP = 0.25;

/** A player already past the benchmark still gets asked for a little more. */
const BEYOND_STEP = 0.04;

/** Build a target from where the player is now and where the benchmark sits. */
export function targetFrom(
  metric: TargetMetric,
  club: Club | null,
  current: number,
  benchmark: number,
): PracticeTarget {
  const spec = METRICS[metric];
  const lower = spec.comparator === 'at-most';

  // Positive means there is still room between the player and the benchmark.
  const gap = lower ? current - benchmark : benchmark - current;

  /*
   * A player already past the benchmark is the case the first version got
   * wrong. It clamped the target to the benchmark in both directions, so
   * somebody holding a six-yard carry spread — tighter than tour — was told to
   * get it under 7.9. The bar must never move backwards to meet somebody: past
   * the benchmark, the ask is a small step beyond where they already are.
   */
  const value = gap > 0
    ? (lower ? current - gap * STEP_OF_GAP : current + gap * STEP_OF_GAP)
    : (lower ? current * (1 - BEYOND_STEP) : current * (1 + BEYOND_STEP));

  let shown = round(value, spec.dp);
  const baseline = round(current, spec.dp);

  /*
   * A target that rounds to the same number as the baseline is not a target,
   * it is today's figure with a different label on it. Nudge it one display
   * unit in the right direction so what is being asked for is unambiguous.
   */
  if (shown === baseline) {
    const unit = 10 ** -spec.dp;
    shown = round(lower ? shown - unit : shown + unit, spec.dp);
    // Nudging must not push the ask past the benchmark for somebody still
    // short of it — that would turn a step into an impossible leap.
    if (gap > 0) {
      shown = lower
        ? Math.max(shown, round(benchmark, spec.dp))
        : Math.min(shown, round(benchmark, spec.dp));
    }
  }

  /*
   * Physical bounds, last. Without them a player who topped nothing was asked
   * for "no more than -0.1% of shots topped", because the nudge above pushed a
   * zero one display unit further down. Where the bound leaves nothing to ask
   * for, the target becomes a hold rather than an improvement — repeating a
   * clean session is a real thing to go and do.
   */
  if (spec.min !== undefined) shown = Math.max(shown, spec.min);
  if (spec.max !== undefined) shown = Math.min(shown, spec.max);
  const hold = shown === baseline;

  return {
    id: `${metric}:${club ?? 'bag'}`,
    metric,
    club,
    comparator: spec.comparator,
    value: shown,
    unit: spec.unit,
    baseline,
    label: hold
      ? `Hold ${spec.label.toLowerCase()}${club ? ` with the ${club}` : ''} at ` +
        `${shown}${spec.unit}`
      : spec.phrase
        ? spec.phrase(club, shown, spec.unit)
        : lower
          ? `${spec.label}${club ? ` with the ${club}` : ''} under ${shown}${spec.unit}`
          : `${spec.label}${club ? ` with the ${club}` : ''} at ${shown}${spec.unit} or better`,
  };
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Measure a set of targets against a later session.
 *
 * Flags the session's own outliers first, because the targets were set from
 * numbers computed the same way — comparing a cleaned baseline against a raw
 * follow-up would show an improvement that is entirely an artefact.
 */
export function evaluateTargets(
  targets: PracticeTarget[],
  session: ShotSession,
): TargetResult[] {
  const shots = session.shots.map((s) => ({ ...s, flags: [] as typeof s.flags }));
  markImplausible(shots);
  markUnusable(shots);
  markMishits(shots);
  const cleaned: ShotSession = { ...session, shots };
  const profiles = buildClubProfiles(shots);

  return targets.map((target) => {
    const spec = METRICS[target.metric];
    const profile = target.club
      ? profiles.find((p) => p.club === target.club) ?? null
      : [...profiles].sort((a, b) => b.shotCount - a.shotCount)[0] ?? null;

    const actual = spec.read(profile, cleaned);
    if (actual === null) {
      return {
        target,
        actual: null,
        met: null,
        movement: null,
        improved: null,
        verdict: target.club
          ? `No ${target.club} shots to measure this on.`
          : 'Not enough shots to measure this.',
      };
    }

    const met = target.comparator === 'at-most'
      ? actual <= target.value
      : actual >= target.value;

    const movement = target.baseline === null ? null : round(actual - target.baseline, spec.dp);
    const improved = movement === null
      ? null
      : target.comparator === 'at-most' ? movement < 0 : movement > 0;

    return {
      target,
      actual: round(actual, spec.dp),
      met,
      movement,
      improved,
      verdict: verdictFor(target, actual, movement, met, spec),
    };
  });
}

function verdictFor(
  target: PracticeTarget,
  actual: number,
  movement: number | null,
  met: boolean,
  spec: MetricSpec,
): string {
  const shown = `${round(actual, spec.dp)}${target.unit}`;
  if (met && movement !== null && movement !== 0) {
    return `Hit it — ${shown}, from ${target.baseline}${target.unit}.`;
  }
  if (met) return `Hit it — ${shown}.`;
  if (movement !== null && ((target.comparator === 'at-most' && movement < 0)
    || (target.comparator === 'at-least' && movement > 0))) {
    return `Moved the right way but short of the mark — ${shown}, from ` +
      `${target.baseline}${target.unit}.`;
  }
  return `Missed — ${shown} against a target of ${target.value}${target.unit}.`;
}

/**
 * Where to set the bar next.
 *
 * Hit it, and the same target is no longer practice — it is a thing you can
 * already do, so it tightens. Miss it twice and the bar was set wrong rather
 * than the player being lazy, so it loosens back towards what they actually
 * managed. This is the whole of the adaptive behaviour and it deliberately
 * has no memory beyond the last result: a model that needs a training history
 * to decide the next rep is a model nobody can predict or argue with.
 */
export function nextTarget(
  result: TargetResult,
  benchmark: number,
  consecutiveMisses = 0,
): PracticeTarget {
  const { target, actual } = result;
  if (actual === null) return target;

  if (result.met) return targetFrom(target.metric, target.club, actual, benchmark);

  if (consecutiveMisses >= 2) {
    // Reset to a step from where they genuinely are, not from the old target.
    return targetFrom(target.metric, target.club, actual, benchmark);
  }
  return target;
}

export function targetMetricLabel(metric: TargetMetric): string {
  return METRICS[metric].label;
}
