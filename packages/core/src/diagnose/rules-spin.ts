import { SPIN_WINDOW } from '../benchmarks/tour.js';
import { personalOptimals } from '../benchmarks/personal.js';
import { confidenceFor, round, type Finding, type Rule } from './types.js';

/**
 * Spin rules.
 *
 * Deliberately narrow. Optimal spin depends on club speed, launch angle, ball
 * model and even altitude, and "optimising" it from shot data alone is a
 * fitting question rather than a coaching one. These rules only fire when
 * spin is outside a window wide enough that it is costing the player
 * something regardless of those variables.
 */

export const spinWindowRule: Rule = {
  id: 'spin-window',
  minShots: 5,
  run({ profile }): Finding[] {
    const s = profile.spinRate;
    if (s.n < 5 || !Number.isFinite(s.median)) return [];

    /*
     * Judge spin against this player's own optimal, not a one-size window.
     *
     * The same delivery spins less at a lower club speed, so a fixed range
     * calls a slower swing "low spin" for doing everything right. Scaling the
     * tour figure to the player's measured speed asks the only question worth
     * asking: is your spin what *your* swing should produce?
     */
    const optimal = personalOptimals(profile.club, profile.clubSpeed.median)
      ?.windows.find((w) => w.metric === 'spinRate');
    const fallback = SPIN_WINDOW[profile.club];
    if (!optimal && !fallback) return [];

    const [lo, hi] = optimal ? [optimal.min, optimal.max] : (fallback as [number, number]);
    const m = s.median;
    if (m >= lo && m <= hi) return [];

    const high = m > hi;
    const reference = high ? hi : lo;
    const miss = Math.abs(m - reference);

    return [
      {
        id: high ? 'spin-too-high' : 'spin-too-low',
        club: profile.club,
        severity: miss >= (high ? 1200 : 900) ? 'major' : 'minor',
        confidence: confidenceFor(s.n),
        title: `Your ${profile.club} spin is ${high ? 'high' : 'low'}`,
        detail: high
          ? `Median spin is ${round(m, 0)} rpm, about ${round(miss, 0)} above the top of the range ` +
            `your own ${round(profile.clubSpeed.median, 0)} mph club speed should produce ` +
            `(${round(lo, 0)}-${round(hi, 0)} rpm). High spin steepens the descent and shortens the shot; with a ${profile.club} ` +
            `it usually traces back to spin loft — dynamic loft minus attack angle — currently ` +
            `${round(profile.spinLoft.median, 1)}°.`
          : `Median spin is ${round(m, 0)} rpm, about ${round(miss, 0)} below what your own ` +
            `${round(profile.clubSpeed.median, 0)} mph club speed should produce (${round(lo, 0)}-${round(hi, 0)} rpm). ` +
            `Low spin flattens the flight and costs stopping power, and on an iron it usually means the ` +
            `strike is low on the face or the face is delofted through impact.`,
        evidence: [
          { label: 'Spin rate', value: round(m, 0), unit: 'rpm', reference },
          { label: 'Spin loft', value: round(profile.spinLoft.median, 1), unit: '°' },
          { label: 'Dynamic loft', value: round(profile.dynamicLoft.median, 1), unit: '°' },
          { label: 'Attack angle', value: round(profile.attackAngle.median, 1), unit: '°' },
          { label: 'Shots', value: s.n, unit: '' },
        ],
        drills: high ? ['spin-loft-control', 'foot-spray-strike'] : ['foot-spray-strike'],
      },
    ];
  },
};

/**
 * Carry consistency. The number a player actually feels on the course, and
 * the one that decides whether they can commit to a club.
 */
export const carryConsistencyRule: Rule = {
  id: 'carry-consistency',
  minShots: 8,
  run({ profile }): Finding[] {
    const c = profile.carry;
    if (c.n < 8 || !Number.isFinite(c.mad) || !Number.isFinite(c.median) || c.median <= 0) return [];

    /*
     * Skip clubs that were played to more than one target.
     *
     * A Combine works the same wedge through 60, 70, 80 and 90 yards, so its
     * carry spread is the protocol rather than a fault. Distance control in
     * those modes is measured against the target instead — that is what
     * `target-distance-spread` is for, and it uses the signed error, which is
     * the honest number here.
     */
    if (profile.distinctTargets > 1) return [];

    // Express spread as a fraction of carry so the threshold works for a
    // wedge and a driver alike.
    const relative = c.mad / c.median;
    if (relative < 0.045) return [];

    return [
      {
        id: 'carry-inconsistent',
        club: profile.club,
        severity: relative >= 0.075 ? 'major' : 'minor',
        confidence: confidenceFor(c.n),
        title: `Your ${profile.club} carry distance is unpredictable`,
        detail:
          `Carry varies by about ±${round(c.mad, 0)} yards around a median of ${round(c.median, 0)} ` +
          `(${round(relative * 100, 1)}% of the shot), from ${round(c.min, 0)} to ${round(c.max, 0)} yards ` +
          `across ${c.n} shots. A spread this wide means you cannot pick a target number for this club, ` +
          `which shows up as short-siding and missed greens rather than as a visible swing fault.`,
        evidence: [
          { label: 'Carry spread', value: round(c.mad, 0), unit: 'yds' },
          { label: 'Median carry', value: round(c.median, 0), unit: 'yds' },
          { label: 'Shortest', value: round(c.min, 0), unit: 'yds' },
          { label: 'Longest', value: round(c.max, 0), unit: 'yds' },
          { label: 'Shots', value: c.n, unit: '' },
        ],
        drills: ['call-the-number', 'ladder-gapping', 'one-flight'],
      },
    ];
  },
};
