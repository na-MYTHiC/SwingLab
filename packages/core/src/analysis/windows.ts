import type { Club, ShotSession, Shot } from '../schema.js';
import { toReferenceFrame } from '../benchmarks/conditions.js';
import { buildClubProfile, type ClubProfile } from '../stats/dispersion.js';
import { markImplausible, markMishits, markUnusable } from '../stats/outliers.js';
import { median } from '../stats/robust.js';

/**
 * The same club, over different amounts of history.
 *
 * A session is a small sample of a golfer, and a single one cannot separate
 * "today was bad" from "I have got worse" — which is the question a player
 * actually has after a poor afternoon. Looking at the same measurement over
 * the last twenty shots, the last fifty, the last month and everything on
 * record answers it: if the recent window is worse than the long one, today
 * was bad; if they agree, something has changed.
 *
 * Every window is built from shots normalised into a common atmosphere, so a
 * window spanning two venues measures the player rather than the altitude.
 *
 * The windows deliberately overlap and are deliberately few. A player does not
 * need eleven of them, and a chart with eleven overlapping series is a chart
 * nobody reads.
 */

export type WindowId = 'last10' | 'last20' | 'last50' | 'days30' | 'lifetime';

export interface ShotWindow {
  id: WindowId;
  label: string;
  /** Null for the shot-count windows, which do not care about dates. */
  days: number | null;
  /** Null for the date windows, which do not care about counts. */
  shots: number | null;
}

export const WINDOWS: ShotWindow[] = [
  { id: 'last10', label: 'Last 10', days: null, shots: 10 },
  { id: 'last20', label: 'Last 20', days: null, shots: 20 },
  { id: 'last50', label: 'Last 50', days: null, shots: 50 },
  { id: 'days30', label: '30 days', days: 30, shots: null },
  { id: 'lifetime', label: 'All time', days: null, shots: null },
];

export interface WindowProfile {
  window: ShotWindow;
  profile: ClubProfile | null;
  /** How many sessions contributed. */
  sessions: number;
}

/**
 * Every shot of one club across a history, newest first, in a common air.
 *
 * Sessions with no timestamp sort to the end rather than being dropped: an
 * undated import is still the player's golf, it just cannot join a date
 * window.
 */
function timeline(sessions: ShotSession[], club: Club): { shot: Shot; at: number | null }[] {
  const rows: { shot: Shot; at: number | null }[] = [];
  for (const session of sessions) {
    const shots = toReferenceFrame(
      session.shots.filter((s) => s.club === club).map((s) => ({ ...s, flags: [] })),
      session.conditions,
    );
    const at = session.startedAt?.getTime() ?? null;
    // Within a session, a shot's own timestamp orders it; failing that its
    // position in the file does.
    shots.forEach((shot, i) => {
      rows.push({ shot, at: shot.time?.getTime() ?? (at === null ? null : at + i * 1000) });
    });
  }
  return rows.sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity));
}

function profileOf(club: Club, shots: Shot[]): ClubProfile | null {
  if (shots.length < 6) return null;
  const copy = shots.map((s) => ({ ...s, flags: [] as Shot['flags'] }));
  markImplausible(copy);
  markUnusable(copy);
  markMishits(copy);
  return buildClubProfile(club, copy);
}

export function buildWindows(
  sessions: ShotSession[],
  club: Club,
  now = new Date(),
): WindowProfile[] {
  const rows = timeline(sessions, club);
  const cutoff = now.getTime() - 30 * 86_400_000;

  return WINDOWS.map((window) => {
    let picked = rows;
    if (window.shots !== null) picked = rows.slice(0, window.shots);
    else if (window.days !== null) picked = rows.filter((r) => r.at !== null && r.at >= cutoff);

    const shots = picked.map((r) => r.shot);
    const sessionsIn = new Set(
      shots.map((s) => s.source + (s.time?.toDateString() ?? '')),
    ).size;
    return { window, profile: profileOf(club, shots), sessions: sessionsIn };
  });
}

