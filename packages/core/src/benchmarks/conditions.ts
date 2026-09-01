/**
 * Air, and what it does to a golf ball.
 *
 * THE PROBLEM THIS SOLVES. A TrackMan export states the conditions its numbers
 * are normalised to, and until now the app threw that line away. The real test
 * file says:
 *
 *   "Data are normalized to no wind conditions at 4700 ft altitude, 77 °F
 *    with a Premium ball"
 *
 * Four thousand seven hundred feet is Denver territory, and a ball carries
 * about five and a half percent further up there. So a 169-yard 7-iron in that
 * bay is a 160-yard 7-iron at sea level — and the app was comparing it
 * directly against tour targets, calling the player five yards long when they
 * are closer to eight yards short. Every carry number, every gapping finding,
 * and every session-to-session comparison inherited that error silently.
 *
 * THE COEFFICIENTS. Titleist, who do the ball aerodynamics research, put the
 * altitude effect at 1.16% per 1,000 feet — Denver's 5,280 feet works out at
 * 6.1%. That is the figure used here. The widely repeated "2% per 1,000 feet"
 * is too strong; MyGolfSpy independently lands on 1.2%, which agrees.
 *
 * Temperature is a much smaller and less certain effect: roughly two yards on
 * a 250-yard drive per ten degrees, so about 0.8% per 10 °F. It is included
 * because it is free once the string is parsed, and flagged as the weaker of
 * the two.
 *
 * WHAT THIS IS NOT. It is not a full trajectory model. Air density depends on
 * humidity and pressure as well, spin decay is not linear, and a wedge is
 * affected less than a driver in absolute terms even though the percentage
 * holds. This is a first-order correction that removes the large, systematic
 * error; it does not pretend to remove the small ones.
 */

export interface Conditions {
  /** Feet above sea level the numbers are normalised to. */
  altitudeFeet: number | null;
  /** Degrees Fahrenheit. */
  temperatureF: number | null;
  /** "Premium", "Range", or whatever the unit reported. */
  ball: string | null;
  /** True when the export says the numbers assume still air. */
  windNormalised: boolean;
  /** The original line, kept so nothing is lost in parsing. */
  raw: string | null;
}

export const NO_CONDITIONS: Conditions = {
  altitudeFeet: null,
  temperatureF: null,
  ball: null,
  windNormalised: false,
  raw: null,
};

/** Titleist: 1.16% more carry per 1,000 feet of altitude. */
const PCT_PER_1000_FT = 1.16;
/** Rule of thumb: about 0.8% per 10 °F. Weaker evidence than the altitude figure. */
const PCT_PER_10F = 0.8;

/** The frame everything is normalised back to: sea level, 70 °F. */
export const REFERENCE_ALTITUDE_FT = 0;
export const REFERENCE_TEMP_F = 70;

/**
 * Read TrackMan's normalisation line.
 *
 * Deliberately forgiving: the wording has changed between TPS versions and
 * will change again, so this looks for numbers next to units rather than
 * matching the sentence. A line it cannot read yields nulls and the app
 * carries on uncorrected, which is exactly what it did before.
 */
export function parseConditions(line: string | null | undefined): Conditions {
  if (!line || !line.trim()) return NO_CONDITIONS;
  const raw = line.trim();

  const altitude = /(-?[\d.]+)\s*(?:ft|feet)\b/i.exec(raw);
  const metres = /(-?[\d.]+)\s*(?:m|meters?|metres?)\s+altitude/i.exec(raw);
  const fahrenheit = /(-?[\d.]+)\s*(?:℉|°\s*F\b|(?<=\s)F\b)/i.exec(raw);
  const celsius = /(-?[\d.]+)\s*(?:℃|°\s*C\b|(?<=\s)C\b)/i.exec(raw);
  const ball = /with\s+an?\s+(\w+)\s+ball/i.exec(raw);

  let altitudeFeet: number | null = null;
  if (altitude) altitudeFeet = Number(altitude[1]);
  else if (metres) altitudeFeet = Number(metres[1]) * 3.28084;

  let temperatureF: number | null = null;
  if (fahrenheit) temperatureF = Number(fahrenheit[1]);
  else if (celsius) temperatureF = (Number(celsius[1]) * 9) / 5 + 32;

  return {
    altitudeFeet: Number.isFinite(altitudeFeet as number) ? altitudeFeet : null,
    temperatureF: Number.isFinite(temperatureF as number) ? temperatureF : null,
    ball: ball ? (ball[1] as string) : null,
    windNormalised: /no wind/i.test(raw),
    raw,
  };
}

