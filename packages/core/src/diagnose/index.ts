import type { Club, SessionKind, Shot, ShotSession } from '../schema.js';
import { modeForKind, type PracticeMode } from '../practice/modes.js';
import {
  compareToOptimal, personalOptimals, type OptimalComparison,
} from '../benchmarks/personal.js';
import { prescribePractice, type PracticeDuration, type PracticeSession } from '../practice/prescribe.js';
import {
  badStrikes, discarded, markImplausible, markMishits, markUnusable, unreadable,
} from '../stats/outliers.js';
import {
  estimateHandicapAcrossBag, evaluateAchievements, scoreSession,
  type Achievement, type HandicapEstimate, type SessionScore,
} from '../scoring/index.js';
import { buildClubProfiles, type ClubProfile } from '../stats/dispersion.js';
import { greenHoldRate } from '../benchmarks/skill.js';
import { buildYardageBook, type YardageBook } from '../analysis/yardagebook.js';
import { carryFactor, NO_CONDITIONS, type Conditions } from '../benchmarks/conditions.js';
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
  baselineFor, classifyStrikes, clubConsistency, potential, sessionProgression, shapeBreakdown,
  type ClubConsistency, type PlayerBaseline, type Potential, type Progression,
  type ShapeBreakdown, type StrikeBreakdown,
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
 * Your measured medians against your own speed-adjusted targets.
 *
 * Built for the most-hit club only. A page of targets for a club hit three
 * times is noise, and the comparison is only as good as the median behind it.
 */
