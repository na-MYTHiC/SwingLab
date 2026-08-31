import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingest } from '../ingest/registry.js';
import { diagnoseSession } from '../diagnose/index.js';
import { PRACTICE_MODES } from './modes.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '../../../../fixtures');

function report(file: string) {
  const text = readFileSync(resolve(fixtures, file), 'utf8');
  const { session } = ingest({ name: file, text }, { handedness: 'right' });
  if (!session) throw new Error(`${file} failed to parse`);
  return diagnoseSession(session);
}

describe('practice prescriptions from a range session', () => {
  const r = report('trackman-session-imperial.csv');

  it('produces a runnable session', () => {
    expect(r.practice.blocks.length).toBeGreaterThan(0);
    expect(r.practice.totalMinutes).toBeGreaterThan(0);
  });

  it('names a real TrackMan mode for every block', () => {
    const known = new Set(Object.keys(PRACTICE_MODES));
    for (const block of r.practice.blocks) {
      expect(known.has(block.mode.id), block.mode.id).toBe(true);
      expect(block.mode.location).toMatch(/TPS|Virtual Golf/);
    }
  });

  it('gives every block concrete setup steps and a pass mark', () => {
    for (const block of r.practice.blocks) {
      expect(block.setup.length, block.id).toBeGreaterThan(1);
      expect(block.success.length, block.id).toBeGreaterThan(10);
      expect(block.rationale.length, block.id).toBeGreaterThan(10);
    }
  });

  it('orders blocks so a change is built before it is measured', () => {
    const stages = r.practice.blocks.map((b) => b.mode.stage);
    const rank = { build: 0, vary: 1, measure: 2, play: 3 };
    for (let i = 1; i < stages.length; i++) {
      expect(rank[stages[i]!]).toBeGreaterThanOrEqual(rank[stages[i - 1]!]);
    }
  });

  it('always finishes on a course, because range numbers flatter everyone', () => {
    expect(r.practice.blocks.at(-1)?.mode.id).toBe('virtual-golf');
  });

  it('uses the player’s own carry numbers for target distances', () => {
    const sevenIron = r.profiles.find((p) => p.club === '7i');
    const withTarget = r.practice.blocks.filter((b) => b.club === '7i' && b.targetDistance !== null);
    for (const block of withTarget) {
      expect(block.targetDistance).toBe(Math.round(sevenIron!.carry.median));
    }
  });

  it('never repeats the same block for two findings — it merges them', () => {
    const ids = r.practice.blocks.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ties each block back to the findings it answers', () => {
    const findingIds = new Set(r.findings.map((f) => f.id));
    for (const block of r.practice.blocks) {
      for (const id of block.addresses) expect(findingIds.has(id)).toBe(true);
    }
  });
});

describe('practice prescriptions when nothing is wrong', () => {
  it('recommends a Combine to get a baseline rather than inventing a fault', () => {
    const { session } = ingest(
      {
        name: 'clean.csv',
        text: [
          'Club,Club Speed [mph],Ball Speed [mph],Smash Factor,Carry [yds],Club Path [deg],Face Angle [deg],Face To Path [deg],Attack Angle [deg],Spin Rate [rpm],Impact Offset [mm],Low Point [in]',
          ...Array.from({ length: 12 }, (_, i) =>
            `7 Iron,82,110.7,1.35,${160 + (i % 2 ? 1 : -1)},0.3,0.2,${i % 2 ? 0.4 : -0.4},-3.1,6800,${i % 2 ? 2 : -2},2.2`,
          ),
        ].join('\n'),
      },
      { handedness: 'right' },
    );
    const r = diagnoseSession(session!);
    expect(r.findings).toHaveLength(0);
    expect(r.practice.blocks.some((b) => b.mode.id === 'combine')).toBe(true);
    expect(r.practice.note).toContain('measurement');
  });
});
