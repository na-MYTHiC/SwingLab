import { describe, expect, it } from 'vitest';
import { diagnoseShots, evaluateAchievements } from '../index.js';
import type { Shot } from '../schema.js';

/** A tidy, repeatable 7-iron session with enough shots to judge. */
function session(over: Partial<Shot> = {}, n = 30): Shot[] {
  return Array.from({ length: n }, (_, i) => {
    // Deterministic wobble, so the fixture cannot drift between runs.
    const j = Math.sin(i * 12.9898) * 0.5;
    return {
      id: `s${i}`,
      source: 'trackman-csv' as const,
      time: new Date(2026, 0, 1, 10, i),
      club: '7i' as const,
      clubSpeed: 87 + j,
      ballSpeed: 115 + j * 1.4,
      smashFactor: 1.33 + j * 0.004,
      attackAngle: -3.4 + j,
      clubPath: 0.2 + j,
      faceAngle: 0.3 + j * 0.8,
      faceToPath: 0.1 + j * 0.5,
      dynamicLoft: 25 + j,
      spinLoft: 28 + j,
      lowPointDistance: 3 + j * 0.6,
      impactOffset: j * 2,
      impactHeight: j * 2,
      launchAngle: 17 + j,
      launchDirection: 0.3 + j,
      spinRate: 6800 + j * 200,
      spinAxis: j * 2,
      carry: 169 + j * 4,
      total: 178 + j * 4,
      side: j * 5,
      curve: j * 3,
      apexHeight: 30 + j,
      landingAngle: 47 + j,
      targetDistance: null,
      proximity: null,
      shotScore: null,
      spinMeasured: true,
      lowPointSide: null,
      swingRadius: null,
      dynamicLie: null,
      flags: [],
      ...over,
    } as Shot;
  });
}

describe('milestones', () => {
  it('measures the handicap milestones, which need the handicap to exist first', () => {
    /*
     * The bug this exists to prevent: `report.handicap` was assigned *after*
     * `evaluateAchievements(report)` ran, so both handicap milestones saw
     * null and were silently dropped from every report ever produced. A
     * measure returning null means "not applicable to this session", so
     * nothing failed loudly — they simply never appeared.
     */
    const report = diagnoseShots(session());
    expect(report.handicap).not.toBeNull();
    const ids = report.achievements.map((a) => a.id);
    expect(ids).toContain('single-figures');
    expect(ids).toContain('scratch-striker');
  });

  it('earns the tight ones on a tidy session and not on a scattered one', () => {
    const tidy = diagnoseShots(session());
    const scattered = diagnoseShots(
      session().map((s, i) => ({
        ...s,
        side: (i % 2 === 0 ? 1 : -1) * (14 + (i % 7) * 3),
        carry: 169 + (i % 2 === 0 ? 1 : -1) * (16 + (i % 5) * 3),
      })),
    );

    const earned = (r: typeof tidy, id: string) =>
      r.achievements.find((a) => a.id === id)?.earned ?? false;

    expect(earned(tidy, 'distance-control')).toBe(true);
    expect(earned(scattered, 'distance-control')).toBe(false);
    expect(earned(scattered, 'tight-pattern')).toBe(false);
  });

  it('never rewards volume — twice the balls is not a milestone', () => {
    const short = diagnoseShots(session({}, 20));
    const long = diagnoseShots(session({}, 60));
    const names = (r: typeof short) =>
      r.achievements.filter((a) => a.earned).map((a) => a.id).sort();
    expect(names(long)).toEqual(names(short));
  });

  it('orders earned first, then whatever is closest', () => {
    const list = diagnoseShots(session()).achievements;
    const firstUnearned = list.findIndex((a) => !a.earned);
    if (firstUnearned > 0) {
      expect(list.slice(0, firstUnearned).every((a) => a.earned)).toBe(true);
    }
    const rest = list.slice(Math.max(firstUnearned, 0));
    for (let i = 1; i < rest.length; i += 1) {
      expect((rest[i] as { progress: number }).progress)
        .toBeLessThanOrEqual((rest[i - 1] as { progress: number }).progress);
    }
  });

  it('drops a milestone it cannot measure rather than scoring it zero', () => {
    // No club data at all: strike and delivery milestones are unmeasurable and
    // must be absent, not present-and-failed.
    const blind = diagnoseShots(
      session().map((s) => ({ ...s, faceAngle: null, lowPointDistance: null })),
    );
    const ids = blind.achievements.map((a) => a.id);
    expect(ids).not.toContain('square-face');
    expect(ids).not.toContain('low-point-control');
  });

  it('covers every dimension the engine can see', () => {
    const ids = new Set(evaluateAchievements(diagnoseShots(session())).map((a) => a.id));
    for (const id of ['clean-contact', 'distance-control', 'graded-a', 'full-bag']) {
      expect(ids).toContain(id);
    }
  });
});