/**
 * How much longer the ball flies in these conditions than at the reference.
 *
 * 1.0 means no correction. 1.055 means carries here are five and a half
 * percent longer than the same swing would produce at sea level.
 */
export function carryFactor(conditions: Conditions | null | undefined): number {
  if (!conditions) return 1;
  let factor = 1;
  if (conditions.altitudeFeet !== null) {
    const feet = conditions.altitudeFeet - REFERENCE_ALTITUDE_FT;
    factor *= 1 + (feet / 1000) * (PCT_PER_1000_FT / 100);
  }
  if (conditions.temperatureF !== null) {
    const degrees = conditions.temperatureF - REFERENCE_TEMP_F;
    factor *= 1 + (degrees / 10) * (PCT_PER_10F / 100);
  }
  // A factor outside this range means the line was misread, not that the
  // player is hitting it on the moon.
  return Math.max(0.8, Math.min(1.3, factor));
}

/** A measured carry, expressed as it would be at sea level and 70 °F. */
export function toReference(carry: number, conditions: Conditions | null | undefined): number {
  const f = carryFactor(conditions);
  return f === 0 ? carry : carry / f;
}

/** A reference-frame distance, expressed as it would play in these conditions. */
export function fromReference(carry: number, conditions: Conditions | null | undefined): number {
  return carry * carryFactor(conditions);
}

/**
 * Rescale a session's flight distances into the reference frame.
 *
 * Used wherever two sessions are compared — trends, did-it-work, the rolling
 * baseline. Within one session the factor is constant and changes nothing, so
 * the numbers on screen stay the ones the bay showed; across sessions it is
 * the difference between measuring a swing and measuring the weather. A player
 * who moves from a sea-level bay to one at altitude would otherwise appear to
 * have gained ten yards overnight, and the app would congratulate them for it.
 *
 * Only flight distances are touched. Ball speed, spin, launch and the club
 * numbers all happen at impact and are unaffected by the air afterwards.
 */
export function toReferenceFrame<T extends {
  carry: number | null;
  total: number | null;
  side: number | null;
  apexHeight: number | null;
}>(shots: T[], conditions: Conditions | null | undefined): T[] {
  const f = carryFactor(conditions);
  if (f === 1) return shots;
  const scale = (v: number | null) => (v === null ? null : v / f);
  return shots.map((s) => ({
    ...s,
    carry: scale(s.carry),
    total: scale(s.total),
    side: scale(s.side),
    apexHeight: scale(s.apexHeight),
  }));
}

/** True when the correction is big enough to be worth mentioning. */
export function isSignificant(conditions: Conditions | null | undefined): boolean {
  return Math.abs(carryFactor(conditions) - 1) >= 0.015;
}

/** One line for the UI, or null when there is nothing worth saying. */
export function describe(conditions: Conditions | null | undefined): string | null {
  if (!conditions) return null;
  const parts: string[] = [];
  if (conditions.altitudeFeet !== null) {
    parts.push(`${Math.round(conditions.altitudeFeet).toLocaleString()} ft`);
  }
  if (conditions.temperatureF !== null) parts.push(`${Math.round(conditions.temperatureF)}°F`);
  if (conditions.ball) parts.push(`${conditions.ball.toLowerCase()} ball`);
  if (parts.length === 0) return null;

  const pct = (carryFactor(conditions) - 1) * 100;
  const effect = Math.abs(pct) < 1.5
    ? 'about the same as sea level'
    : `${Math.abs(pct).toFixed(1)}% ${pct > 0 ? 'longer' : 'shorter'} than sea level`;
  return `${parts.join(', ')} — carries here are ${effect}.`;
}
