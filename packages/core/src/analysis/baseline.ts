import type { Club, ShotSession } from '../schema.js';
import { buildClubProfiles } from '../stats/dispersion.js';
import { median } from '../stats/robust.js';

/**
 * The player, rather than the session.
 *
 * A single session is a small sample of a golfer. Club speed in particular
 * moves with how warm you are, how tired you are and whether you are trying to
 * hit it hard — swings of three or four miles an hour between two ordinary
 * sessions are completely normal. Deriving optimal targets from one afternoon
 * means the targets move every time you import, which makes them useless as
 * something to work towards: you can appear to have hit your spin target
 * because you swung slower, not because you delivered the club better.
 *
 * So anything that should describe *the player* is taken across their recent
 * sessions instead. Five is the window: enough to average out a bad day,
 * short enough that a genuine speed gain shows up within a month or so of
 * regular practice rather than being buried under a year of history.
 *
 * The median across sessions, not the mean — one session where a launch
 * monitor misread the club or the player was messing about with a driver
 * should not drag the baseline.
 */

/** How many recent sessions a baseline is built from. */
export const BASELINE_SESSIONS = 5;

export interface ClubBaseline {
  club: Club;
  /** Median of the per-session median club speeds, mph. */
  clubSpeed: number;
  /** Median of the per-session median carries, yards. */
  carry: number;
  /** How many sessions contributed. */
  sessions: number;
  /** Total representative shots behind it. */
  shots: number;
}

export interface PlayerBaseline {
  /** Sessions actually used, newest first. */
  sessionIds: string[];
  from: Date | null;
  to: Date | null;
  clubs: ClubBaseline[];
}

function byDateDesc(sessions: ShotSession[]): ShotSession[] {
  return [...sessions].sort((a, b) => {
    const at = a.startedAt?.getTime() ?? -Infinity;
    const bt = b.startedAt?.getTime() ?? -Infinity;
    return bt - at;
  });
}

/**
 * Build a baseline from the most recent sessions.
 *
 * `upTo` exists so that looking at an older session in the history shows the
 * targets that applied *then*, rather than judging a session from March
 * against a swing speed measured in September.
 */
export function buildBaseline(
  sessions: ShotSession[],
  opts: { window?: number; upTo?: Date | null } = {},
): PlayerBaseline {
  const { window = BASELINE_SESSIONS, upTo = null } = opts;

  const eligible = byDateDesc(sessions).filter((s) => {
    if (!upTo) return true;
    if (!s.startedAt) return true;
    return s.startedAt.getTime() <= upTo.getTime();
  });
  const recent = eligible.slice(0, window);

  const speeds = new Map<Club, number[]>();
  const carries = new Map<Club, number[]>();
  const counts = new Map<Club, number>();
  const seen = new Map<Club, number>();

  for (const session of recent) {
    // Profiles are rebuilt per session rather than pooled, so a session with
    // eighty shots does not outvote four sessions with twenty.
    for (const profile of buildClubProfiles(session.shots)) {
      if (profile.representativeCount < 4) continue;
      if (Number.isFinite(profile.clubSpeed.median)) {
        const list = speeds.get(profile.club) ?? [];
        list.push(profile.clubSpeed.median);
        speeds.set(profile.club, list);
      }
      if (Number.isFinite(profile.carry.median)) {
        const list = carries.get(profile.club) ?? [];
        list.push(profile.carry.median);
        carries.set(profile.club, list);
      }
      counts.set(profile.club, (counts.get(profile.club) ?? 0) + profile.representativeCount);
      seen.set(profile.club, (seen.get(profile.club) ?? 0) + 1);
    }
  }

  const clubs: ClubBaseline[] = [];
  for (const [club, list] of speeds) {
    clubs.push({
      club,
      clubSpeed: median(list),
      carry: median(carries.get(club) ?? []),
      sessions: seen.get(club) ?? 0,
      shots: counts.get(club) ?? 0,
    });
  }

  const dates = recent.map((s) => s.startedAt).filter((d): d is Date => d !== null);
  return {
    sessionIds: recent.map((s) => s.id),
    from: dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
    to: dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null,
    clubs,
  };
}

export function baselineFor(baseline: PlayerBaseline | null, club: Club): ClubBaseline | null {
  return baseline?.clubs.find((c) => c.club === club) ?? null;
}
