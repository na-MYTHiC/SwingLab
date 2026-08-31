import { mad, median, pluck, summarise } from '../stats/robust.js';
import { representative } from '../stats/outliers.js';
import type { Shot } from '../schema.js';
import { confidenceFor, round, type Finding } from './types.js';

/**
 * Rules for the modes that give you something to aim at — Combine, Test
 * Center, Performance Center, Target Practice and the games.
 *
 * These need target data, so they run on shots rather than on club profiles:
 * a Combine works through ten distances and the interesting pattern is
 * across distances, not within one club.
 */

/**
 * Systematic distance bias.
 *
 * The most valuable and most missed finding in target practice. A player who
 * finishes 8 yards short of every target does not have a consistency problem
 * — they have a calibration problem, and it is fixed by writing down
 * different numbers rather than by changing their swing. Averages of
 * *proximity* hide this completely, because proximity is unsigned: 8 short
 * and 8 long both read as "8 feet away".
 */
export function distanceBiasFindings(shots: Shot[]): Finding[] {
  const usable = representative(shots).filter(
    (s) => s.targetDistance !== null && s.carry !== null,
  );
  if (usable.length < 8) return [];

  const errors = usable.map((s) => (s.carry as number) - (s.targetDistance as number));
  const stats = summarise(errors);
  if (!Number.isFinite(stats.median)) return [];

  const findings: Finding[] = [];
  const bias = stats.median;

  // Roughly a third of a club. Below this it is noise, above it the player is
  // reaching for the wrong club every time.
  if (Math.abs(bias) >= 4) {
    const short = bias < 0;
    findings.push({
      id: short ? 'target-short-bias' : 'target-long-bias',
      club: null,
      severity: Math.abs(bias) >= 8 ? 'major' : 'minor',
      confidence: confidenceFor(usable.length),
      title: `You finish ${round(Math.abs(bias), 0)} yards ${short ? 'short of' : 'past'} your targets`,
      detail:
        `Across ${usable.length} shots at a target, your carry came up a median of ` +
        `${round(Math.abs(bias), 1)} yards ${short ? 'short' : 'long'}. This is a calibration ` +
        `problem rather than a swing problem — the numbers you are playing to are wrong, and ` +
        `${short ? 'clubbing up' : 'clubbing down'} fixes more of it than practice will.`,
      evidence: [
        { label: 'Distance bias', value: round(bias, 1), unit: 'yds', reference: 0 },
        { label: 'Shots at target', value: usable.length, unit: '' },
        { label: 'Spread', value: round(stats.mad, 1), unit: 'yds' },
      ],
      drills: ['ladder-gapping'],
    });
  }

  // Spread is the separate question: are they repeatable around whatever
  // number they are hitting?
  if (stats.mad >= 9) {
    findings.push({
      id: 'target-distance-spread',
      club: null,
      severity: stats.mad >= 14 ? 'major' : 'minor',
      confidence: confidenceFor(usable.length),
      title: 'Your distance control at a target is loose',
      detail:
        `Carry lands within about ±${round(stats.mad, 0)} yards of your target, from ` +
        `${round(stats.min, 0)} to ${round(stats.max, 0)} yards of error across ${usable.length} shots. ` +
        `On a green that is the difference between a putt and a chip, and it is what proximity ` +
        `scores are actually measuring.`,
      evidence: [
        { label: 'Distance spread', value: round(stats.mad, 1), unit: 'yds', reference: 9 },
        { label: 'Worst short', value: round(stats.min, 0), unit: 'yds' },
        { label: 'Worst long', value: round(stats.max, 0), unit: 'yds' },
      ],
      drills: ['random-practice-block', 'foot-spray-strike'],
    });
  }

  return findings;
}

/**
 * Which target distances are costing the most, for scored modes.
 *
 * The single most useful output of a Combine is not the overall score — it
 * is which of the ten distances dragged it down, because that is the one
 * worth building a Test Center session around.
 */
export function weakDistanceFindings(shots: Shot[]): Finding[] {
  const scored = representative(shots).filter(
    (s) => s.targetDistance !== null && (s.shotScore !== null || s.proximity !== null),
  );
  if (scored.length < 12) return [];

  const byTarget = new Map<number, Shot[]>();
  for (const shot of scored) {
    const bucket = Math.round((shot.targetDistance as number) / 10) * 10;
    const list = byTarget.get(bucket) ?? [];
    list.push(shot);
    byTarget.set(bucket, list);
  }

  const rated: { distance: number; value: number; n: number; usingScore: boolean }[] = [];
  for (const [distance, group] of byTarget) {
    if (group.length < 3) continue;
    const scores = pluck(group, (s) => s.shotScore);
    if (scores.length >= 3) {
      rated.push({ distance, value: summarise(scores).median, n: scores.length, usingScore: true });
    } else {
      const prox = pluck(group, (s) => s.proximity);
      if (prox.length >= 3) {
        // Normalise proximity by distance so a 180-yard target is not
        // automatically the "worst" one just for being further away.
        rated.push({
          distance,
          value: -summarise(prox).median / Math.max(1, distance),
          n: prox.length,
          usingScore: false,
        });
      }
    }
  }

  // Four distances is the minimum for "weakest of these" to mean anything.
  if (rated.length < 4) return [];

  rated.sort((a, b) => a.value - b.value);
  const worst = rated[0];
  const best = rated[rated.length - 1];
  if (!worst || !best || worst.distance === best.distance) return [];

  /*
   * Separation, not sample size, is what makes this claim trustworthy.
   *
   * A Combine gives exactly six shots per distance, so judging confidence on
   * sample size alone would mean this rule could never fire on the one test
   * it matters most for. The real question is different: is the worst
   * distance clearly worse than the others, or is it just the low end of
   * ordinary scatter? If nine distances all score within a few points, the
   * "weakest" one is noise and naming it would send the player off to
   * practise a number that will move on its own next time.
   *
   * Requiring the worst to sit at least 1.5 scaled MADs below the middle
   * answers that in whichever unit the rows happen to be in.
   */
  const values = rated.map((r) => r.value);
  const middle = median(values);
  const spread = mad(values, middle);

  /*
   * The floor matters as much as the multiple. MAD is exactly zero whenever
   * most values sit on the median, which is common with tightly clustered
   * scores — and treating zero spread as "no test to apply" would fire this
   * rule on distances that are indistinguishable, the precise opposite of
   * what the guard is for. So the bar is never allowed below 8% of the
   * typical value.
   */
  const separation = Math.max(1.5 * spread, 0.08 * Math.abs(middle));
  if (middle - worst.value < separation) return [];

  const totalShots = rated.reduce((sum, r) => sum + r.n, 0);

  return [
    {
      id: 'weak-target-distance',
      club: null,
      severity: 'minor',
      confidence: confidenceFor(totalShots),
      title: `Your weakest distance is ${worst.distance} yards`,
      detail:
        `Across ${rated.length} target distances, ${worst.distance} yards scored worst and ` +
        `${best.distance} yards scored best. That gap is where a custom Test Center session pays ` +
        `for itself — one target, repeated, tracked over visits, rather than spreading the same ` +
        `hour across every distance equally.`,
      evidence: [
        { label: 'Weakest target', value: worst.distance, unit: 'yds' },
        { label: 'Strongest target', value: best.distance, unit: 'yds' },
        { label: 'Distances tested', value: rated.length, unit: '' },
        { label: 'Shots in the test', value: totalShots, unit: '' },
        ...(worst.usingScore
          ? [{ label: 'Score there', value: round(worst.value, 0), unit: '/100' }]
          : []),
      ],
      drills: ['random-practice-block'],
    },
  ];
}
