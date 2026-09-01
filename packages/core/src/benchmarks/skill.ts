/**
 * How good is this pattern, really?
 *
 * One scale, used by both the handicap estimate and the Dispersion score, so
 * the two can never contradict each other on the same screen. An earlier
 * version had them on separate invented scales and cheerfully showed a player
 * "Dispersion 0/100" directly above "handicap 7-12", which is not a thing that
 * can be true.
 *
 * ============================ WHERE THE NUMBERS COME FROM ==================
 *
 * PROXIMITY IS THE ANCHOR. Radial proximity to the hole is the best-measured
 * quantity in golf: Arccos and Shot Scope have tracked hundreds of millions of
 * amateur shots, and the PGA Tour's ShotLink covers every tour shot since
 * 2003. It is also the right quantity, because what costs strokes is how far
 * the ball finishes from the target — not how far left it is, and not how far
 * short it is, but the two together.
 *
 *   PGA Tour, 150-175 yds from the fairway   27 ft 10 in   (9.3 yds)
 *   ~10 handicap, 100-150 yds                30-35 ft      (~10.8 yds)
 *   ~15 handicap, 150 yds                    ~50 ft        (16.7 yds)
 *   ~20 handicap, 100 yds                    roughly 2x tour proximity
 *
 * A SECOND DATASET, AND WHERE IT DISAGREES. GOLFTEC's study of 10,000+ indoor
 * swings — the same conditions this app reads, cleaned the same way by
 * removing the worst mishits — reports 7-iron *depth* dispersion of 36 ft for
 * scratch, 56 ft for an 8 handicap and 90 ft for a 13 handicap. Against each
 * group's own carry distance that is 7.1% / 11.7% / 20.0%, a ratio of
 * 1.00 / 1.66 / 2.83.
 *
 * The proximity line below is flatter than that: it puts the same three levels
 * at 1.00 / 1.32 / 1.52. The two do not reconcile, and pretending otherwise
 * would be dishonest. The likely reason is that on-course proximity compresses
 * at the top — tour players face tucked pins, wind and uneven lies that a bay
 * does not — while a mat exaggerates the gap between a good striker and a poor
 * one. Proximity wins as the anchor because it spans the whole range on the
 * largest dataset in the sport, but the estimate this file produces is
 * reported as a band wide enough to contain both readings, and never as a
 * single confident number.
 *
 * WHY NOT THE "TOUR PLAYERS ARE INSIDE 15 YARDS" FIGURE. It is widely quoted
 * and it is not a 95% band — it cannot be, because it implies a tour 7-iron
 * finishes within 7.5 yards of the centre line 95% of the time, which is
 * tighter than tour proximity data allows even before wind. Quoted dispersion
 * "widths" in golf media are usually a typical or one-sigma spread with no
 * convention stated. Using it as a 95% band, as the first version of this file
 * effectively did, makes every amateur look three times better than they are.
 *
 * ================================ THE CONVERSION ===========================
 *
 * The app measures two independent spreads: `side.mad` and `carry.mad`, both
 * scaled by 1.4826 so they estimate a standard deviation. For a two-axis
 * normal pattern the mean distance from the centre is
 *
 *     E[r] ≈ 1.253 × sqrt((sigmaSide^2 + sigmaCarry^2) / 2)
 *
 * which is exact when the two axes are equal and close enough when they are
 * not. Expressed as a share of carry distance it is comparable across clubs
 * and across players, which is what makes one scale possible at all.
 */

/** Mean radius of a two-axis normal pattern, as a multiple of sigma. */
const MEAN_RADIUS_PER_SIGMA = Math.sqrt(Math.PI / 2);

/**
 * Radial proximity as a percentage of carry distance, at two known skill
 * levels. Tour is placed at -4 rather than 0: a tour card is worth roughly a
 * +4 to +6 course handicap, and pinning it at scratch would compress every
 * amateur into the top of the scale.
 */
const TOUR_HANDICAP = -4;
/** 9.3 yds at ~160 yds carry. */
const TOUR_RADIAL_PCT = 5.8;
/** 16.7 yds at 150 yds carry. */
const FIFTEEN_RADIAL_PCT = 11.1;
const FIFTEEN_HANDICAP = 15;

/** Percentage points of radial spread per handicap stroke. */
const PCT_PER_STROKE =
  (FIFTEEN_RADIAL_PCT - TOUR_RADIAL_PCT) / (FIFTEEN_HANDICAP - TOUR_HANDICAP);

/**
 * The worst level the scale describes. Beyond about 30 the limiting factor
 * stops being the shot pattern and starts being how often a shot comes off at
 * all, which a range session measures badly.
 */
