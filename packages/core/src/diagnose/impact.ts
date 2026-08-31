import type { Finding } from './types.js';

/**
 * How much is this fault actually costing, and how fast can it be fixed?
 *
 * Ordering findings by a fixed coaching hierarchy gets the *sequence* right —
 * you cannot trust a path number measured off a scattered strike — but it
 * says nothing about size. A 2.1° face-to-path and a 20% mishit rate both
 * come out as "minor / strike before direction", when one of them is costing
 * a stroke a round and the other is costing four.
 *
 * So findings are ranked by estimated impact instead, along three axes:
 *
 *   - **Course cost.** Estimated strokes per 18 holes. What actually matters.
 *   - **Simulator cost.** Effect on a scored TrackMan test, in Combine
 *     points. Different from course cost on purpose: the Combine is pure
 *     distance control and proximity, so a calibration error wrecks it while
 *     a driver spin problem barely registers. Both are worth improving and
 *     they do not reward the same work.
 *   - **Speed.** How long the fix takes to show up. A yardage recalibration
 *     pays off on the next round; a club-path rebuild takes months. When two
 *     faults cost the same, the one that pays this week wins.
 *
 * EVERY NUMBER BELOW IS AN ESTIMATE, and should be presented as one. They
 * come from the well-established shape of amateur scoring — mishits and
 * distance control dominate, cosmetic swing numbers do not — rather than
 * from a fitted model of this player. They are good enough to rank faults
 * against each other, which is all they are used for. They are not good
 * enough to quote as a prediction, and the UI should never imply otherwise.
 */

export type FixSpeed = 'immediate' | 'weeks' | 'months';

export interface Impact {
  /** Estimated strokes per 18 holes this fault costs. */
  courseStrokes: number;
  /** Estimated cost on a scored simulator test, in Combine points (0-100). */
  simPoints: number;
  speed: FixSpeed;
  /** Composite ranking score. Higher is more worth doing first. */
  score: number;
  /** Plain-language summary for the UI. */
  summary: string;
}

interface ImpactModel {
  courseStrokes: number;
  simPoints: number;
  speed: FixSpeed;
}

/**
 * A fault that pays off immediately is worth more than one of equal size
 * that takes months, because the player gets the benefit for the whole
 * intervening season — and because a change they can feel working is a
 * change they will actually stick with.
 */
const SPEED_MULTIPLIER: Record<FixSpeed, number> = {
  immediate: 1.5,
  weeks: 1.0,
  months: 0.7,
};

/** Roughly how many Combine points equate to one stroke on the course. */
const POINTS_PER_STROKE = 10;

/** Low-confidence findings should not outrank well-evidenced ones. */
const CONFIDENCE_WEIGHT = { high: 1.0, medium: 0.85, low: 0.55 } as const;

const MODELS: Record<string, ImpactModel> = {
  // --- Calibration. The largest, cheapest win in the game. -------------
  // Being consistently short of every flag costs a fraction of a stroke on
  // every approach, and the fix is writing down different numbers.
  'target-short-bias': { courseStrokes: 2.0, simPoints: 18, speed: 'immediate' },
  'target-long-bias': { courseStrokes: 1.8, simPoints: 18, speed: 'immediate' },

  // --- Contact. Dominates amateur scoring. ----------------------------
  'high-mishit-rate': { courseStrokes: 2.6, simPoints: 16, speed: 'weeks' },
  'strike-scattered': { courseStrokes: 1.8, simPoints: 14, speed: 'weeks' },
  'low-point-behind-ball': { courseStrokes: 1.6, simPoints: 12, speed: 'weeks' },
  'low-point-inconsistent': { courseStrokes: 1.1, simPoints: 9, speed: 'weeks' },
  'strike-toe-biased': { courseStrokes: 0.9, simPoints: 7, speed: 'weeks' },
  'strike-heel-biased': { courseStrokes: 0.9, simPoints: 7, speed: 'weeks' },

  // --- Distance control. Huge in a simulator test, big on a course. ----
  'carry-inconsistent': { courseStrokes: 1.5, simPoints: 20, speed: 'weeks' },
  'target-distance-spread': { courseStrokes: 1.5, simPoints: 22, speed: 'weeks' },
  'weak-target-distance': { courseStrokes: 0.7, simPoints: 10, speed: 'weeks' },

  // --- Direction. Real, but smaller than most golfers assume. ---------
  'face-inconsistent': { courseStrokes: 1.4, simPoints: 10, speed: 'weeks' },
  'face-open-to-path': { courseStrokes: 1.2, simPoints: 8, speed: 'weeks' },
  'face-closed-to-path': { courseStrokes: 1.2, simPoints: 8, speed: 'weeks' },
  'path-out-to-in': { courseStrokes: 0.8, simPoints: 5, speed: 'months' },
  'path-in-to-out': { courseStrokes: 0.8, simPoints: 5, speed: 'months' },

  // --- Gapping. A club-selection problem, so it fixes fast. -----------
  'gap-inverted': { courseStrokes: 0.8, simPoints: 8, speed: 'immediate' },
  'gap-oversized': { courseStrokes: 0.6, simPoints: 6, speed: 'immediate' },
  'gap-overlap': { courseStrokes: 0.3, simPoints: 3, speed: 'immediate' },

  // --- Distance and launch. Fewer strokes than people think. ----------
  // A driver problem only touches the fourteen tee shots where you use it,
  // and the Combine scores driver on one target out of ten.
  'low-smash-factor': { courseStrokes: 0.8, simPoints: 6, speed: 'weeks' },
  'driver-negative-aoa': { courseStrokes: 0.6, simPoints: 3, speed: 'immediate' },
  'spin-too-high': { courseStrokes: 0.5, simPoints: 3, speed: 'weeks' },
  'spin-too-low': { courseStrokes: 0.4, simPoints: 3, speed: 'weeks' },
  'iron-positive-aoa': { courseStrokes: 1.3, simPoints: 11, speed: 'weeks' },
};

