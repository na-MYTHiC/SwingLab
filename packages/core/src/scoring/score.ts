import type { Club } from '../schema.js';
import type { ClubConsistency } from '../analysis/consistency.js';
import type { StrikeBreakdown } from '../analysis/strike.js';
import type { OptimalComparison } from '../benchmarks/personal.js';
import type { ClubProfile } from '../stats/dispersion.js';
import { axisScore, tourWidthFor, TOUR_AXIS_PCT } from '../benchmarks/skill.js';

/**
 * Session scoring.
 *
 * Practice is dull because nothing keeps score. A range session gives a
 * golfer no way to know whether today went well, so improvement feels
 * invisible even when it is happening — and invisible progress is the reason
 * people stop practising.
 *
 * A score fixes that, but only if it is honest. Two rules hold everything
 * here together:
 *
 *   1. **It must be beatable by getting better, and only by that.** Nothing
 *      here rewards hitting more balls, hitting driver instead of a wedge, or
 *      picking an easy target. Every component is a rate or a spread.
 *   2. **It must not lie to be encouraging.** A bad session scores badly. A
 *      score that always says "nice work" is worth exactly nothing the first
 *      time a player notices, and they always notice.
 *
 * The components are weighted by what actually decides scoring: contact
 * first, repeatability second, then how close the delivery sits to what the
 * player's own swing speed should produce, then how tight the result was.
 */

export interface ScoreComponent {
  id: string;
  label: string;
  /** 0-100. */
  score: number;
  /** Share of the overall score this contributes. */
  weight: number;
  detail: string;
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface SessionScore {
  /** 0-100 overall. */
  total: number;
  grade: Grade;
  /** What the grade means, in one line. */
  verdict: string;
  components: ScoreComponent[];
  /** The component dragging the score down most, weighted. */
  weakest: ScoreComponent | null;
  /** Points available from fixing the weakest component alone. */
  headroom: number;
}

/** Clamp to 0-100 and round — a component score with fifteen decimal places
 * on it is a number nobody asked for and every display has to undo. */
function clamp(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)));
}

function gradeFor(total: number): Grade {
  if (total >= 88) return 'S';
  if (total >= 75) return 'A';
  if (total >= 60) return 'B';
  if (total >= 42) return 'C';
  return 'D';
}

const VERDICTS: Record<Grade, string> = {
  S: 'Everything held together. This is the session to repeat.',
  A: 'Strong. The pattern is there and it is repeatable.',
  B: 'Solid work with one clear thing holding it back.',
  C: 'The good swings are in there; they are not showing up often enough yet.',
  D: 'A grinding session. Worth knowing — these are the ones that make the next block matter.',
};

