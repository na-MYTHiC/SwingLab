import { widthPctForHandicap } from '../benchmarks/skill.js';
import { speedAdjusted } from '../benchmarks/tour.js';
import { downgrade, spinIsModelled } from './types.js';
import { confidenceFor, round, type Finding, type Rule } from './types.js';

/** A signed offset from the target line, said the way a golfer would say it. */
function describeSide(yards: number): string {
  const n = Math.abs(round(yards, 0));
  if (n === 0) return 'dead straight';
  return `${n} yard${n === 1 ? '' : 's'} ${yards > 0 ? 'right' : 'left'}`;
}

/**
 * Delivery-consistency rules.
 *
 * These read the *spread* of what the club is doing at impact rather than its
 * average, and they matter because a golfer can have textbook medians while
 * delivering something different on every swing. Dynamic loft is the clearest
 * example: 12° on one shot and 28° on the next averages to a perfectly
 * sensible 20°, and describes a player who has no idea how far the ball is
 * going.
 */

export const dynamicLoftConsistencyRule: Rule = {
  id: 'dynamic-loft-consistency',
  minShots: 8,
  run({ profile }): Finding[] {
    const d = profile.dynamicLoft;
    if (d.n < 8 || !Number.isFinite(d.mad)) return [];
    if (d.mad < 2.5) return [];

    return [
      {
        id: 'dynamic-loft-inconsistent',
        club: profile.club,
        severity: d.mad >= 4 ? 'major' : 'minor',
        confidence: spinIsModelled(profile.spinMeasuredShare)
          ? downgrade(confidenceFor(d.n))
          : confidenceFor(d.n),
        title: `You deliver a different loft on every ${profile.club}`,
        detail:
          `Loft at impact swings about ±${round(d.mad, 1)}° around ${round(d.median, 1)}°, ` +
          `from ${round(d.min, 1)}° to ${round(d.max, 1)}° across ${d.n} shots. That is the ` +
          `single biggest reason your distances vary: loft drives both how high it launches ` +
          `and how much it spins, so a range this wide means the ball flies differently ` +
          `almost every time even when the strike feels the same.`,
        evidence: [
          { label: 'Delivered loft spread', value: round(d.mad, 1), unit: '°', reference: 2.5 },
          { label: 'Lowest', value: round(d.min, 1), unit: '°' },
          { label: 'Highest', value: round(d.max, 1), unit: '°' },
          { label: 'Shots', value: d.n, unit: '' },
        ],
        drills: ['one-flight', 'spin-loft-control', 'towel-behind-ball'],
      },
    ];
  },
};

export const launchWindowRule: Rule = {
  id: 'launch-window',
  minShots: 8,
  run({ profile }): Finding[] {
    const l = profile.launchAngle;
    if (l.n < 8 || !Number.isFinite(l.mad)) return [];
    if (l.mad < 2.0) return [];

    return [
      {
        id: 'launch-window-wide',
        club: profile.club,
        severity: l.mad >= 3.2 ? 'major' : 'minor',
        confidence: spinIsModelled(profile.spinMeasuredShare)
          ? downgrade(confidenceFor(l.n))
          : confidenceFor(l.n),
        title: `Your ${profile.club} launches through a very wide window`,
        detail:
          `Launch angle ranges from ${round(l.min, 1)}° to ${round(l.max, 1)}° — a spread of ` +
          `±${round(l.mad, 1)}° around ${round(l.median, 1)}°. Two shots that feel identical are ` +
          `leaving on completely different trajectories, which is why the same swing finds the ` +
          `green one moment and comes up twenty yards short the next.`,
        evidence: [
          { label: 'Launch spread', value: round(l.mad, 1), unit: '°', reference: 2.0 },
          { label: 'Lowest', value: round(l.min, 1), unit: '°' },
          { label: 'Highest', value: round(l.max, 1), unit: '°' },
          { label: 'Shots', value: l.n, unit: '' },
        ],
        drills: ['one-flight', 'spin-loft-control', 'tee-forward-low-point'],
      },
    ];
  },
};

export const spinConsistencyRule: Rule = {
  id: 'spin-consistency',
  minShots: 8,
  run({ profile }): Finding[] {
    const s = profile.spinRate;
    if (s.n < 8 || !Number.isFinite(s.mad) || !Number.isFinite(s.median) || s.median <= 0) return [];

    const relative = s.mad / s.median;
    if (relative < 0.14) return [];

    return [
      {
        id: 'spin-inconsistent',
        club: profile.club,
        severity: relative >= 0.22 ? 'major' : 'minor',
        confidence: spinIsModelled(profile.spinMeasuredShare)
          ? downgrade(confidenceFor(s.n))
          : confidenceFor(s.n),
        title: `Your ${profile.club} spin is all over the place`,
        detail:
          `Spin varies by about ±${round(s.mad, 0)} rpm around ${round(s.median, 0)}, from ` +
          `${round(s.min, 0)} to ${round(s.max, 0)}. Spin decides how far it carries and how ` +
          `quickly it stops, so a range like this makes the ball both fly and land differently ` +
          `shot to shot. It follows from strike and delivered loft rather than being its own ` +
          `fault — fix those and this settles with them.`,
        evidence: [
          { label: 'Spin spread', value: round(s.mad, 0), unit: 'rpm' },
          { label: 'Lowest', value: round(s.min, 0), unit: 'rpm' },
          { label: 'Highest', value: round(s.max, 0), unit: 'rpm' },
          { label: 'Shots', value: s.n, unit: '' },
        ],
        drills: ['one-flight', 'spin-loft-control', 'foot-spray-strike'],
      },
    ];
  },
};