/** Which clubs have enough history for a window view to say anything. */
export function windowableClubs(sessions: ShotSession[], minShots = 12): Club[] {
  const counts = new Map<Club, number>();
  for (const session of sessions) {
    for (const shot of session.shots) {
      counts.set(shot.club, (counts.get(shot.club) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n >= minShots).map(([club]) => club);
}

/**
 * Is the recent form better or worse than the long-run form?
 *
 * The one comparison the windows exist to support, stated in the direction the
 * player asks it: not "what is my carry spread" but "is this a bad day or a
 * new normal". A gap smaller than the noise floor is reported as neither.
 */
export interface FormRead {
  metric: string;
  label: string;
  unit: string;
  recent: number;
  baseline: number;
  /** Negative when the recent window is tighter, for spread metrics. */
  change: number;
  verdict: 'sharper' | 'flat' | 'rusty';
  detail: string;
}

const FORM: {
  metric: string; label: string; unit: string; dp: number; lowerBetter: boolean;
  floor: number; read: (p: ClubProfile) => number;
}[] = [
  {
    metric: 'carry', label: 'Carry', unit: 'yds', dp: 0, lowerBetter: false, floor: 4,
    read: (p) => p.carry.median,
  },
  {
    metric: 'carrySpread', label: 'Distance control', unit: 'yds', dp: 1, lowerBetter: true,
    floor: 1.5, read: (p) => p.carry.mad,
  },
  {
    metric: 'sideSpread', label: 'Direction', unit: 'yds', dp: 1, lowerBetter: true,
    floor: 2, read: (p) => p.side.mad,
  },
  {
    metric: 'smash', label: 'Strike efficiency', unit: '', dp: 3, lowerBetter: false,
    floor: 0.012, read: (p) => p.smashFactor.median,
  },
];

export function readForm(windows: WindowProfile[]): FormRead[] {
  const recent = windows.find((w) => w.window.id === 'last20')?.profile;
  const long = windows.find((w) => w.window.id === 'lifetime')?.profile;
  if (!recent || !long) return [];

  const out: FormRead[] = [];
  for (const spec of FORM) {
    const r = spec.read(recent);
    const b = spec.read(long);
    if (!Number.isFinite(r) || !Number.isFinite(b)) continue;

    const change = r - b;
    const moved = Math.abs(change) >= spec.floor;
    const better = spec.lowerBetter ? change < 0 : change > 0;
    const verdict: FormRead['verdict'] = !moved ? 'flat' : better ? 'sharper' : 'rusty';

    out.push({
      metric: spec.metric,
      label: spec.label,
      unit: spec.unit,
      recent: round(r, spec.dp),
      baseline: round(b, spec.dp),
      change: round(change, spec.dp),
      verdict,
      detail: verdict === 'flat'
        ? `Your last twenty match your long-run ${round(b, spec.dp)}${spec.unit}.`
        : `Last twenty at ${round(r, spec.dp)}${spec.unit} against ${round(b, spec.dp)}` +
          `${spec.unit} all time — ${better ? 'sharper than usual' : 'off your normal'}.`,
    });
  }
  return out;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * TrackMan's own verdict on the same shots.
 *
 * The unit grades every shot against its internal optimal model and puts the
 * result in the export as a percentage. Kept beside our own numbers rather
 * than blended into them: two models that disagree are more informative than
 * one average that hides the disagreement, and where they agree that is worth
 * more than either alone.
 */
export interface TrackManIndices {
  smashIndex: number | null;
  spinIndex: number | null;
  smashCount: number;
  spinCount: number;
}

export function trackManIndices(shots: Shot[]): TrackManIndices {
  const smash = shots.map((s) => s.smashIndex).filter((v): v is number => v !== null);
  const spin = shots.map((s) => s.spinIndex).filter((v): v is number => v !== null);
  return {
    smashIndex: smash.length >= 5 ? median(smash) : null,
    spinIndex: spin.length >= 5 ? median(spin) : null,
    smashCount: smash.length,
    spinCount: spin.length,
  };
}
