import type { Club, ShotSession } from '../schema.js';
import { buildClubProfiles, type ClubProfile } from '../stats/dispersion.js';
import { toReferenceFrame } from '../benchmarks/conditions.js';
import { plural } from '../units.js';
import { markImplausible, markMishits, markUnusable } from '../stats/outliers.js';

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
  /**
   * Better, worse, or not a verdict at all.
   *
   * `null` for metrics that moved without that being good or bad news. Carry
   * is the one that matters: see the `carry` spec below.
   */
  improved: boolean | null;
  direction: 'higher-better' | 'lower-better' | 'toward-zero' | 'context';
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
  /*
   * Carry is reported and deliberately NOT scored.
   *
   * It used to be 'higher-better', so a 7-iron that went six yards further
   * than last week was counted as a win in a card asking whether practice had
   * worked. Nothing else in this app believes that. The yardage book exists to
   * stop players clubbing off their longest one, `potential` tells them they
   * are not missing distance but missing it consistently, and the whole
   * conditions system exists so that thin air is not mistaken for improvement.
   * Six extra yards with a mid-iron between two sessions is usually a harder
   * swing, and a harder swing widens the pattern — which is the opposite of
   * the thing being practised.
   *
   * It stays on the card because it is useful to know the club went further.
   * It just does not get a verdict, and it does not count in the tally.
   */
  carry: {
    label: 'Carry', unit: 'yds', direction: 'context', floor: 4,
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

function improvedBy(
  direction: MetricDelta['direction'],
  prev: number,
  curr: number,
): boolean | null {
  switch (direction) {
    case 'higher-better': return curr > prev;
    case 'lower-better': return curr < prev;
    case 'toward-zero': return Math.abs(curr) < Math.abs(prev);
    case 'context': return null;
  }
}

/** Profile one club from one session without mutating the stored shots. */
function profileFor(session: ShotSession, club: Club): ClubProfile | null {
  // Both sides of the comparison are put into the same air first, or a change
  // of venue reads as a change in the player.
  const shots = toReferenceFrame(
    session.shots.filter((s) => s.club === club).map((s) => ({ ...s, flags: [] })),
    session.conditions,
  );
  if (shots.length < 6) return null;
  markImplausible(shots);
  markUnusable(shots);
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

  /*
   * Wins first, then losses, then the unscored context rows at the bottom —
   * so the card reads as a verdict with the background underneath it, rather
   * than mixing a number that has no verdict into the middle of the list.
   */
  const rank = (d: MetricDelta) => (d.improved === true ? 0 : d.improved === false ? 1 : 2);
  const meaningful = deltas
    .filter((d) => d.meaningful)
    .sort((a, b) => rank(a) - rank(b));

  // Only scored rows count. Carry moving is not a win, and counting it as one
  // turned "2 better, 2 worse" into "3 better, 2 worse".
  const gains = meaningful.filter((d) => d.improved === true).length;
  const losses = meaningful.filter((d) => d.improved === false).length;
  const scored = gains + losses;

  let headline: string;
  if (scored === 0) {
    headline = 'Nothing moved further than your normal shot-to-shot variation. Two sessions is '
      + 'a small sample — that is not the same as nothing having changed.';
  } else if (losses === 0) {
    headline = `${plural(gains, 'thing')} moved the right way since last time.`;
  } else if (gains === 0) {
    headline = `${plural(losses, 'thing')} went backwards since last time. Worth knowing before `
      + 'you repeat the same practice.';
  } else {
    /*
     * No reassurance here that the data does not support. This used to end
     * "mixed sessions usually mean a change is still bedding in rather than
     * that it failed", which assumes the player made a change and then
     * explains away the half that got worse before they have read it.
     */
    headline = `${gains} better, ${losses} worse — so the picture is mixed rather than a `
      + 'verdict either way. Two sessions cannot separate a change that is bedding in from '
      + 'one that is not working; a third will.';
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
