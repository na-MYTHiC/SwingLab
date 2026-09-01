import type { Club, Shot } from '../schema.js';
import { compareClubs } from '../clubs.js';
import { percentile, pluck, summarise, type Summary } from './robust.js';
import { representative, usable } from './outliers.js';

/**
 * Per-club aggregates — the input to every diagnosis rule and every chart.
 *
 * Computed once per session (or per rolling window) so that rules do not each
 * re-derive the same medians from raw shots.
 */
export interface ClubProfile {
  club: Club;
  /** Shots after implausible rows are dropped, mishits included. */
  shotCount: number;
  /** Shots the medians below are computed from. */
  representativeCount: number;
  mishitCount: number;
  mishitRate: number;
  /**
   * How many distinct target distances this club was hit to.
   *
   * In a Combine or a Test Center ladder the same wedge is played to 60, 70,
   * 80 and 90 yards on purpose. Its carry *should* vary, and any rule that
   * reads raw carry spread as inconsistency will report a fault where the
   * player was doing exactly what the mode asked. Rules check this before
   * judging distance control.
   */
  distinctTargets: number;

  clubSpeed: Summary;
  attackAngle: Summary;
  clubPath: Summary;
  faceAngle: Summary;
  faceToPath: Summary;
  dynamicLoft: Summary;
  spinLoft: Summary;
  lowPointDistance: Summary;
  impactOffset: Summary;
  impactHeight: Summary;

  ballSpeed: Summary;
  smashFactor: Summary;
  launchAngle: Summary;
  launchDirection: Summary;
  spinRate: Summary;
  spinAxis: Summary;

  carry: Summary;
  /**
   * Signed carry error against the shot's own target, in yards.
   *
   * The meaningful distance number whenever a club was played to more than
   * one target. Raw carry spread across a Combine's 60- and 70-yard targets
   * describes the protocol; the error against each target describes the
   * player.
   */
  carryError: Summary;
  total: Summary;
  side: Summary;
  curve: Summary;
  apexHeight: Summary;
  landingAngle: Summary;

  /** Two-sigma dispersion ellipse in yards, from carry and side. */
  dispersion: DispersionEllipse | null;
  /** Where the shots actually fell, without assuming a bell curve. */
  containment: Containment | null;
  /**
   * Share of shots whose spin the launch monitor actually measured, rather
   * than modelled from the rest of the flight.
   *
   * Null when the export does not say. The real test file reads 0.04 — two
   * measured shots out of forty-five — which means every spin finding in that
   * session rests on a model, and the app said so in a footnote while
   * weighting it exactly as heavily as a measured one.
   */
  spinMeasuredShare: number | null;
}

/**
 * Containment radii, measured rather than modelled.
 *
 * The ellipse assumes the pattern is normal in both axes. Real ones often are
 * not: a player can be tight for forty shots and have three that went
 * somewhere else entirely, and a standard deviation quietly averages that into
 * "moderately wide" when the truth is "tight, with three disasters". Sorting
 * the actual distances from the centre and reading off the 50th, 75th and 90th
 * shows the shape of the tail instead of hiding it.
 *
 * These are also the right unit for a practice target. "Get 75% of them inside
 * 11 yards" is something a player can count on the screen in front of them;
 * "reduce your standard deviation" is not.
 */
export interface Containment {
  /** Radius from the pattern centre holding this share of shots, in yards. */
  p50: number;
  p75: number;
  p90: number;
  /** Half-width sideways at 75%, ignoring distance error. */
  side75: number;
  /** Half-depth for distance at 75%, ignoring direction. */
  depth75: number;
  /** How many shots the radii were measured from. */
  n: number;
}

export interface DispersionEllipse {
  /** Median carry, yards. */
  centreCarry: number;
  /** Median side offset, yards; + is right. */
  centreSide: number;
  /** Depth of the pattern (long/short), yards, ~95% of shots. */
  depth: number;
  /** Width of the pattern (left/right), yards, ~95% of shots. */
  width: number;
}