export const SCALE_FLOOR_HANDICAP = 30;

export const FLOOR_RADIAL_PCT =
  TOUR_RADIAL_PCT + (SCALE_FLOOR_HANDICAP - TOUR_HANDICAP) * PCT_PER_STROKE;

/**
 * Lateral-only anchors, derived from the same line.
 *
 * A single axis of an isotropic pattern has sigma = E[r] / 1.253, and the app
 * draws and quotes a 95% width of 4 sigma. So the tour lateral width works out
 * at 18.5% of carry — a 30-yard-wide 7-iron pattern at 160 yards — and the
 * bottom of the scale at 48.7%.
 */
export const TOUR_WIDTH_PCT = (TOUR_RADIAL_PCT / MEAN_RADIUS_PER_SIGMA) * 4;
export const FLOOR_WIDTH_PCT = (FLOOR_RADIAL_PCT / MEAN_RADIUS_PER_SIGMA) * 4;

export interface PatternSpread {
  /** Lateral sigma in yards — the app's `side.mad`. */
  sigmaSide: number;
  /** Carry sigma in yards — the app's `carry.mad`. */
  sigmaCarry: number;
  /** Median carry, to make the spreads relative. */
  carry: number;
}

/** Mean distance from the centre of the pattern, in yards. */
export function meanRadius(spread: PatternSpread): number {
  const { sigmaSide, sigmaCarry } = spread;
  const side = Number.isFinite(sigmaSide) ? sigmaSide : sigmaCarry;
  const depth = Number.isFinite(sigmaCarry) ? sigmaCarry : sigmaSide;
  if (!Number.isFinite(side) || !Number.isFinite(depth)) return Number.NaN;
  return MEAN_RADIUS_PER_SIGMA * Math.sqrt((side * side + depth * depth) / 2);
}

/** Mean radius as a percentage of the carry it was hit over. */
export function radialPercent(spread: PatternSpread): number {
  const r = meanRadius(spread);
  if (!Number.isFinite(r) || !Number.isFinite(spread.carry) || spread.carry <= 0) {
    return Number.NaN;
  }
  return (r / spread.carry) * 100;
}

/**
 * The handicap this shot pattern is typical of.
 *
 * Unclamped at the top on purpose: a pattern tighter than tour should read as
 * a plus handicap rather than being flattened to zero, because a player who
 * gets there deserves to see it.
 */
export function handicapFromPattern(spread: PatternSpread): number {
  const pct = radialPercent(spread);
  if (!Number.isFinite(pct)) return Number.NaN;
  return TOUR_HANDICAP + (pct - TOUR_RADIAL_PCT) / PCT_PER_STROKE;
}

/**
 * Score a lateral pattern 0-100, tour at the top.
 *
 * 100 means the pattern is as tight as a tour player's, and nothing short of
 * that earns it — which is the whole point of scoring against a benchmark
 * rather than against a range that happened to feel achievable.
 */
export function dispersionScore(widthYards: number, carry: number): number {
  if (!Number.isFinite(widthYards) || !Number.isFinite(carry) || carry <= 0) return Number.NaN;
  const pct = (widthYards / carry) * 100;
  const t = (FLOOR_WIDTH_PCT - pct) / (FLOOR_WIDTH_PCT - TOUR_WIDTH_PCT);
  return Math.max(0, Math.min(100, t * 100));
}

/**
 * The lateral 95% width, as a percentage of carry, that a given handicap is
 * typical of. Lets the diagnosis rules state their thresholds in handicaps
 * instead of in invented percentages that drift away from the scale.
 */
export function widthPctForHandicap(handicap: number): number {
  const perStroke =
    (FLOOR_WIDTH_PCT - TOUR_WIDTH_PCT) / (SCALE_FLOOR_HANDICAP - TOUR_HANDICAP);
  return TOUR_WIDTH_PCT + (handicap - TOUR_HANDICAP) * perStroke;
}

/** What a tour-standard pattern would be for this player, in yards. */
export function tourWidthFor(carry: number): number {
  return (TOUR_WIDTH_PCT / 100) * carry;
}

/** Plain-language band for a handicap number, for captions. */
export function skillBand(handicap: number): string {
  if (handicap <= 0) return 'tour and elite amateur territory';
  if (handicap <= 5) return 'low single figures';
  if (handicap <= 10) return 'single figures';
  if (handicap <= 15) return 'mid handicap';
  if (handicap <= 22) return 'high teens to low twenties';
  return 'high handicap';
}