export function scoreSession(args: {
  profile: ClubProfile | null;
  strike: StrikeBreakdown;
  consistency: ClubConsistency | null;
  optimals: OptimalComparison[] | null;
  /** Shots thrown out as unusable, and the session they came from. */
  discarded?: number;
  shotCount?: number;
  /**
   * Every club with enough shots. Distance and Direction are scored across
   * the bag rather than on the most-hit club alone, so a session that worked
   * driver and wedges is graded on both.
   */
  allProfiles?: ClubProfile[];
}): SessionScore | null {
  const {
    profile, strike, consistency, optimals, discarded = 0, shotCount = 0, allProfiles,
  } = args;
  if (!profile || strike.total < 6) return null;

  const components: ScoreComponent[] = [];
  const carry = profile.carry.median;
  const hasCarry = Number.isFinite(carry) && carry > 0;

  /*
   * The clubs the pattern components are averaged over, weighted by shots.
   * One club hit six times must not outvote one hit thirty, and a bag session
   * should not be graded entirely on whichever club happened to get the most
   * balls.
   */
  const bag = (allProfiles ?? [profile]).filter(
    (p) => p.representativeCount >= 8 && Number.isFinite(p.carry.median) && p.carry.median > 0,
  );
  const across = (read: (p: ClubProfile) => number): number | null => {
    const parts = bag
      .map((p) => ({ n: p.representativeCount, v: read(p) }))
      .filter((x) => Number.isFinite(x.v));
    if (parts.length === 0) return null;
    const w = parts.reduce((sum, x) => sum + x.n, 0);
    return parts.reduce((sum, x) => sum + x.v * x.n, 0) / w;
  };
  const clubNote = bag.length > 1 ? ` Averaged across ${bag.length} clubs.` : '';

  // --- Contact. The largest single driver of amateur scoring. -----------
  components.push({
    id: 'strike',
    label: 'Contact',
    score: clamp(strike.qualityShare * 100),
    weight: 0.24,
    detail: `${Math.round(strike.qualityShare * 100)}% of your strikes were solid or better.`,
  });

  /*
   * --- Distance control. -------------------------------------------------
   *
   * Promoted out of Repeatability, where it was one metric among eight and
   * carried a fraction of the weight of the thing it actually decides. Half
   * of proximity to the hole is distance error, so scoring only the sideways
   * half of the pattern told a player who sprayed it a consistent distance
   * that they were fine, and punished a straight hitter with no yardage
   * control twice over — once here and not at all anywhere else.
   *
   * Skipped when a club was deliberately played to several targets: in a
   * Combine the carry is *supposed* to vary, and reading that as a fault
   * would be scoring the protocol rather than the player.
   */
  const distanceBag = bag.filter((p) => p.distinctTargets <= 1);
  if (hasCarry && distanceBag.length > 0) {
    const parts = distanceBag
      .map((p) => ({ n: p.representativeCount, v: axisScore(p.carry.mad, p.carry.median) }))
      .filter((x) => Number.isFinite(x.v));
    if (parts.length > 0) {
      const w = parts.reduce((sum, x) => sum + x.n, 0);
      const score = parts.reduce((sum, x) => sum + x.v * x.n, 0) / w;
      const pct = (profile.carry.mad / carry) * 100;
      components.push({
        id: 'distance',
        label: 'Distance control',
        score: clamp(score),
        weight: 0.16,
        detail:
          `Carry repeats to within ±${profile.carry.mad.toFixed(1)} yards on the ` +
          `${profile.club}, ${pct.toFixed(1)}% of the shot. Tour is about ` +
          `${TOUR_AXIS_PCT.toFixed(1)}%.` +
          (parts.length > 1 ? ` Scored across ${parts.length} clubs.` : ''),
      });
    }
  }

  // --- Direction. The other half of proximity. --------------------------
  const d = profile.dispersion;
  if (d && hasCarry) {
    const score = across((p) => axisScore(p.side.mad, p.carry.median));
    if (score !== null) {
      components.push({
        id: 'dispersion',
        label: 'Direction',
        score: clamp(score),
        weight: 0.16,
        detail:
          `${Math.round(d.width)} yards wide on a ${Math.round(carry)}-yard ${profile.club}. ` +
          `Tour standard at that distance is about ${Math.round(tourWidthFor(carry))} yards.`
          + clubNote,
      });
    }
  }

  /*
   * --- Delivery against the player's own optimal windows. ---------------
   *
   * Graded by distance from the target, not by band membership. Counting how
   * many numbers land inside their window gave 100/100 to a player sitting at
   * the very edge of all six of them, which is not a hundred-point delivery
   * by any reading — and it made the component jump between round numbers as
   * a value crossed a line. So each metric scores on how far it sits from its
   * target, measured in units of the band's own half-width: exactly on target
   * is 100, at the edge of the band is 60, and it falls away from there.
   */
  if (optimals && optimals.length > 0) {
    const judged = optimals.filter((o) => o.status !== 'unknown');
    if (judged.length > 0) {
      const per = judged.map((o) => {
        const half = Math.max((o.window.max - o.window.min) / 2, 1e-9);
        const offBy = Math.abs(o.actual - o.window.target) / half;
        return Math.max(0, 100 - offBy * 40);
      });
      const mean = per.reduce((a, b) => a + b, 0) / per.length;
      const onTarget = judged.filter((o) => o.status === 'on-target').length;
      const perfect = per.filter((x) => x >= 99).length;

      /*
       * Delivery carries less weight when the spin behind it was modelled.
       *
       * TrackMan estimates spin when it cannot read the ball's markings, and
       * in the real test session it did so on forty-three shots out of
       * forty-five. Spin is one of six numbers here and it feeds launch as
       * well, so a component resting largely on a model should not weigh the
       * same as one resting on measurement. The score is unchanged — what
       * changes is how much of the total it decides.
       */
      const measured = profile.spinMeasuredShare;
      const modelled = measured !== null && measured < 0.5;
      components.push({
        id: 'delivery',
        label: 'Delivery',
        score: clamp(mean),
        weight: modelled ? 0.1 : 0.16,
        detail:
          perfect === judged.length
            ? `All ${judged.length} numbers are on the tour figure for your swing speed.`
            : `${onTarget} of ${judged.length} numbers inside the window, scored on how close ` +
              `each sits to the tour figure for your swing speed rather than merely inside it.` +
              (modelled
                ? ` Counts for less here: your unit estimated spin on ` +
                  `${Math.round((1 - (measured as number)) * 100)}% of these shots rather than ` +
                  `measuring it.`
                : ''),
      });
    }
  }

  /*
   * --- Repeatability, minus what now has its own component. -------------
   *
   * Carry spread is excluded: it is scored above as Distance control, and
   * leaving it here would count the same fault twice and quietly make it the
   * heaviest thing in the whole score.
   */
  if (consistency) {
    const kept = consistency.scores.filter((c) => c.metric !== 'carry');
    if (kept.length > 0) {
      const mean = kept.reduce((sum, c) => sum + c.score, 0) / kept.length;
      const worst = [...kept].sort((a, b) => a.score - b.score)[0];
      components.push({
        id: 'repeatability',
        label: 'Repeatability',
        score: clamp(mean),
        weight: 0.18,
        detail: worst
          ? `Held together everywhere except ${worst.label.toLowerCase()}.`
          : 'Measured across every delivery metric with enough shots behind it.',
      });
    }
  }

  /*
   * --- Reliability. The shots that were thrown out. ---------------------
   *
   * A hole the score had until now: tops and shanks are excluded from every
   * statistic, which is right — a topped 7-iron says nothing about a 7-iron —
   * but it meant a player could shank three balls and the score would not
   * notice, because the filter that keeps the numbers honest was also hiding
   * the cost. On a course each of those is a stroke and sometimes two, so the
   * rate is scored directly. Most clean sessions get full marks here; that is
   * the point, it is a penalty rather than a ladder.
   *
   * Counts wasted strikes only, never rows the radar could not read. Lumping
   * the two together charged a golfer for their launch monitor's sensor
   * errors — a Combine with six unreadable rows scored zero here and was told
   * it had topped ten percent of the session.
   */
  if (shotCount >= 15) {
    const rate = discarded / shotCount;
    components.push({
      id: 'reliability',
      label: 'Reliability',
      // Full marks at none, nothing at one shot in ten.
      score: clamp((1 - rate / 0.1) * 100),
      weight: 0.1,
      detail:
        discarded === 0
          ? 'Not one shot bad enough to throw out. On a course that is a round without a wasted stroke.'
          : `${discarded} of ${shotCount} shots were tops or duffs — ` +
            `${(rate * 100).toFixed(1)}% of the session, and a stroke each on a course.`,
    });
  }

  // Renormalise so a missing component does not silently cost points — a
  // player whose launch monitor reports no club data should not be graded
  // down for what it could not measure.
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0) || 1;
  const total = Math.round(
    components.reduce((sum, c) => sum + c.score * (c.weight / totalWeight), 0),
  );

  const weakest = [...components].sort(
    (a, b) => (a.score * a.weight) - (b.score * b.weight),
  )[0] ?? null;

  const headroom = weakest
    ? Math.round((100 - weakest.score) * (weakest.weight / totalWeight))
    : 0;

  // Best first, so what held up reads before what did not and the weakest
  // lands where the eye stops. Sorted once here rather than at each of the
  // three places that render it.
  components.sort((a, b) => b.score - a.score);

  const grade = gradeFor(total);
  return { total, grade, verdict: VERDICTS[grade], components, weakest, headroom };
}

