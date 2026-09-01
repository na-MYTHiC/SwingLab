import type { Club } from '../schema.js';

/**
 * TrackMan PGA and LPGA Tour averages, and how to compare an amateur to them
 * fairly.
 *
 * THE PROBLEM WITH RAW TOUR COMPARISON. A tour player swings a 7-iron at
 * 92 mph. Telling someone who swings it at 80 that they are 24 yards short is
 * true and useless — they are not short because they strike it badly, they
 * are short because they swing it slower, and no amount of practice changes
 * that this week.
 *
 * So the numbers here split into two kinds:
 *
 *   - **Speed-independent**: smash factor, attack angle, launch angle, spin.
 *     Ratios and delivery angles that a 75 mph player can match exactly. These
 *     are compared directly, and they are where the coaching actually lives.
 *   - **Speed-dependent**: ball speed, carry, height. Compared only after
 *     scaling to the player's own club speed — see `speedAdjusted` below.
 *
 * PROVENANCE. TrackMan's published PGA and LPGA Tour averages, 2023 tables.
 * Ball speed is derived as club speed × smash factor rather than transcribed:
 * the two agree to within rounding everywhere, and deriving it keeps the table
 * internally consistent by construction rather than by luck.
 */

export const TOUR_TABLE_REVISED_AT = '2023';
export const TOUR_TABLE_SOURCE = 'TrackMan published PGA and LPGA Tour averages, 2023.';

export interface TourRow {
  clubSpeed: number;
  attackAngle: number;
  smashFactor: number;
  launchAngle: number;
  spinRate: number;
  /** Apex, feet. Published in yards; converted here to match the schema. */
  apexHeight: number;
  landingAngle: number;
  carry: number;
}

/** Ball speed is always club speed × smash, never stored separately. */
export function tourBallSpeed(row: TourRow): number {
  return row.clubSpeed * row.smashFactor;
}

const PGA: Partial<Record<Club, TourRow>> = {
  Dr:   { clubSpeed: 115, attackAngle: -0.9, smashFactor: 1.49, launchAngle: 10.4, spinRate: 2545, apexHeight: 105, landingAngle: 39, carry: 282 },
  '3w': { clubSpeed: 110, attackAngle: -2.3, smashFactor: 1.47, launchAngle: 9.3,  spinRate: 3663, apexHeight: 96,  landingAngle: 44, carry: 249 },
  '5w': { clubSpeed: 106, attackAngle: -2.5, smashFactor: 1.47, launchAngle: 9.7,  spinRate: 4322, apexHeight: 99,  landingAngle: 48, carry: 236 },
  '3h': { clubSpeed: 102, attackAngle: -2.4, smashFactor: 1.47, launchAngle: 10.2, spinRate: 4587, apexHeight: 93,  landingAngle: 49, carry: 231 },
  '3i': { clubSpeed: 100, attackAngle: -2.5, smashFactor: 1.46, launchAngle: 10.3, spinRate: 4404, apexHeight: 90,  landingAngle: 48, carry: 218 },
  '4i': { clubSpeed: 98,  attackAngle: -2.9, smashFactor: 1.44, launchAngle: 10.8, spinRate: 4782, apexHeight: 93,  landingAngle: 49, carry: 209 },
  '5i': { clubSpeed: 96,  attackAngle: -3.4, smashFactor: 1.41, launchAngle: 11.9, spinRate: 5280, apexHeight: 99,  landingAngle: 50, carry: 199 },
  '6i': { clubSpeed: 94,  attackAngle: -3.7, smashFactor: 1.39, launchAngle: 14.0, spinRate: 6204, apexHeight: 96,  landingAngle: 50, carry: 188 },
  '7i': { clubSpeed: 92,  attackAngle: -3.9, smashFactor: 1.34, launchAngle: 16.1, spinRate: 7124, apexHeight: 102, landingAngle: 51, carry: 176 },
  '8i': { clubSpeed: 89,  attackAngle: -4.2, smashFactor: 1.33, launchAngle: 17.8, spinRate: 8078, apexHeight: 99,  landingAngle: 51, carry: 164 },
  '9i': { clubSpeed: 87,  attackAngle: -4.3, smashFactor: 1.29, launchAngle: 20.0, spinRate: 8793, apexHeight: 96,  landingAngle: 52, carry: 152 },
  PW:   { clubSpeed: 84,  attackAngle: -4.7, smashFactor: 1.24, launchAngle: 23.7, spinRate: 9316, apexHeight: 96,  landingAngle: 52, carry: 142 },
};