const DEFAULT_MODEL: ImpactModel = { courseStrokes: 0.4, simPoints: 3, speed: 'weeks' };

/**
 * Roughly "one notch" of each unit — how much of a miss is a meaningful step.
 *
 * Without this the multiplier is unit-dependent, which quietly ranks metrics
 * by what they happen to be measured in: 8 yards of distance bias and 3.8° of
 * club path are comparable problems, but scoring raw magnitude makes the
 * yards look nearly twice as bad purely because yards are bigger numbers.
 */
const UNIT_STEP: Record<string, number> = {
  '°': 2,
  yds: 6,
  mm: 8,
  in: 1.5,
  rpm: 600,
  mph: 4,
  '%': 8,
  '/100': 12,
  '': 0.05, // dimensionless ratios such as smash factor
};

/**
 * Scale the base estimate by how far past the threshold this player actually
 * is. A finding that just cleared the bar and one that is triple it are the
 * same rule but not the same problem.
 *
 * Bounded tightly on purpose. These are rough estimates being used to order a
 * list, and letting a multiplier run to 2× or beyond turns a plausible
 * "about 2 shots a round" into a number that reads as a precise claim and is
 * not one.
 */
function magnitudeMultiplier(finding: Finding): number {
  const primary = finding.evidence[0];
  if (!primary || primary.reference === undefined) {
    return finding.severity === 'major' ? 1.3 : 1.0;
  }

  const step = UNIT_STEP[primary.unit] ?? 1;
  const distance =
    primary.reference === 0
      ? Math.abs(primary.value)
      : Math.abs(primary.value - primary.reference);

  // How many "notches" past the reference, in the metric's own units.
  const notches = distance / step;
  return Math.min(1.8, Math.max(0.7, 0.75 + notches * 0.35));
}

export function impactOf(finding: Finding): Impact {
  const model = MODELS[finding.id] ?? DEFAULT_MODEL;
  const magnitude = magnitudeMultiplier(finding);

  const courseStrokes = model.courseStrokes * magnitude;
  const simPoints = model.simPoints * magnitude;

  const combined = courseStrokes + simPoints / POINTS_PER_STROKE;
  const score = combined * SPEED_MULTIPLIER[model.speed] * CONFIDENCE_WEIGHT[finding.confidence];

  return {
    courseStrokes,
    simPoints,
    speed: model.speed,
    score,
    summary: describe(courseStrokes, simPoints, model.speed),
  };
}

function describe(courseStrokes: number, simPoints: number, speed: FixSpeed): string {
  const when =
    speed === 'immediate'
      ? 'Pays off on your next round'
      : speed === 'weeks'
        ? 'Takes a few weeks of focused work'
        : 'A months-long change, not a quick fix';
  return `Worth roughly ${courseStrokes.toFixed(1)} shots a round and about ${Math.round(simPoints)} points on a scored test. ${when}.`;
}

/**
 * Rank findings by impact, subject to one hard constraint.
 *
 * Strike quality has to be addressed before direction *on the same club*,
 * regardless of the numbers: face and path measured off a strike that moves
 * around the face are not describing the swing, they are describing the
 * mishits. That is a dependency, not a preference, so it survives the
 * ranking rather than competing with it.
 *
 * Across different clubs there is no such dependency, and impact decides.
 */
export function rankByImpact(findings: Finding[]): Finding[] {
  const STRIKE = new Set([
    'strike-scattered',
    'strike-toe-biased',
    'strike-heel-biased',
    'low-point-behind-ball',
    'low-point-inconsistent',
    'high-mishit-rate',
  ]);
  const DIRECTION = new Set([
    'face-open-to-path',
    'face-closed-to-path',
    'face-inconsistent',
    'path-out-to-in',
    'path-in-to-out',
  ]);

  const scored = findings.map((finding) => ({ finding, impact: impactOf(finding) }));
  scored.sort((a, b) => b.impact.score - a.impact.score);

  // Best strike score per club, so direction findings can be held behind it.
  const strikeRank = new Map<string, number>();
  scored.forEach(({ finding }, index) => {
    if (finding.club && STRIKE.has(finding.id)) {
      const existing = strikeRank.get(finding.club);
      if (existing === undefined || index < existing) strikeRank.set(finding.club, index);
    }
  });

  const result = scored.map((entry, index) => ({ ...entry, order: index }));
  for (const entry of result) {
    const { finding } = entry;
    if (!finding.club || !DIRECTION.has(finding.id)) continue;
    const strikeIndex = strikeRank.get(finding.club);
    if (strikeIndex !== undefined && entry.order < strikeIndex) {
      // Sort just after the strike finding it depends on.
      entry.order = strikeIndex + 0.5;
    }
  }

  result.sort((a, b) => a.order - b.order);
  return result.map((r) => r.finding);
}