/**
 * Personal bests, so a session can be measured against the player's own
 * history rather than an abstract standard.
 *
 * Only records that reward *better golf* are tracked. Longest drive is
 * deliberately absent: it rewards one swing out of fifty and swinging out of
 * your shoes, which is the opposite of what this app is for.
 */
// Named PersonalRecord, not Record — the latter shadows TypeScript's built-in
// utility type and breaks every `Record<K, V>` in the file.
export interface PersonalRecord {
  id: string;
  label: string;
  club: Club;
  value: number;
  unit: string;
  sessionId: string;
  date: Date | null;
  /** True when this session set it. */
  isNew: boolean;
}

export interface RecordCandidate {
  id: string;
  label: string;
  unit: string;
  /** Higher is better for this record. */
  higherBetter: boolean;
  read: (p: ClubProfile, s: StrikeBreakdown) => number;
}

export const RECORDS: RecordCandidate[] = [
  {
    id: 'flush-rate', label: 'Best flush rate', unit: '%', higherBetter: true,
    read: (_p, s) => (s.counts.find((c) => c.klass === 'flush')?.share ?? 0) * 100,
  },
  {
    id: 'quality-rate', label: 'Best contact rate', unit: '%', higherBetter: true,
    read: (_p, s) => s.qualityShare * 100,
  },
  {
    id: 'tightest-carry', label: 'Tightest carry spread', unit: 'yds', higherBetter: false,
    read: (p) => p.carry.mad,
  },
  {
    id: 'tightest-pattern', label: 'Tightest pattern', unit: 'yds', higherBetter: false,
    read: (p) => p.dispersion?.width ?? Number.NaN,
  },
  {
    id: 'best-smash', label: 'Best strike efficiency', unit: '', higherBetter: true,
    read: (p) => p.smashFactor.median,
  },
];
