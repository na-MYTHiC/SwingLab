import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingest } from '../ingest/registry.js';
import { diagnoseSession } from './index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '../../../../fixtures');

const text = readFileSync(resolve(fixtures, 'trackman-combine.csv'), 'utf8');
const { session } = ingest({ name: 'trackman-combine.csv', text }, { handedness: 'right' });
const report = diagnoseSession(session!);

describe('a Combine export', () => {
  it('is recognised as a Combine, not a range session', () => {
    expect(report.kind).toBe('combine');
    expect(report.mode?.id).toBe('combine');
  });

  it('reads all 60 shots', () => {
    expect(report.shotCount).toBe(60);
  });

  it('catches the systematic short bias that proximity alone would hide', () => {
    // Proximity is unsigned — 7 short and 7 long both read as "7 away".
    // Only the signed carry-vs-target error exposes a calibration problem.
    const f = report.findings.find((x) => x.id === 'target-short-bias');
    expect(f, 'expected a short-bias finding').toBeDefined();
    const bias = f?.evidence.find((e) => e.label === 'Distance bias');
    expect(bias?.value).toBeLessThan(0);
    expect(Math.abs(bias!.value)).toBeGreaterThan(4);
  });

  it('identifies which target distance is costing the most', () => {
    const f = report.findings.find((x) => x.id === 'weak-target-distance');
    expect(f, 'expected a weak-distance finding').toBeDefined();
    expect(f?.evidence.find((e) => e.label === 'Weakest target')?.value).toBe(160);
  });

  it('turns the weak distance into a Test Center block', () => {
    const ids = report.practice.blocks.map((b) => b.mode.id);
    expect(ids).toContain('test-center');
  });
});

describe('distance bias needs signed error, not proximity', () => {
  function build(errors: number[]): string {
    return [
      'Club,Target [yds],Carry [yds],Club Speed [mph],Ball Speed [mph],Smash Factor',
      ...errors.map((e) => `8 Iron,150,${150 + e},81,106,1.31`),
    ].join('\n');
  }

  it('reports nothing when misses cancel out', () => {
    // Scattered but centred: a spread problem, not a calibration one.
    const errors = [-9, 9, -8, 8, -7, 7, -9, 9, -8, 8];
    const { session } = ingest({ name: 'a.csv', text: build(errors) }, { handedness: 'right' });
    const r = diagnoseSession(session!);
    expect(r.findings.some((f) => f.id.endsWith('-bias'))).toBe(false);
    expect(r.findings.some((f) => f.id === 'target-distance-spread')).toBe(true);
  });

  it('reports a bias when every miss is the same direction', () => {
    const errors = [-8, -7, -9, -6, -8, -7, -9, -8, -7, -8];
    const { session } = ingest({ name: 'b.csv', text: build(errors) }, { handedness: 'right' });
    const r = diagnoseSession(session!);
    expect(r.findings.some((f) => f.id === 'target-short-bias')).toBe(true);
  });
});

describe('naming a weakest distance requires real separation', () => {
  function testAt(targets: [number, number][]): ReturnType<typeof diagnoseSession> {
    // targets: [distance, carry error] — six shots at each, as a Combine gives.
    const rows = targets.flatMap(([d, err]) =>
      Array.from({ length: 6 }, (_, i) => {
        const carry = d + err + (i % 2 ? 1 : -1);
        const prox = Math.abs(carry - d);
        return `8 Iron,${d},${carry},81,106,1.31,${prox.toFixed(1)},${Math.max(0, 100 - prox * 3.2).toFixed(0)}`;
      }),
    );
    const text = [
      'Club,Target [yds],Carry [yds],Club Speed [mph],Ball Speed [mph],Smash Factor,Distance To Pin [yds],Score',
      ...rows,
    ].join('\n');
    const { session } = ingest({ name: 't.csv', text }, { handedness: 'right' });
    return diagnoseSession(session!);
  }

  it('stays quiet when every distance scores about the same', () => {
    // Nothing here is meaningfully worse than anything else, so naming a
    // "weakest" distance would send the player to practise noise.
    const r = testAt([[80, 3], [100, -3], [120, 3], [140, -3], [160, 3]]);
    expect(r.findings.some((f) => f.id === 'weak-target-distance')).toBe(false);
  });

  it('names the distance when one is clearly worse than the rest', () => {
    const r = testAt([[80, 2], [100, -2], [120, 2], [140, -2], [160, 26]]);
    const f = r.findings.find((x) => x.id === 'weak-target-distance');
    expect(f).toBeDefined();
    expect(f?.evidence.find((e) => e.label === 'Weakest target')?.value).toBe(160);
  });
});
