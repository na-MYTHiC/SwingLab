import type { Club, SessionKind, Shot, ShotSession } from '../schema.js';
import { modeForKind, type PracticeMode } from '../practice/modes.js';
import { prescribePractice, type PracticeDuration, type PracticeSession } from '../practice/prescribe.js';
import { markImplausible, markMishits } from '../stats/outliers.js';
import { buildClubProfiles, type ClubProfile } from '../stats/dispersion.js';
import { DRILLS, type Drill } from './drills.js';
import { gappingFindings } from './rules-gapping.js';
import { distanceBiasFindings, weakDistanceFindings } from './rules-target.js';
import { carryConsistencyRule, spinWindowRule } from './rules-spin.js';
import {
  attackAngleRule,
  impactLocationRule,
  lowPointRule,
  mishitRateRule,
  smashRule,
} from './rules-strike.js';
import { faceConsistencyRule, faceToPathRule, pathRule } from './rules-dplane.js';
import {
  dynamicLoftConsistencyRule,
  lateralDispersionRule,
  launchWindowRule,
  spinConsistencyRule,
  speedAdjustedEfficiencyRule,
} from './rules-delivery.js';
import {
  classifyStrikes, clubConsistency, potential, sessionProgression, shapeBreakdown,
  type ClubConsistency, type Potential, type Progression, type ShapeBreakdown,
  type StrikeBreakdown,
} from '../analysis/index.js';
import type { Finding, Rule } from './types.js';
import { impactOf, type Impact } from './impact.js';
import { prioritise, type Prioritised } from './causes.js';

export * from './types.js';
export * from './impact.js';
export * from './causes.js';
export * from './drills.js';

const PER_CLUB_RULES: Rule[] = [
  // Order here is not the output order — see `priority` below.
  smashRule,
  attackAngleRule,
  lowPointRule,
  impactLocationRule,
  mishitRateRule,
  faceToPathRule,
  pathRule,
  faceConsistencyRule,
  spinWindowRule,
  carryConsistencyRule,
  dynamicLoftConsistencyRule,
  launchWindowRule,
  spinConsistencyRule,
  lateralDispersionRule,
  speedAdjustedEfficiencyRule,
];

/**
 * Total strokes on the table, without double counting.
 *
 * A naive sum is badly wrong in two directions at once. Symptoms would be
 * counted alongside the root causes that already explain them, and the same
 * swing fault showing up on four clubs would be counted four times — a test
 * session with a scattered strike across the bag totalled 21.5 shots a round,
 * which is not a number anyone should be shown.
 *
 * So: symptoms are excluded, since their cost is already carried by the cause.
 * And among root causes, findings of the *same kind* on different clubs are
 * treated as one problem seen from several angles: the largest counts in
 * full, and each additional one adds only a fraction, because fixing a
 * wandering strike fixes it for every club at once rather than one club at a
 * time.
 */
export function estimateStrokesAvailable(priorities: Prioritised[]): number {
  const roots = priorities.filter((p) => p.explainedBy === null);

  const byKind = new Map<string, number[]>();
  for (const entry of roots) {
    const list = byKind.get(entry.finding.id) ?? [];
    list.push(entry.impact.courseStrokes);
    byKind.set(entry.finding.id, list);
  }

  let total = 0;
  for (const costs of byKind.values()) {
    costs.sort((a, b) => b - a);
    costs.forEach((cost, i) => {
      // The first club counts fully; further clubs are largely the same fault.
      total += i === 0 ? cost : cost * 0.35;
    });
  }
  return total;
}

/**
 * Notes about the measurement rather than the golf.
 *
 * Things that change how much weight the numbers deserve, and which the
 * player cannot see from the figures themselves — estimated spin is a model
 * output, and altitude-normalised carries are not sea-level carries.
 */
function dataNotes(session: ShotSession): string[] {
  const notes: string[] = [];
  const shots = session.shots;
  if (shots.length === 0) return notes;

  const withSpinFlag = shots.filter((s) => s.spinMeasured !== null);
  const estimated = withSpinFlag.filter((s) => s.spinMeasured === false).length;
  if (withSpinFlag.length > 0 && estimated / withSpinFlag.length > 0.5) {
    notes.push(
      `Spin was estimated rather than measured on ${estimated} of ${withSpinFlag.length} shots. ` +
      `Estimated spin is a model output, so treat the spin findings as indicative and the ` +
      `strike and direction findings as solid.`,
    );
  }

  const excluded = shots.filter((s) => s.flags.includes('mishit')).length;
  if (excluded > 0) {
    notes.push(
      `${excluded} shot${excluded === 1 ? ' was' : 's were'} well outside your normal pattern ` +
      `and ${excluded === 1 ? 'is' : 'are'} excluded from the medians, but still counted in how ` +
      `often a bad one shows up.`,
    );
  }

  return notes;
}

/** Findings are unique per rule *and* club, so both belong in the key. */
export function findingKey(finding: Finding): string {
  return `${finding.id}::${finding.club ?? 'bag'}`;
}

export interface SessionReport {
  sessionId: string;
  /** What the player was doing, which changes how the numbers are read. */
  kind: SessionKind;
  /** The TrackMan mode this session came from, where it is unambiguous. */
  mode: PracticeMode | null;
  shotCount: number;
  usableShotCount: number;
  clubsSeen: Club[];
  profiles: ClubProfile[];
  /** Ordered by estimated impact, most worth doing first. */
  findings: Finding[];
  /** Impact estimate per finding, keyed by finding id + club. */
  impacts: Map<string, Impact>;
  /**
   * Findings with their causal structure attached, in the order they should
   * be worked on. Root causes first, with the symptoms they explain directly
   * beneath them.
   */
  priorities: Prioritised[];
  /** Estimated strokes per round available across every finding. */
  strokesAvailable: number;
  /** Deduplicated drills for the findings above, in the same priority order. */
  practicePlan: PracticeItem[];
  /** A full session laid out in TrackMan practice modes, ready to run. */
  practice: PracticeSession;

