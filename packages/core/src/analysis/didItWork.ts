import type { Club, ShotSession } from '../schema.js';
import { buildClubProfiles, type ClubProfile } from '../stats/dispersion.js';
import { markImplausible, markMishits } from '../stats/outliers.js';

/**
 * Did the last session's work actually change anything?
 *
 * The question almost no launch monitor tool answers. They all measure you,
 * most will tell you what to practise, and then the loop is left open — you
 * do the drill, you come back, and nothing connects the two. So a player
 * never finds out whether the thing they spent an hour on moved, which is the
 * only feedback that makes practice feel worth repeating.
 *
 * Compares the same club across two sessions and reports what moved, in the
 * direction that counts for each metric. Deliberately blunt about the limits:
 * two sessions are two samples, conditions differ, and a change smaller than
 * the player's own shot-to-shot spread is not a change at all.
 */

export interface MetricDelta {
  metric: string;
  label: string;
  unit: string;
  previous: number;
  current: number;
  /** Signed change in the metric's own unit. */
  change: number;
  /** True when the change is larger than the noise it has to clear. */
  meaningful: boolean;
  improved: boolean;
  direction: 'higher-better' | 'lower-better' | 'toward-zero';
}

export interface SessionComparison {
  club: Club;
  previousDate: Date | null;
  currentDate: Date | null;
  deltas: MetricDelta[];
  /** Only the deltas that cleared the noise floor, best news first. */
  meaningful: MetricDelta[];
  headline: string;
}

interface Spec {
  label: string;
  unit: string;
  direction: MetricDelta['direction'];
  /** Change below this is noise, in the metric's own unit. */
  floor: number;
  read: (p: ClubProfile) => { value: number; n: number };
}

const SPECS: Record<string, Spec> = {
  carry: {
    label: 'Carry', unit: 'yds', direction: 'higher-better', floor: 4,
    read: (p) => ({ value: p.carry.median, n: p.carry.n }),
  },
  carrySpread: {
    label: 'Carry spread', unit: 'yds', direction: 'lower-better', floor: 2,
    read: (p) => ({ value: p.carry.mad, n: p.carry.n }),
  },
  smashFactor: {
    label: 'Strike efficiency', unit: '', direction: 'higher-better', floor: 0.02,
    read: (p) => ({ value: p.smashFactor.median, n: p.smashFactor.n }),
  },
  faceToPath: {
    label: 'Face to path', unit: '°', direction: 'toward-zero', floor: 1,
    read: (p) => ({ value: p.faceToPath.median, n: p.faceToPath.n }),
  },
  faceSpread: {
    label: 'Face control', unit: '°', direction: 'lower-better', floor: 0.6,
    read: (p) => ({ value: p.faceAngle.mad, n: p.faceAngle.n }),
  },
  clubPath: {
    label: 'Club path', unit: '°', direction: 'toward-zero', floor: 1,
    read: (p) => ({ value: p.clubPath.median, n: p.clubPath.n }),
  },
  lowPointSpread: {
    label: 'Low point control', unit: 'in', direction: 'lower-better', floor: 0.7,
    read: (p) => ({ value: p.lowPointDistance.mad, n: p.lowPointDistance.n }),
  },
  dynamicLoftSpread: {
    label: 'Loft control', unit: '°', direction: 'lower-better', floor: 0.8,
    read: (p) => ({ value: p.dynamicLoft.mad, n: p.dynamicLoft.n }),
  },
};

function improvedBy(direction: MetricDelta['direction'], prev: number, curr: number): boolean {
  switch (direction) {
    case 'higher-better': return curr > prev;
    case 'lower-better': return curr < prev;
    case 'toward-zero': return Math.abs(curr) < Math.abs(prev);
  }
}

/** Profile one club from one session without mutating the stored shots. */
function profileFor(session: ShotSession, club: Club): ClubProfile | null {
  const shots = session.shots.filter((s) => s.club === club).map((s) => ({ ...s, flags: [] }));
  if (shots.length < 6) return null;
  markImplausible(shots);
  markMishits(shots);
  return buildClubProfiles(shots)[0] ?? null;
}

export function compareSessions(
  previous: ShotSession,
  current: ShotSession,
  club: Club,
): SessionComparison | null {
  const before = profileFor(previous, club);
  const after = profileFor(current, club);
  if (!before || !after) return null;

  const deltas: MetricDelta[] = [];
  for (const [metric, spec] of Object.entries(SPECS)) {
    const p = spec.read(before);
    const c = spec.read(after);
    if (p.n < 6 || c.n < 6 || !Number.isFinite(p.value) || !Number.isFinite(c.value)) continue;

    const change = c.value - p.value;
    deltas.push({
      metric,
      label: spec.label,
      unit: spec.unit,
      previous: p.value,
      current: c.value,
      change,
      meaningful: Math.abs(change) >= spec.floor,
      improved: improvedBy(spec.direction, p.value, c.value),
      direction: spec.direction,
    });
  }

  const meaningful = deltas
    .filter((d) => d.meaningful)
    .sort((a, b) => Number(b.improved) - Number(a.improved));

  const gains = meaningful.filter((d) => d.improved).length;
  const losses = meaningful.length - gains;

  let headline: string;
  if (meaningful.length === 0) {
    headline = `Nothing moved further than your normal shot-to-shot variation. Two sessions is a small sample — that is not the same as nothing having changed.`;
  } else if (gains > 0 && losses === 0) {
    headline = `${gains} thing${gains === 1 ? '' : 's'} moved the right way since last time.`;
  } else if (gains === 0) {
    headline = `${losses} thing${losses === 1 ? '' : 's'} went backwards since last time. Worth knowing before you repeat the same practice.`;
  } else {
    headline = `${gains} better, ${losses} worse. Mixed sessions usually mean a change is still bedding in rather than that it failed.`;
  }

  return {
    club,
    previousDate: previous.startedAt,
    currentDate: current.startedAt,
    deltas,
    meaningful,
    headline,
  };
}

/**
 * The session immediately before this one that shares its main club.
 *
 * Undated sessions cannot be ordered, so they are skipped rather than
 * assumed to be in import order — comparing against the wrong session is
 * worse than not comparing.
 */
export function previousSessionFor(
  sessions: ShotSession[],
  current: ShotSession,
  club: Club,
): ShotSession | null {
  const currentTime = current.startedAt?.getTime();
  if (currentTime === undefined) return null;

  return (
    sessions
      .filter((s) => s.id !== current.id && s.startedAt !== null)
      .filter((s) => (s.startedAt as Date).getTime() < currentTime)
      .filter((s) => s.shots.filter((shot) => shot.club === club).length >= 6)
      .sort((a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime())[0] ?? null
  );
}
