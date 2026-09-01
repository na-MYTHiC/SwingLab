import type { Club, ShotSession } from '../schema.js';
import { toReferenceFrame } from '../benchmarks/conditions.js';
import { buildClubProfiles, type ClubProfile } from './dispersion.js';
import { markImplausible, markMishits, markUnusable } from './outliers.js';
import { median } from './robust.js';

/**
 * Cross-session trends.
 *
 * A single session tells you what happened once. The reason to keep a log at
 * all is the question a session cannot answer: is this actually getting
 * better? That requires comparing like with like, which is harder than it
 * sounds — sessions differ in length, in which clubs were hit, and in what
 * the player was trying to do.
 *
 * The approach here is deliberately conservative. A trend is only reported
 * when there are enough sessions, enough shots in each, and a change large
 * enough to exceed the player's own shot-to-shot noise. Telling someone their
 * club path improved by 0.3° when they vary by 2° between swings is not
 * insight, it is a coin flip with a chart.
 */

export type TrendMetric =
  | 'carry'
  | 'clubSpeed'
  | 'smashFactor'
  | 'faceToPath'
  | 'clubPath'
  | 'attackAngle'
  | 'spinRate'
  | 'carryConsistency'
  | 'strikeConsistency';

export interface TrendPoint {
  sessionId: string;
  date: Date | null;
  value: number;
  /** Shots behind this point, so the UI can weight or hide thin ones. */
  n: number;
}

export interface Trend {
  metric: TrendMetric;
  club: Club;
  label: string;
  unit: string;
  points: TrendPoint[];
  /** Change from the first half of the window to the last, in `unit`. */
  change: number;
  /** Whether the change is large enough to exceed shot-to-shot noise. */
  significant: boolean;
  /**
   * Which way is better for this metric. Some metrics improve as they fall
   * (spread, spin on a driver), some as they rise (carry, smash), and some as
   * they approach zero (path, face to path) — so "up" is not "good".
   */
  direction: 'higher-better' | 'lower-better' | 'toward-zero';
  /** True when the change moved in the good direction. */
  improving: boolean;
}

interface MetricSpec {
  label: string;
  unit: string;
  direction: Trend['direction'];
  /** Smallest change worth reporting, in the metric's own unit. */
  threshold: number;
  read(profile: ClubProfile): { value: number; n: number } | null;
}

const METRICS: Record<TrendMetric, MetricSpec> = {
  carry: {
    label: 'Carry',
    unit: 'yds',
    direction: 'higher-better',
    threshold: 4,
    read: (p) => (p.carry.n >= 4 ? { value: p.carry.median, n: p.carry.n } : null),
  },
  clubSpeed: {
    label: 'Club speed',
    unit: 'mph',
    direction: 'higher-better',
    threshold: 1.5,
    read: (p) => (p.clubSpeed.n >= 4 ? { value: p.clubSpeed.median, n: p.clubSpeed.n } : null),
  },
  smashFactor: {
    label: 'Smash factor',
    unit: '',
    direction: 'higher-better',
    threshold: 0.02,
    read: (p) => (p.smashFactor.n >= 4 ? { value: p.smashFactor.median, n: p.smashFactor.n } : null),
  },
  faceToPath: {
    label: 'Face to path',
    unit: '°',
    direction: 'toward-zero',
    threshold: 1.0,
    read: (p) => (p.faceToPath.n >= 4 ? { value: p.faceToPath.median, n: p.faceToPath.n } : null),
  },
  clubPath: {
    label: 'Club path',
    unit: '°',
    direction: 'toward-zero',
    threshold: 1.0,
    read: (p) => (p.clubPath.n >= 4 ? { value: p.clubPath.median, n: p.clubPath.n } : null),
  },
  attackAngle: {
    label: 'Attack angle',
    unit: '°',
    direction: 'higher-better',
    threshold: 1.0,
    read: (p) => (p.attackAngle.n >= 4 ? { value: p.attackAngle.median, n: p.attackAngle.n } : null),
  },
  spinRate: {
    label: 'Spin rate',
    unit: 'rpm',
    direction: 'lower-better',
    threshold: 300,
    read: (p) => (p.spinRate.n >= 4 ? { value: p.spinRate.median, n: p.spinRate.n } : null),
  },
  carryConsistency: {
    label: 'Carry spread',
    unit: 'yds',
    direction: 'lower-better',
    threshold: 2,
    read: (p) => (p.carry.n >= 6 ? { value: p.carry.mad, n: p.carry.n } : null),
  },
  strikeConsistency: {
    label: 'Strike spread',
    unit: 'mm',
    direction: 'lower-better',
    threshold: 2,
    read: (p) =>
      p.impactOffset.n >= 6 ? { value: p.impactOffset.mad, n: p.impactOffset.n } : null,
  },
};

