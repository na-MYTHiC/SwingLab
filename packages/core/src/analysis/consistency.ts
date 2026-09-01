import type { Club } from '../schema.js';
import type { ClubProfile } from '../stats/dispersion.js';
import type { Summary } from '../stats/robust.js';

/**
 * Consistency scorecard.
 *
 * Averages describe what you usually do; spread describes whether you can be
 * relied on to do it. For most amateurs the second question is the one that
 * decides their scores, and it is the one a table of medians hides
 * completely — a player whose face angle averages a perfect 0.0° might be
 * alternating between 5° open and 5° shut.
 *
 * Each metric is scored 0-100 against a band of what "repeatable" looks like
 * for that measurement, so a single number can be read at a glance and the
 * worst one is obvious. The bands are coaching judgement about what a
 * competent amateur holds, not a fitted model — they are for ranking your own
 * metrics against each other, not for comparing you to anyone else.
 */

export interface ConsistencyScore {
  metric: string;
  label: string;
  /** 0-100. Higher is more repeatable. */
  score: number;
  /** The measured spread, in `unit`. */
  spread: number;
  unit: string;
  /** Plain-language read on the score. */
  verdict: 'elite' | 'strong' | 'workable' | 'loose' | 'wild';
  /** What this particular inconsistency costs the player. */
  soWhat: string;
}

interface Band {
  label: string;
  unit: string;
  /** Spread at or below this scores 100. */
  tight: number;
  /** Spread at or above this scores 0. */
  loose: number;
  read: (profile: ClubProfile) => Summary;
  soWhat: string;
}

const BANDS: Record<string, Band> = {
  carry: {
    label: 'Carry distance', unit: 'yds', tight: 3, loose: 14,
    read: (p) => p.carry,
    soWhat: 'Decides whether you can commit to a club and a number.',
  },
  faceAngle: {
    label: 'Face angle', unit: '°', tight: 1.2, loose: 4.5,
    read: (p) => p.faceAngle,
    soWhat: 'Start line is almost all face. This is your directional control.',
  },
  clubPath: {
    label: 'Club path', unit: '°', tight: 1.5, loose: 5,
    read: (p) => p.clubPath,
    soWhat: 'A path that moves changes your shape from swing to swing.',
  },
  lowPointDistance: {
    label: 'Low point', unit: 'in', tight: 1, loose: 4,
    read: (p) => p.lowPointDistance,
    soWhat: 'The difference between flushing it and the occasional thin or fat.',
  },
  dynamicLoft: {
    label: 'Delivered loft', unit: '°', tight: 1.5, loose: 5,
    read: (p) => p.dynamicLoft,
    soWhat: 'Drives both launch and spin, so it drives your distance spread.',
  },
  launchAngle: {
    label: 'Launch angle', unit: '°', tight: 1.2, loose: 4,
    read: (p) => p.launchAngle,
    soWhat: 'A window this wide means the ball flies differently every time.',
  },
  spinRate: {
    label: 'Spin rate', unit: 'rpm', tight: 400, loose: 1600,
    read: (p) => p.spinRate,
    soWhat: 'Changes how far it carries and how hard it stops.',
  },
  smashFactor: {
    label: 'Strike efficiency', unit: '', tight: 0.015, loose: 0.06,
    read: (p) => p.smashFactor,
    soWhat: 'How repeatably you find the middle of the face.',
  },
};

function verdictFor(score: number): ConsistencyScore['verdict'] {
  if (score >= 85) return 'elite';
  if (score >= 68) return 'strong';
  if (score >= 45) return 'workable';
  if (score >= 25) return 'loose';
  return 'wild';
}

export function consistencyScores(profile: ClubProfile): ConsistencyScore[] {
  const out: ConsistencyScore[] = [];

  for (const [metric, band] of Object.entries(BANDS)) {
    const summary = band.read(profile);
    if (summary.n < 6 || !Number.isFinite(summary.mad)) continue;

    const spread = summary.mad;
    // Linear between the two anchors, clamped. Simple on purpose: a curve
    // here would imply a precision these bands do not have.
    const raw = (band.loose - spread) / (band.loose - band.tight);
    const score = Math.round(Math.max(0, Math.min(1, raw)) * 100);

    out.push({
      metric,
      label: band.label,
      score,
      spread,
      unit: band.unit,
      verdict: verdictFor(score),
      soWhat: band.soWhat,
    });
  }

  return out.sort((a, b) => a.score - b.score);
}

export interface ClubConsistency {
  club: Club;
  scores: ConsistencyScore[];
  /** Mean of the individual scores — a single headline number. */
  overall: number;
  /** The metric holding the player back most. */
  weakest: ConsistencyScore | null;
}

export function clubConsistency(profile: ClubProfile): ClubConsistency {
  const scores = consistencyScores(profile);
  const overall = scores.length
    ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length)
    : 0;
  return { club: profile.club, scores, overall, weakest: scores[0] ?? null };
}
