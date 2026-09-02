import { describe, expect, it } from 'vitest';
import { prescribePractice } from './prescribe.js';
import { buildClubProfiles } from '../stats/dispersion.js';
import type { Finding } from '../diagnose/types.js';
import type { Club, Shot } from '../schema.js';

/**
 * Every fault the engine can name must have a training that answers it.
 *
 * This exists because it did not. An audit found seven findings that produced
 * a diagnosis and no practice block — including `dispersion-wide`, so the app
 * would tell a player their pattern was 57 yards wide and then hand them an
 * hour that never mentioned it. Nothing failed; the plan was simply quieter
 * than it should have been, which is the kind of gap that survives for months.
 *
 * WHEN A RULE LEARNS A NEW FINDING, ADD ITS ID HERE. The list is maintained by
 * hand on purpose: deriving it by parsing the rule files would make the test
 * agree with whatever the code happens to do, which is the one thing a
 * coverage test must not do.
 */
const EVERY_FINDING: { id: string; club: Club; evidence?: Finding['evidence'] }[] = [
  { id: 'low-smash-factor', club: '7i' },
  { id: 'below-tour-efficiency', club: '7i' },
  { id: 'driver-negative-aoa', club: 'Dr' },
  { id: 'iron-positive-aoa', club: '7i' },
  { id: 'low-point-behind-ball', club: '7i' },
  { id: 'low-point-inconsistent', club: '7i' },
  { id: 'strike-scattered', club: '7i' },
  { id: 'strike-toe-biased', club: '7i' },
  { id: 'strike-heel-biased', club: '7i' },
  { id: 'high-mishit-rate', club: '7i' },
  { id: 'face-open-to-path', club: '7i' },
  { id: 'face-closed-to-path', club: '7i' },
  { id: 'face-inconsistent', club: '7i' },
  { id: 'path-in-to-out', club: '7i' },
  { id: 'path-out-to-in', club: '7i' },
  { id: 'dispersion-wide', club: '7i' },
  { id: 'dynamic-loft-inconsistent', club: '7i' },
  { id: 'launch-window-wide', club: '7i' },
  { id: 'spin-inconsistent', club: '7i' },
  { id: 'spin-too-high', club: 'Dr' },
  { id: 'spin-too-low', club: '7i' },
  { id: 'carry-inconsistent', club: '7i' },
  { id: 'gap-oversized', club: '7i' },
  { id: 'gap-overlap', club: '7i' },
  { id: 'gap-inverted', club: '7i' },
  { id: 'target-distance-spread', club: '7i' },
  { id: 'target-long-bias', club: '7i' },
  { id: 'target-short-bias', club: '7i' },
  // Needs the evidence its own rule attaches, which names the weak distance.
  {
    id: 'weak-target-distance',
    club: '7i',
    evidence: [{ label: 'Weakest target', value: 150, unit: 'yds' }],
  },
];

function shot(i: number, club: Club): Shot {
  const j = Math.sin(i * 12.9898) * 0.5;
  return {
    id: `s${i}`, source: 'trackman-csv', time: null, club,
    clubSpeed: 87 + j, ballSpeed: 115 + j, smashFactor: 1.32, attackAngle: -3.4 + j,
    clubPath: 0.2 + j, faceAngle: 0.3 + j, faceToPath: 0.1 + j, dynamicLoft: 25 + j,
    spinLoft: 28 + j, lowPointDistance: 3 + j, impactOffset: j, impactHeight: j,
    launchAngle: 17 + j, launchDirection: 0.3, spinRate: 6800, spinAxis: 0,
    carry: 169 + j * 4, total: 178, side: j * 5, curve: 0, apexHeight: 30, landingAngle: 47,
    targetDistance: null, proximity: null, shotScore: null, spinMeasured: true,
    smashIndex: null, spinIndex: null, lowPointSide: null, swingRadius: null,
    dynamicLie: null, flags: [],
  } as Shot;
}

const profiles = buildClubProfiles([
  ...Array.from({ length: 20 }, (_, i) => shot(i, '7i')),
  ...Array.from({ length: 20 }, (_, i) => shot(i, 'Dr')),
]);

function planFor(entry: (typeof EVERY_FINDING)[number]) {
  const finding: Finding = {
    id: entry.id,
    club: entry.club,
    severity: 'major',
    confidence: 'high',
    title: entry.id,
    detail: 'x',
    evidence: entry.evidence ?? [],
    drills: [],
  };
  const plan = prescribePractice([finding], profiles, { duration: 60 });
  return plan.blocks.filter((b) => b.id !== 'rx-warmup' && b.id !== 'rx-shot-analysis');
}

describe('practice coverage', () => {
  it.each(EVERY_FINDING)('has a training for $id', (entry) => {
    const work = planFor(entry);
    expect(work.length, `no practice block answers "${entry.id}"`).toBeGreaterThan(0);
  });

  it('gives every block something to say and something to measure', () => {
    for (const entry of EVERY_FINDING) {
      const block = planFor(entry)[0];
      if (!block) continue;
      expect(block.title.length, entry.id).toBeGreaterThan(8);
      expect(block.rationale.length, entry.id).toBeGreaterThan(40);
      expect(block.setup.length, entry.id).toBeGreaterThanOrEqual(3);
      expect(block.success.length, entry.id).toBeGreaterThan(20);
      expect(block.minutes, entry.id).toBeGreaterThan(0);
    }
  });

  it('treats delivered loft, launch and spin as one fault, not three', () => {
    /*
     * They are one fault read off three instruments: loft at impact drives
     * launch, and the two together drive spin. Three separate blocks would
     * spend an hour practising the same thing and call it variety.
     */
    const ids = ['dynamic-loft-inconsistent', 'launch-window-wide', 'spin-inconsistent']
      .map((id) => planFor({ id, club: '7i' })[0]?.id);
    expect(new Set(ids).size).toBe(1);
  });

  it('answers a wide pattern directly rather than only its causes', () => {
    const block = planFor({ id: 'dispersion-wide', club: '7i' })[0];
    expect(block).toBeDefined();
    expect(block!.drills.length).toBeGreaterThan(0);
  });
});