  /** Where the ball started and which way it bent, across the session. */
  shape: ShapeBreakdown;
  /** How each shot was struck, judged against this player's own baseline. */
  strike: StrikeBreakdown;
  /** Repeatability per metric for the most-hit club. */
  consistency: ClubConsistency | null;
  /** Whether the session improved, faded, or held. */
  progression: Progression;
  /** The gap between the player's best golf and their normal golf. */
  potential: Potential | null;
  /** Notes about the data itself, rather than the golf. */
  dataNotes: string[];
}

export interface PracticeItem {
  drill: Drill;
  /** Which findings this drill addresses, by finding id. */
  addresses: string[];
  /** Position in the session; 1 is first. */
  order: number;
}

export interface DiagnoseOptions {
  /** Which bay slot the practice plan should fill. Defaults to one hour. */
  practiceDuration?: PracticeDuration;
  /**
   * Hide findings the sample is too small to support. On by default —
   * a confident-sounding diagnosis from four shots is the fastest way to
   * lose a user's trust permanently.
   */
  hideLowConfidence?: boolean;
  /** Cap the plan so a session has a realistic amount of work in it. */
  maxDrills?: number;
}

/**
 * Run the full pipeline over one session.
 *
 * Mutates `session.shots` to attach outlier flags, then derives everything
 * else from the flagged shots.
 */
export function diagnoseSession(
  session: ShotSession,
  opts: DiagnoseOptions = {},
): SessionReport {
  const { hideLowConfidence = true, maxDrills = 4, practiceDuration = 60 } = opts;

  markImplausible(session.shots);
  markMishits(session.shots);

  const profiles = buildClubProfiles(session.shots);
  const findings: Finding[] = [];

  for (const profile of profiles) {
    for (const rule of PER_CLUB_RULES) {
      if (profile.representativeCount < rule.minShots && profile.shotCount < rule.minShots) continue;
      findings.push(...rule.run({ profile, allProfiles: profiles }));
    }
  }

  findings.push(...gappingFindings(profiles));

  // Target rules read shots rather than club profiles: in a Combine the
  // interesting pattern runs across distances, not within one club.
  findings.push(...distanceBiasFindings(session.shots));
  findings.push(...weakDistanceFindings(session.shots));

  const visible = hideLowConfidence
    ? findings.filter((f) => f.confidence !== 'low' || f.severity === 'major')
    : findings;

  const priorities = prioritise(visible);
  const ranked = priorities.map((p) => p.finding);
  const impacts = new Map<string, Impact>();
  for (const finding of ranked) impacts.set(findingKey(finding), impactOf(finding));

  /*
   * Practice is built from root causes only.
   *
   * A symptom already has a block — the one that fixes its cause. Giving it
   * its own block would spend the session practising the same fault twice
   * and crowd out work that is actually independent, which is the opposite
   * of the fastest route to improvement.
   */
  const rootFindings = priorities.filter((p) => p.explainedBy === null).map((p) => p.finding);

  // The club with the most shots carries the session-level analyses; running
  // them per club would bury the reading in a session that is mostly one club.
  const mainProfile = [...profiles].sort((a, b) => b.shotCount - a.shotCount)[0] ?? null;

  return {
    sessionId: session.id,
    kind: session.kind,
    mode: modeForKind(session.kind),
    shotCount: session.shots.length,
    usableShotCount: session.shots.filter((s) => !s.flags.includes('implausible')).length,
    clubsSeen: profiles.map((p) => p.club),
    profiles,
    findings: ranked,
    impacts,
    priorities,
    strokesAvailable: estimateStrokesAvailable(priorities),
    shape: shapeBreakdown(session.shots),
    strike: classifyStrikes(session.shots),
    consistency: mainProfile ? clubConsistency(mainProfile) : null,
    progression: sessionProgression(session.shots),
    potential: mainProfile ? potential(session.shots.filter((s) => s.club === mainProfile.club)) : null,
    dataNotes: dataNotes(session),
    practicePlan: buildPracticePlan(rootFindings, maxDrills),
    practice: prescribePractice(rootFindings, profiles, { duration: practiceDuration }),
  };
}

/**
 * Turn findings into a practice session.
 *
 * A drill earns its place by the highest-priority finding that calls for it,
 * and each drill appears once no matter how many findings recommend it — a
 * plan that says "face spray drill" four times is a worse plan, not a more
 * emphatic one.
 */
export function buildPracticePlan(orderedFindings: Finding[], maxDrills: number): PracticeItem[] {
  const chosen = new Map<string, string[]>();

  for (const finding of orderedFindings) {
    for (const drillId of finding.drills) {
      if (!DRILLS[drillId]) continue;
      const existing = chosen.get(drillId);
      if (existing) existing.push(finding.id);
      else if (chosen.size < maxDrills) chosen.set(drillId, [finding.id]);
    }
  }

  return [...chosen.entries()].map(([drillId, addresses], i) => ({
    drill: DRILLS[drillId] as Drill,
    addresses,
    order: i + 1,
  }));
}

/** Convenience: diagnose a bare list of shots without a session wrapper. */
export function diagnoseShots(shots: Shot[], opts?: DiagnoseOptions): SessionReport {
  return diagnoseSession(
    {
      id: 'ad-hoc',
      source: shots[0]?.source ?? 'manual',
      kind: 'range',
      sourceRef: 'ad-hoc',
      handedness: 'right',
      startedAt: shots[0]?.time ?? null,
      shots,
    },
    opts,
  );
}
