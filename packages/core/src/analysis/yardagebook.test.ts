import { describe, expect, it } from 'vitest';
import { buildYardageBook, yardageAdvice } from './yardagebook.js';
import { parseConditions } from '../benchmarks/conditions.js';
import { markImplausible, markMishits, markUnusable } from '../stats/outliers.js';
import type { Club, Shot } from '../schema.js';

let seq = 0;
function shot(over: Partial<Shot> = {}): Shot {
  seq += 1;
  return {
    id: `s${seq}`, source: 'trackman-csv', time: null, sequence: seq, club: '7i',
    clubSpeed: 87, ballSpeed: 115, smashFactor: 1.32, attackAngle: -3.4, clubPath: 0.2,
    faceAngle: 0.3, faceToPath: 0.1, dynamicLoft: 25, spinLoft: 28, lowPointDistance: 3,
    impactOffset: null, impactHeight: null, launchAngle: 17, launchDirection: 0.3,
    spinRate: 6800, spinAxis: 0, carry: 165, total: 174, side: 0, curve: 0,
    apexHeight: 30, landingAngle: 47, targetDistance: null, proximity: null, shotScore: null,
    spinMeasured: true, smashIndex: null, spinIndex: null,
    lowPointSide: null, swingRadius: null, dynamicLie: null, flags: [],
    ...over,
  } as Shot;
}

/** Carries laid out evenly so the percentiles are checkable by hand. */
function ladder(club: Club, carries: number[], sides: number[] = []): Shot[] {
  return carries.map((carry, i) => shot({ club, carry, side: sides[i] ?? 0 }));
}

