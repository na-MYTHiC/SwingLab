import { describe, expect, it } from 'vitest';
import type { Shot, ShotSession } from '../schema.js';
import { buildTrends, trendableClubs } from './trends.js';

function shot(over: Partial<Shot>): Shot {
  return {
    id: Math.random().toString(36).slice(2),
    source: 'manual', time: null, sequence: 1, club: '7i', rawClub: '7 Iron',
    clubSpeed: 82, attackAngle: -3, clubPath: 0, faceAngle: 0, faceToPath: 0,
    dynamicLoft: 27, spinLoft: 30, swingPlane: null, swingDirection: null,
    lowPointDistance: 2, impactOffset: 0, impactHeight: 0,
    ballSpeed: 110.7, smashFactor: 1.35, launchAngle: 17, launchDirection: 0,
    spinRate: 6800, spinAxis: 0,
    carry: 160, total: 164, side: 0, sideTotal: 0, curve: 0,
    apexHeight: 90, landingAngle: 45, hangTime: 6,
    targetDistance: null, proximity: null, shotScore: null,
    flags: [], ...over,
  };
}

function session(day: number, over: Partial<Shot>): ShotSession {
  return {
    id: `s${day}`,
    source: 'manual',
    kind: 'range',
    sourceRef: `s${day}.csv`,
    handedness: 'right',
    startedAt: new Date(2026, 0, day),
    shots: Array.from({ length: 10 }, (_, i) =>
      shot({ sequence: i + 1, ...over, carry: (over.carry ?? 160) + (i % 2 ? 1 : -1) }),
    ),
  };
}

describe('trends across sessions', () => {
  it('needs several sessions before it will say anything', () => {
    const two = [session(1, {}), session(2, {})];
    expect(buildTrends(two, '7i')).toHaveLength(0);
  });

  it('detects a real improvement in face to path', () => {
    const sessions = [
      session(1, { faceToPath: 5 }),
      session(2, { faceToPath: 4.5 }),
      session(3, { faceToPath: 1 }),
      session(4, { faceToPath: 0.5 }),
    ];
    const trend = buildTrends(sessions, '7i').find((t) => t.metric === 'faceToPath');
    expect(trend).toBeDefined();
    expect(trend?.significant).toBe(true);
    expect(trend?.improving).toBe(true);
  });

  it('knows that lower is better for spread and higher is better for carry', () => {
    const improvingSpread = [
      session(1, { carry: 160 }),
      session(2, { carry: 160 }),
      session(3, { carry: 175 }),
      session(4, { carry: 178 }),
    ];
    const carry = buildTrends(improvingSpread, '7i').find((t) => t.metric === 'carry');
    expect(carry?.improving).toBe(true);

    const worseningSpin = [
      session(1, { spinRate: 6000 }),
      session(2, { spinRate: 6100 }),
      session(3, { spinRate: 7400 }),
      session(4, { spinRate: 7500 }),
    ];
    const spin = buildTrends(worseningSpin, '7i').find((t) => t.metric === 'spinRate');
    expect(spin?.improving).toBe(false);
  });

  it('does not call a change significant when it is smaller than the noise', () => {
    const sessions = [
      session(1, { clubPath: 2.0 }),
      session(2, { clubPath: 2.1 }),
      session(3, { clubPath: 1.9 }),
      session(4, { clubPath: 2.0 }),
    ];
    const trend = buildTrends(sessions, '7i').find((t) => t.metric === 'clubPath');
    expect(trend?.significant).toBe(false);
  });

  it('treats a face-to-path move toward zero as improvement from either side', () => {
    const fromClosed = [
      session(1, { faceToPath: -6 }),
      session(2, { faceToPath: -5.5 }),
      session(3, { faceToPath: -1 }),
      session(4, { faceToPath: -0.5 }),
    ];
    const trend = buildTrends(fromClosed, '7i').find((t) => t.metric === 'faceToPath');
    expect(trend?.improving).toBe(true);
  });

  it('does not mutate the sessions it reads', () => {
    const sessions = [session(1, {}), session(2, {}), session(3, {})];
    buildTrends(sessions, '7i');
    for (const s of sessions) {
      for (const shot of s.shots) expect(shot.flags).toEqual([]);
    }
  });

  it('lists only clubs that appear in enough sessions', () => {
    const sessions = [
      session(1, { club: '7i' }),
      session(2, { club: '7i' }),
      session(3, { club: '7i' }),
      session(4, { club: 'Dr' }),
    ];
    const clubs = trendableClubs(sessions);
    expect(clubs).toContain('7i');
    expect(clubs).not.toContain('Dr');
  });
});