const LPGA: Partial<Record<Club, TourRow>> = {
  Dr:   { clubSpeed: 96, attackAngle: 2.8,  smashFactor: 1.49, launchAngle: 12.6, spinRate: 2506, apexHeight: 78, landingAngle: 36, carry: 223 },
  '3w': { clubSpeed: 92, attackAngle: -0.8, smashFactor: 1.47, launchAngle: 11.6, spinRate: 2595, apexHeight: 75, landingAngle: 38, carry: 200 },
  '5w': { clubSpeed: 90, attackAngle: -1.6, smashFactor: 1.46, launchAngle: 12.3, spinRate: 4320, apexHeight: 75, landingAngle: 43, carry: 189 },
  '3h': { clubSpeed: 87, attackAngle: -1.9, smashFactor: 1.44, launchAngle: 13.9, spinRate: 4504, apexHeight: 75, landingAngle: 45, carry: 178 },
  '4i': { clubSpeed: 82, attackAngle: -1.7, smashFactor: 1.43, launchAngle: 13.9, spinRate: 4608, apexHeight: 75, landingAngle: 43, carry: 175 },
  '5i': { clubSpeed: 81, attackAngle: -2.0, smashFactor: 1.42, launchAngle: 14.6, spinRate: 4966, apexHeight: 75, landingAngle: 45, carry: 166 },
  '6i': { clubSpeed: 80, attackAngle: -2.3, smashFactor: 1.41, launchAngle: 16.7, spinRate: 5904, apexHeight: 75, landingAngle: 46, carry: 155 },
  '7i': { clubSpeed: 78, attackAngle: -2.5, smashFactor: 1.38, launchAngle: 18.5, spinRate: 6630, apexHeight: 78, landingAngle: 47, carry: 143 },
  '8i': { clubSpeed: 76, attackAngle: -2.8, smashFactor: 1.36, launchAngle: 20.8, spinRate: 7413, apexHeight: 81, landingAngle: 47, carry: 133 },
  '9i': { clubSpeed: 74, attackAngle: -3.2, smashFactor: 1.30, launchAngle: 23.5, spinRate: 7605, apexHeight: 81, landingAngle: 48, carry: 123 },
  PW:   { clubSpeed: 72, attackAngle: -3.2, smashFactor: 1.25, launchAngle: 25.2, spinRate: 8465, apexHeight: 81, landingAngle: 48, carry: 111 },
};

export type TourSet = 'pga' | 'lpga';

export function tourRow(club: Club, set: TourSet = 'pga'): TourRow | null {
  return (set === 'pga' ? PGA : LPGA)[club] ?? null;
}

/**
 * What tour-quality *striking* would produce at the player's own club speed.
 *
 * This is the fair comparison, and it is the one that turns a benchmark into
 * something actionable. Ball speed scales with club speed for a given
 * efficiency, and carry scales with ball speed closely enough over the range
 * amateurs actually occupy. What comes back is not "how far a tour player
 * hits it" but "how far *you* would hit it if you found the middle as often
 * as they do" — a number the player can genuinely go and claim.
 *
 * Accuracy falls away at the extremes, since launch and spin stop being
 * optimal a long way from the reference speed. Treat a gap under about 5%
 * as noise rather than a finding.
 */
export interface SpeedAdjusted {
  club: Club;
  /** The player's own median club speed, mph. */
  clubSpeed: number;
  tourClubSpeed: number;
  /** Ball speed a tour-quality strike would produce at this club speed. */
  expectedBallSpeed: number;
  /** Carry that ball speed would produce. */
  expectedCarry: number;
  /** Player's smash as a share of tour smash. 1.0 means tour-level striking. */
  efficiency: number;
  /** Yards between the player's carry and the speed-adjusted expectation. */
  carryGap: number;
  /** Ball speed left on the table at the player's current club speed, mph. */
  ballSpeedGap: number;
}

export function speedAdjusted(
  club: Club,
  playerClubSpeed: number,
  playerSmash: number,
  playerCarry: number,
  set: TourSet = 'pga',
): SpeedAdjusted | null {
  const row = tourRow(club, set);
  if (!row || !Number.isFinite(playerClubSpeed) || playerClubSpeed <= 0) return null;

  const expectedBallSpeed = playerClubSpeed * row.smashFactor;
  const expectedCarry = row.carry * (playerClubSpeed / row.clubSpeed);
  const playerBallSpeed = playerClubSpeed * playerSmash;

  return {
    club,
    clubSpeed: playerClubSpeed,
    tourClubSpeed: row.clubSpeed,
    expectedBallSpeed,
    expectedCarry,
    efficiency: Number.isFinite(playerSmash) ? playerSmash / row.smashFactor : Number.NaN,
    carryGap: Number.isFinite(playerCarry) ? playerCarry - expectedCarry : Number.NaN,
    ballSpeedGap: Number.isFinite(playerSmash) ? expectedBallSpeed - playerBallSpeed : Number.NaN,
  };
}

/**
 * Realistic smash ceilings, taken from the tour table where one exists.
 *
 * Smash is a ratio, so it is the one headline number an amateur can match
 * outright — a well-struck 7-iron returns about 1.34 whether it is swung at
 * 92 mph or 75. That makes it the fairest single measure of strike quality
 * there is, and the reason the strike rules lean on it.
 */
export const SMASH_CEILING: Partial<Record<Club, number>> = {
  Dr: 1.49, '2w': 1.48, '3w': 1.47, '4w': 1.47, '5w': 1.47, '7w': 1.46,
  '2h': 1.47, '3h': 1.47, '4h': 1.46, '5h': 1.45, '6h': 1.44,
  '1i': 1.47, '2i': 1.46, '3i': 1.46, '4i': 1.44, '5i': 1.41,
  '6i': 1.39, '7i': 1.34, '8i': 1.33, '9i': 1.29,
  PW: 1.24, GW: 1.21, SW: 1.17, LW: 1.12,
};

/**
 * Spin windows that indicate a real problem, in rpm.
 *
 * Wide on purpose. Optimal spin depends on club speed, launch angle and ball,
 * so these are "this is costing you distance or control" boundaries rather
 * than optimisation targets. Anchored on the tour figures with generous room
 * either side, since a slower swing legitimately spins a little less.
 */
export const SPIN_WINDOW: Partial<Record<Club, [number, number]>> = {
  Dr: [1800, 3400],
  '3w': [2600, 4800],
  '5w': [3200, 5600],
  '5i': [3800, 6800],
  '6i': [4500, 7600],
  '7i': [5200, 8600],
  '8i': [6000, 9600],
  '9i': [6800, 10400],
  PW: [7500, 11200],
};