function buildOptimals(
  profile: ClubProfile | null,
  baseline: PlayerBaseline | null,
  conditions: Conditions,
): SessionReport['optimals'] {
  if (!profile || profile.clubSpeed.n < 5 || !Number.isFinite(profile.clubSpeed.median)) {
    return null;
  }

  /*
   * Targets come from the player's *rolling* club speed, not today's.
   *
   * Club speed swings three or four mph between ordinary sessions with
   * warmth, fatigue and effort. Rebuilding the targets from one afternoon
   * means they move under the player every time they import, and a spin
   * number can appear to come on target because the swing was slower rather
   * than because the delivery improved. A baseline over the recent sessions
   * holds still enough to aim at while still moving when speed genuinely
   * changes.
   */
  const base = baselineFor(baseline, profile.club);
  const speed = base && base.sessions >= 2 ? base.clubSpeed : profile.clubSpeed.median;
  const optimals = personalOptimals(profile.club, speed);
  if (!optimals) return null;

  /*
   * Carry targets are expressed in the air the player is actually hitting in.
   *
   * The tour tables are a sea-level frame; the export states its own. At 4,700
   * feet the ball carries six percent further, so an uncorrected comparison
   * told this player they were five yards long when at sea level they are
   * eight yards short — a systematic error of thirteen yards, larger than the
   * band it was being judged against.
   *
   * Only carry moves. Ball speed, launch, spin and attack angle are measured
   * at or near impact and do not care about the air the ball then flies
   * through, so inflating those would invent an error rather than remove one.
   */
  const factor = carryFactor(conditions);
  const windows = optimals.windows.map((w) => (
    w.metric === 'carry' && factor !== 1
      ? {
        ...w,
        target: w.target * factor,
        min: w.min * factor,
        max: w.max * factor,
        why: `${w.why} Scaled by ${((factor - 1) * 100).toFixed(1)}% for the ` +
          `${Math.round(conditions.altitudeFeet ?? 0).toLocaleString()} ft air your ` +
          `numbers are normalised to, so this is the carry to aim at in your bay.`,
      }
      : w
  ));

  const actual: Record<string, number> = {
    attackAngle: profile.attackAngle.median,
    smashFactor: profile.smashFactor.median,
    launchAngle: profile.launchAngle.median,
    spinRate: profile.spinRate.median,
    ballSpeed: profile.ballSpeed.median,
    carry: profile.carry.median,
  };

  return {
    club: profile.club,
    clubSpeed: optimals.clubSpeed,
    tourClubSpeed: optimals.tourClubSpeed,
    speedBasis: base && base.sessions >= 2
      ? { sessions: base.sessions, sessionSpeed: profile.clubSpeed.median }
      : null,
    comparisons: windows.map((w) => compareToOptimal(w, actual[w.metric] ?? Number.NaN)),
  };
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

  const unread = shots.filter(
    (s) => s.flags.includes('implausible') && !s.flags.includes('unusable'),
  ).length;
  if (unread > 0) {
    notes.push(
      `${unread} row${unread === 1 ? '' : 's'} carried numbers that cannot be true and ` +
      `${unread === 1 ? 'was' : 'were'} dropped. That is the launch monitor misreading a shot, ` +
      `not a shot you hit badly, so it does not count against your reliability score.`,
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
  /** The air these numbers were normalised to, and what it does to carry. */
  conditions: Conditions;
  /**
   * Shots thrown out entirely — tops and shanks that travel a fraction of the
   * club's normal distance. Reported as a count so nothing is hidden, but
   * excluded from every statistic, because a topped 7-iron is not a data
   * point about the player's 7-iron.
   */
  discardedCount: number;
  /** Rows the launch monitor could not read. Not the player's fault, and not scored. */
  unreadableCount: number;
  /** How the session scored, and what dragged it down. */
  score: SessionScore | null;
  /**
   * How often this pattern would hold an average green from its own carry
   * distance, off a flat lie with no wind. A ceiling rather than a
   * greens-in-regulation prediction — see `benchmarks/skill.ts`.
   */
  greenRate: number | null;
  /** Thresholds crossed this session, and what is nearly in reach. */
  achievements: Achievement[];
  /**
   * What to do with each club on the course: the carry to club off, where to
   * aim, and how much room to leave. The only part of this report that is
   * usable standing over a ball rather than standing on a range.
   */
  yardageBook: YardageBook;
  /**
   * The handicap this player's ball-striking would support. Ball-striking
   * only — a range session cannot see the short game, which is most of
   * scoring — so it is a range with the caveat attached.
   */
  handicap: HandicapEstimate | null;
  /**
   * Your numbers against your own optimals — the tour figures scaled to your
   * measured club speed, so the targets are ones you can actually reach.
   */
  optimals: {
    club: Club;
    /** The speed the targets were built for — rolling, where history allows. */
    clubSpeed: number;
    tourClubSpeed: number;
    /**
     * Set when the targets came from a multi-session baseline rather than
     * this session alone, so the UI can say so and show today's speed too.
     */
    speedBasis: { sessions: number; sessionSpeed: number } | null;
    comparisons: OptimalComparison[];
  } | null;
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
   * The player's rolling averages across recent sessions. Supplying it makes
   * the optimal targets stable between imports; without it they are derived
   * from this session alone, which is noticeably noisier.
   */
  baseline?: PlayerBaseline | null;
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
  const {
    hideLowConfidence = true, maxDrills = 4, practiceDuration = 60, baseline = null,
  } = opts;

  markImplausible(session.shots);
  markUnusable(session.shots);
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

  // Computed before the report literal because the practice plan needs them:
  // its pass marks are set from the session's own strike and blow-up figures.
  const strike = classifyStrikes(session.shots);
  const discardedShots = discarded(session.shots);
  const wasted = badStrikes(session.shots);
  const unreadableShots = unreadable(session.shots);
  const unusableRate = session.shots.length > 0
    ? (wasted.length / session.shots.length) * 100
    : null;

  const report: SessionReport = {
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
    strike,
    consistency: mainProfile ? clubConsistency(mainProfile) : null,
    progression: sessionProgression(session.shots),
    potential: mainProfile ? potential(session.shots.filter((s) => s.club === mainProfile.club)) : null,
    dataNotes: dataNotes(session),
    conditions: session.conditions ?? NO_CONDITIONS,
    yardageBook: buildYardageBook(session.shots, session.conditions),
    optimals: buildOptimals(mainProfile, baseline, session.conditions ?? NO_CONDITIONS),
    discardedCount: discardedShots.length,
    unreadableCount: unreadableShots.length,
    score: null,
    greenRate: null,
    achievements: [],
    handicap: null,
    practicePlan: buildPracticePlan(rootFindings, maxDrills),
    practice: prescribePractice(rootFindings, profiles, {
      duration: practiceDuration,
      strikeQuality: strike.total >= 10 ? strike.qualityShare * 100 : null,
      unusableRate,
    }),
  };

  /*
   * Scoring runs last because it reads the assembled report — the strike
   * breakdown, the consistency scores and the optimal comparisons all have to
   * exist before a session can be graded on them.
   */
  report.score = scoreSession({
    profile: mainProfile,
    strike: report.strike,
    consistency: report.consistency,
    optimals: report.optimals?.comparisons ?? null,
    discarded: wasted.length,
    shotCount: report.shotCount,
    allProfiles: profiles,
  });
  /*
   * Handicap before achievements, not after.
   *
   * Two milestones read `report.handicap`, and with the assignments the other
   * way round it was still null when they were measured — so Single Figures
   * and Scratch Striker could never be earned by anybody, silently, because a
   * measure returning null is treated as "not applicable to this session"
   * rather than as an error.
   */
  report.handicap = estimateHandicapAcrossBag(profiles, report.strike);
  /*
   * Green rate across every club with enough shots, weighted the same way.
   * A bag session's answer to "how often would this hold a green" is not the
   * 7-iron's answer.
   */
  const greenParts = profiles
    .filter((p) => p.representativeCount >= 6 && Number.isFinite(p.carry.median))
    .map((p) => ({
      n: p.representativeCount,
      rate: greenHoldRate({ sigmaSide: p.side.mad, sigmaCarry: p.carry.mad, carry: p.carry.median }),
    }))
    .filter((x) => Number.isFinite(x.rate));
  const greenWeight = greenParts.reduce((sum, x) => sum + x.n, 0);
  report.greenRate = greenWeight > 0
    ? greenParts.reduce((sum, x) => sum + x.rate * x.n, 0) / greenWeight
    : null;
  report.achievements = evaluateAchievements(report);

  return report;
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
      conditions: NO_CONDITIONS,
      sourceRef: 'ad-hoc',
      handedness: 'right',
      startedAt: shots[0]?.time ?? null,
      shots,
    },
    opts,
  );
}