function isImproving(direction: Trend['direction'], first: number, last: number): boolean {
  switch (direction) {
    case 'higher-better':
      return last > first;
    case 'lower-better':
      return last < first;
    case 'toward-zero':
      return Math.abs(last) < Math.abs(first);
  }
}

/**
 * Build trends across sessions for one club.
 *
 * Sessions are ordered oldest first and compared as halves rather than
 * first-versus-last, so one unusually good or bad day cannot define the
 * trend on its own.
 */
export function buildTrends(
  sessions: ShotSession[],
  club: Club,
  opts: { minSessions?: number } = {},
): Trend[] {
  const { minSessions = 3 } = opts;

  const ordered = [...sessions]
    .filter((s) => s.shots.some((shot) => shot.club === club))
    .sort((a, b) => (a.startedAt?.getTime() ?? 0) - (b.startedAt?.getTime() ?? 0));

  if (ordered.length < minSessions) return [];

  const profiles = ordered.map((session) => {
    // Work on copies: diagnosis attaches flags, and a trend calculation must
    // not mutate stored sessions as a side effect.
    // Into a common air first: a move from a sea-level bay to one at altitude
    // would otherwise read as ten yards of improvement overnight.
    const shots = toReferenceFrame(
      session.shots.filter((s) => s.club === club).map((s) => ({ ...s, flags: [] })),
      session.conditions,
    );
    markImplausible(shots);
    markUnusable(shots);
    markMishits(shots);
    return { session, profile: buildClubProfiles(shots)[0] ?? null };
  });

  const trends: Trend[] = [];

  for (const [metric, spec] of Object.entries(METRICS) as [TrendMetric, MetricSpec][]) {
    const points: TrendPoint[] = [];
    for (const { session, profile } of profiles) {
      if (!profile) continue;
      const read = spec.read(profile);
      if (!read || !Number.isFinite(read.value)) continue;
      points.push({
        sessionId: session.id,
        date: session.startedAt,
        value: read.value,
        n: read.n,
      });
    }

    if (points.length < minSessions) continue;

    const half = Math.floor(points.length / 2);
    const firstHalf = median(points.slice(0, half || 1).map((p) => p.value));
    const lastHalf = median(points.slice(-(half || 1)).map((p) => p.value));
    const change = lastHalf - firstHalf;

    trends.push({
      metric,
      club,
      label: spec.label,
      unit: spec.unit,
      points,
      change,
      significant: Math.abs(change) >= spec.threshold,
      direction: spec.direction,
      improving: isImproving(spec.direction, firstHalf, lastHalf),
    });
  }

  return trends;
}

/** Every club that appears in enough sessions to support a trend. */
export function trendableClubs(sessions: ShotSession[], minSessions = 3): Club[] {
  const counts = new Map<Club, Set<string>>();
  for (const session of sessions) {
    for (const shot of session.shots) {
      const set = counts.get(shot.club) ?? new Set<string>();
      set.add(session.id);
      counts.set(shot.club, set);
    }
  }
  return [...counts.entries()]
    .filter(([club, ids]) => club !== 'unknown' && ids.size >= minSessions)
    .map(([club]) => club);
}