export function buildClubProfile(club: Club, shots: Shot[]): ClubProfile {
  const all = usable(shots);
  const rep = representative(shots);
  const mishits = all.length - rep.length;

  const s = (get: (shot: Shot) => number | null) => summarise(pluck(rep, get));

  const targets = new Set(
    all
      .map((shot) => shot.targetDistance)
      .filter((t): t is number => t !== null)
      .map((t) => Math.round(t / 5) * 5),
  );

  const carry = s((x) => x.carry);
  const side = s((x) => x.side);
  const carryError = summarise(
    rep
      .filter((shot) => shot.carry !== null && shot.targetDistance !== null)
      .map((shot) => (shot.carry as number) - (shot.targetDistance as number)),
  );

  return {
    club,
    shotCount: all.length,
    representativeCount: rep.length,
    mishitCount: mishits,
    mishitRate: all.length === 0 ? 0 : mishits / all.length,
    distinctTargets: targets.size,

    clubSpeed: s((x) => x.clubSpeed),
    attackAngle: s((x) => x.attackAngle),
    clubPath: s((x) => x.clubPath),
    faceAngle: s((x) => x.faceAngle),
    faceToPath: s((x) => x.faceToPath),
    dynamicLoft: s((x) => x.dynamicLoft),
    spinLoft: s((x) => x.spinLoft),
    lowPointDistance: s((x) => x.lowPointDistance),
    impactOffset: s((x) => x.impactOffset),
    impactHeight: s((x) => x.impactHeight),

    ballSpeed: s((x) => x.ballSpeed),
    smashFactor: s((x) => x.smashFactor),
    launchAngle: s((x) => x.launchAngle),
    launchDirection: s((x) => x.launchDirection),
    spinRate: s((x) => x.spinRate),
    spinAxis: s((x) => x.spinAxis),

    carry,
    carryError,
    total: s((x) => x.total),
    side,
    curve: s((x) => x.curve),
    apexHeight: s((x) => x.apexHeight),
    landingAngle: s((x) => x.landingAngle),

    dispersion: buildEllipse(carry, side),
    containment: buildContainment(rep, carry, side),
    spinMeasuredShare: measuredShare(rep),
  };
}

function measuredShare(shots: Shot[]): number | null {
  const known = shots.filter((s) => s.spinMeasured !== null);
  if (known.length === 0) return null;
  return known.filter((s) => s.spinMeasured === true).length / known.length;
}

function buildContainment(shots: Shot[], carry: Summary, side: Summary): Containment | null {
  if (!Number.isFinite(carry.median) || !Number.isFinite(side.median)) return null;

  const points = shots
    .filter((s) => s.carry !== null && s.side !== null)
    .map((s) => ({
      dx: (s.side as number) - side.median,
      dy: (s.carry as number) - carry.median,
    }));
  if (points.length < 6) return null;

  const radii = points.map((p) => Math.hypot(p.dx, p.dy)).sort((a, b) => a - b);
  const sides = points.map((p) => Math.abs(p.dx)).sort((a, b) => a - b);
  const depths = points.map((p) => Math.abs(p.dy)).sort((a, b) => a - b);

  return {
    p50: percentile(radii, 0.5),
    p75: percentile(radii, 0.75),
    p90: percentile(radii, 0.9),
    side75: percentile(sides, 0.75),
    depth75: percentile(depths, 0.75),
    n: points.length,
  };
}

function buildEllipse(carry: Summary, side: Summary): DispersionEllipse | null {
  if (carry.n < 3 || side.n < 3) return null;
  if (!Number.isFinite(carry.median) || !Number.isFinite(side.median)) return null;
  return {
    centreCarry: carry.median,
    centreSide: side.median,
    depth: 4 * carry.mad,
    width: 4 * side.mad,
  };
}

/** Build one profile per club present, in long-to-short order. */
export function buildClubProfiles(shots: Shot[]): ClubProfile[] {
  const byClub = new Map<Club, Shot[]>();
  for (const shot of shots) {
    const list = byClub.get(shot.club) ?? [];
    list.push(shot);
    byClub.set(shot.club, list);
  }
  return [...byClub.entries()]
    .map(([club, group]) => buildClubProfile(club, group))
    .sort((a, b) => compareClubs(a.club, b.club));
}