/**
 * Lateral dispersion — how wide the pattern actually is on the ground.
 *
 * The number that decides whether you can aim at a flag. Reported separately
 * from face and path because a player can have tidy-looking delivery numbers
 * and still spray it, and because width is what they actually see.
 */
export const lateralDispersionRule: Rule = {
  id: 'lateral-dispersion',
  minShots: 10,
  run({ profile }): Finding[] {
    const d = profile.dispersion;
    const side = profile.side;
    if (!d || side.n < 10 || !Number.isFinite(d.width)) return [];

    const carry = profile.carry.median;
    if (!Number.isFinite(carry) || carry <= 0) return [];

    /*
     * Width as a share of carry, judged against the researched scale rather
     * than a round number.
     *
     * The old thresholds — flag above 16% of carry, major above 26% — were
     * set before the scale existed and are simply wrong at the top end: tour
     * standard is 18.5% of carry, so a tour player's pattern was reported to
     * them as a fault. Nothing is flagged now until the pattern is worse than
     * a good single-figure player's, and it is only major once it is out
     * around a high-teens handicap.
     */
    const relative = (d.width / carry) * 100;
    const minorAt = widthPctForHandicap(5);
    const majorAt = widthPctForHandicap(18);
    if (relative < minorAt) return [];

    return [
      {
        id: 'dispersion-wide',
        club: profile.club,
        severity: relative >= majorAt ? 'major' : 'minor',
        confidence: spinIsModelled(profile.spinMeasuredShare)
          ? downgrade(confidenceFor(side.n))
          : confidenceFor(side.n),
        title: `Your ${profile.club} pattern is ${round(d.width, 0)} yards wide`,
        detail:
          // Both ends said in words. Printing the signed minimum put a bare
          // minus sign in the middle of a sentence — "From -16 to 50 yards off
          // line" — which reads as a typo rather than as sixteen yards left.
          `${describeSide(side.min)} to ${describeSide(side.max)} across ` +
          `${side.n} shots, centred ${round(Math.abs(d.centreSide), 0)} yards ` +
          `${d.centreSide >= 0 ? 'right' : 'left'}. A green is about thirty yards across, so a ` +
          `pattern this wide means you are relying on the good half of it to hold a target.`,
        evidence: [
          { label: 'Pattern width', value: round(d.width, 0), unit: 'yds' },
          { label: 'Centre', value: round(d.centreSide, 0), unit: 'yds', reference: 0 },
          { label: 'Widest left', value: round(side.min, 0), unit: 'yds' },
          { label: 'Widest right', value: round(side.max, 0), unit: 'yds' },
        ],
        drills: ['target-window', 'aim-reset', 'gate-path'],
      },
    ];
  },
};

/**
 * Strike efficiency against tour, adjusted for the player's own club speed.
 *
 * The comparison most launch monitor apps get wrong. A player swinging a
 * 7-iron at 80 mph is not "24 yards short of tour" in any sense they can act
 * on — they are short because they swing slower. What they *can* act on is
 * efficiency: smash factor is a ratio, so a 1.34 is a 1.34 whether it comes
 * at 92 mph or 75, and the carry that efficiency would buy them at their own
 * speed is a number they can genuinely go and claim.
 */
export const speedAdjustedEfficiencyRule: Rule = {
  id: 'speed-adjusted-efficiency',
  minShots: 8,
  run({ profile }): Finding[] {
    const speed = profile.clubSpeed;
    const smash = profile.smashFactor;
    const carry = profile.carry;
    if (speed.n < 8 || !Number.isFinite(speed.median) || !Number.isFinite(smash.median)) return [];

    const adj = speedAdjusted(
      profile.club, speed.median, smash.median, carry.median,
    );
    if (!adj || !Number.isFinite(adj.efficiency)) return [];

    // Under 5% is inside the model's own error — launch and spin stop being
    // optimal a long way from the reference speed.
    const shortfall = 1 - adj.efficiency;
    if (shortfall < 0.05) return [];

    return [
      {
        id: 'below-tour-efficiency',
        club: profile.club,
        severity: shortfall >= 0.1 ? 'major' : 'minor',
        confidence: spinIsModelled(profile.spinMeasuredShare)
          ? downgrade(confidenceFor(speed.n))
          : confidenceFor(speed.n),
        title: `You are leaving ${round(adj.expectedCarry - carry.median, 0)} yards in the strike, not the swing`,
        detail:
          `You swing the ${profile.club} at ${round(speed.median, 1)} mph against a tour average of ` +
          `${round(adj.tourClubSpeed, 0)}, so raw distance comparisons are not the point. What is ` +
          `comparable is efficiency: your smash factor is ${round(smash.median, 3)} against ` +
          `${round(smash.median / adj.efficiency, 2)} for a tour-quality strike — you are at ` +
          `${round(adj.efficiency * 100, 0)}% of it. At your current club speed, striking it that ` +
          `well would carry about ${round(adj.expectedCarry, 0)} yards rather than ` +
          `${round(carry.median, 0)}. That distance is available without swinging any harder.`,
        evidence: [
          { label: 'Strike efficiency', value: round(adj.efficiency * 100, 0), unit: '%', reference: 100 },
          { label: 'Your club speed', value: round(speed.median, 1), unit: 'mph' },
          { label: 'Tour club speed', value: round(adj.tourClubSpeed, 0), unit: 'mph' },
          { label: 'Ball speed left', value: round(adj.ballSpeedGap, 1), unit: 'mph' },
          { label: 'Carry at tour strike', value: round(adj.expectedCarry, 0), unit: 'yds' },
        ],
        drills: ['foot-spray-strike', 'towel-behind-ball', 'spin-loft-control'],
      },
    ];
  },
};