describe('yardage book', () => {
  it('clubs off the number you beat four times in five, not the best one', () => {
    // 20 shots from 150 to 169. p20 lands at 153.8, p90 at 167.1.
    const carries = Array.from({ length: 20 }, (_, i) => 150 + i);
    const book = buildYardageBook(ladder('7i', carries));
    const seven = book.clubs.find((c) => c.club === '7i')!;

    expect(seven.plays).toBeLessThan(seven.typical);
    expect(seven.typical).toBeLessThan(seven.flushed);
    expect(seven.plays).toBe(154);
    expect(seven.flushed).toBe(167);
    expect(seven.egoGap).toBe(13);
  });

  it('aims the pattern back at the target rather than at its centre', () => {
    // Every shot 8 yards right: aim 8 left.
    const book = buildYardageBook(
      ladder('7i', Array(12).fill(165), Array(12).fill(8)),
    );
    const seven = book.clubs.find((c) => c.club === '7i')!;
    expect(seven.aimSide).toBe('left');
    expect(seven.aimYards).toBeCloseTo(-8, 1);
    // 8 yards at 165 carry is 2.8 degrees.
    expect(Math.abs(seven.aimDegrees)).toBeCloseTo(2.8, 1);
  });

  it('does not ask a player to re-aim for less than half a degree', () => {
    const book = buildYardageBook(ladder('7i', Array(12).fill(165), Array(12).fill(0.9)));
    expect(book.clubs.find((c) => c.club === '7i')!.aimSide).toBe('straight');
  });

  it('measures the miss around the pattern centre, not around the target', () => {
    // Centred 10 right, spilling a further 12 right and only 3 left. Aiming
    // fixes the 10; the room to leave is the 12.
    const sides = [10, 10, 10, 10, 22, 21, 20, 7, 8, 9, 10, 10];
    const book = buildYardageBook(ladder('7i', Array(12).fill(165), sides));
    const seven = book.clubs.find((c) => c.club === '7i')!;
    expect(seven.aimSide).toBe('left');
    expect(seven.missSide).toBe('right');
    expect(seven.missYards).toBeGreaterThanOrEqual(9);
    expect(seven.missYards).toBeLessThan(20);
  });

  it('keeps mishits in the number, because the course does not discard them', () => {
    const good = Array(16).fill(165);
    const fat = [128, 131, 134, 137];
    const shots = ladder('7i', [...good, ...fat]);
    markImplausible(shots);
    markUnusable(shots);
    markMishits(shots);
    // The engine should have flagged the short ones — that is what makes this
    // test meaningful rather than tautological.
    expect(shots.filter((s) => s.flags.includes('mishit')).length).toBeGreaterThan(0);

    const withMishits = buildYardageBook(shots).clubs.find((c) => c.club === '7i')!;
    const cleanOnly = buildYardageBook(ladder('7i', good)).clubs.find((c) => c.club === '7i')!;
    expect(withMishits.plays).toBeLessThan(cleanOnly.plays);
  });

  it('drops rows the radar misread', () => {
    const shots = ladder('7i', Array(12).fill(165));
    shots.push(shot({ club: '7i', carry: 4200 }));
    markImplausible(shots);
    const seven = buildYardageBook(shots).clubs.find((c) => c.club === '7i')!;
    expect(seven.shots).toBe(12);
    expect(seven.flushed).toBeLessThan(200);
  });

  it('refuses a number for a club played to distances somebody else chose', () => {
    const shots = [
      ...ladder('pw', Array(6).fill(60)).map((s) => ({ ...s, targetDistance: 60 })),
      ...ladder('pw', Array(6).fill(90)).map((s) => ({ ...s, targetDistance: 90 })),
    ] as Shot[];
    const book = buildYardageBook(shots);
    expect(book.clubs.find((c) => c.club === 'pw')).toBeUndefined();
    expect(book.omitted.find((o) => o.club === 'pw')?.reason).toContain('played to set distances');
  });

  it('refuses even a single prescribed target — a Combine 9-iron is not a full 9-iron', () => {
    const shots = ladder('9i', [104, 106, 103, 105, 107, 104]).map(
      (s) => ({ ...s, targetDistance: 105 }),
    ) as Shot[];
    const book = buildYardageBook(shots);
    expect(book.clubs).toHaveLength(0);
    expect(book.omitted[0]?.reason).toContain('describes the drill');
  });

  it('catches a ladder from carry spread when no target was recorded', () => {
    const book = buildYardageBook(ladder('pw', [58, 62, 66, 74, 82, 88, 92, 96]));
    expect(book.clubs.find((c) => c.club === 'pw')).toBeUndefined();
  });

  it('refuses a number from too few swings', () => {
    const book = buildYardageBook(ladder('7i', [165, 166, 164]));
    expect(book.clubs).toHaveLength(0);
    expect(book.omitted[0]?.reason).toContain('3 shots');
  });

  it('gaps adjacent clubs only, off the playing numbers', () => {
    const book = buildYardageBook([
      ...ladder('6i', Array(12).fill(178)),
      ...ladder('7i', Array(12).fill(165)),
      // 9i with no 8i between it and the 7i: not an adjacent pair.
      ...ladder('9i', Array(12).fill(140)),
    ]);
    expect(book.gaps).toHaveLength(1);
    expect(book.gaps[0]).toMatchObject({ longer: '6i', shorter: '7i' });
    expect(book.gaps[0]!.gap).toBe(13);
  });

  it('reports the sea-level number when the venue was not at sea level', () => {
    const conditions = parseConditions('Altitude: 4700 ft, Temperature: 77 F, Ball: Premium');
    const book = buildYardageBook(ladder('7i', Array(12).fill(165)), conditions);
    const seven = book.clubs.find((c) => c.club === '7i')!;
    expect(seven.playsAtSeaLevel).not.toBeNull();
    // Thin air flatters the number, so it plays shorter at sea level.
    expect(seven.playsAtSeaLevel!).toBeLessThan(seven.plays);
    expect(book.conditionsNote).toContain('sea-level');
  });

  it('says nothing about the air when the correction is a no-op', () => {
    const conditions = parseConditions('Altitude: 0 ft, Temperature: 70 F, Ball: Premium');
    const book = buildYardageBook(ladder('7i', Array(12).fill(165)), conditions);
    expect(book.conditionsNote).toBeNull();
    // The column is still computed; it just is not worth a sentence.
    expect(book.clubs[0]!.playsAtSeaLevel).toBe(book.clubs[0]!.plays);
  });

  it('grades its own confidence by how much it saw', () => {
    const thin = buildYardageBook(ladder('7i', [160, 162, 164, 166, 168, 170]));
    expect(thin.clubs[0]!.confidence).toBe('rough');
    const firm = buildYardageBook(ladder('7i', Array(14).fill(165)));
    expect(firm.clubs[0]!.confidence).toBe('firm');
  });

  it('speaks in the words a player uses over the ball', () => {
    const sides = [10, 10, 10, 10, 22, 21, 20, 7, 8, 9, 10, 10];
    const carries = Array.from({ length: 12 }, (_, i) => 158 + i);
    const book = buildYardageBook(ladder('7i', carries, sides));
    const line = yardageAdvice(book.clubs[0]!);
    expect(line).toMatch(/Club it as \d+, not \d+\./);
    expect(line).toContain('left of the flag');
    expect(line).toContain('room right');
  });
});
