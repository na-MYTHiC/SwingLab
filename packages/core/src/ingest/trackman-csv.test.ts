import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trackmanCsvAdapter } from './trackman-csv.js';
import { ingest } from './registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '../../../../fixtures');

function load(name: string) {
  return { name, text: readFileSync(resolve(fixtures, name), 'utf8') };
}

describe('TrackMan CSV ingest — imperial export', () => {
  const input = load('trackman-session-imperial.csv');

  it('recognises the file', () => {
    expect(trackmanCsvAdapter.canParse(input)).toBe(true);
  });

  it('skips the preamble and finds the real header row', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    expect(session).not.toBeNull();
    expect(session?.shots).toHaveLength(46);
  });

  it('normalises club labels', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    const clubs = new Set(session?.shots.map((s) => s.club));
    expect(clubs).toEqual(new Set(['Dr', '5i', '7i', 'PW']));
  });

  it('keeps the raw club label for provenance', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    const sevenIron = session?.shots.find((s) => s.club === '7i');
    expect(sevenIron?.rawClub).toBe('7 Iron');
  });

  it('parses timestamps from an unambiguous ISO date', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    expect(session?.startedAt?.getFullYear()).toBe(2026);
    expect(session?.startedAt?.getMonth()).toBe(7); // August
    expect(session?.startedAt?.getDate()).toBe(24);
  });

  it('reads values into canonical units', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    const driver = session?.shots.filter((s) => s.club === 'Dr') ?? [];
    for (const shot of driver) {
      expect(shot.clubSpeed).toBeGreaterThan(90);
      expect(shot.clubSpeed).toBeLessThan(110);
      expect(shot.carry).toBeGreaterThan(180);
      expect(shot.carry).toBeLessThan(280);
    }
  });
});

describe('TrackMan CSV ingest — metric, semicolon, comma decimals', () => {
  const input = load('trackman-session-metric.csv');

  it('parses a European-locale export into the same canonical units', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    expect(session).not.toBeNull();
    expect(session?.shots).toHaveLength(6);

    const first = session?.shots[0];
    // 132.0 kph -> mph
    expect(first?.clubSpeed).toBeCloseTo(82.02, 1);
    // 144.2 m -> yards
    expect(first?.carry).toBeCloseTo(157.7, 0);
    // 25.4 m apex -> feet
    expect(first?.apexHeight).toBeCloseTo(83.3, 0);
    // 5.6 cm low point -> inches
    expect(first?.lowPointDistance).toBeCloseTo(2.2, 1);
  });

  it('normalises a non-English club label it does understand', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    // "7 Eisen" is not in the alias table, so it must not be silently
    // mislabelled — unknown is the correct, honest answer.
    expect(session?.shots[0]?.club).toBe('unknown');
    expect(session?.shots[0]?.rawClub).toBe('7 Eisen');
  });

  it('warns about the unrecognised club instead of failing quietly', () => {
    const { warnings } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    expect(warnings.some((w) => w.code === 'unknown-club')).toBe(true);
  });
});

describe('derived values', () => {
  it('reconstructs face-to-path from face angle and path when absent', () => {
    const text = [
      'Club,Face Angle [deg],Club Path [deg],Dynamic Loft [deg],Attack Angle [deg],Ball Speed [mph],Club Speed [mph]',
      '7 Iron,2.0,-3.0,27.0,-3.0,110,82',
    ].join('\n');
    const { session } = trackmanCsvAdapter.parse({ name: 'x.csv', text }, { handedness: 'right' });
    const shot = session?.shots[0];
    expect(shot?.faceToPath).toBeCloseTo(5.0, 5);
    expect(shot?.spinLoft).toBeCloseTo(30.0, 5);
    expect(shot?.smashFactor).toBeCloseTo(110 / 82, 3);
  });
});

describe('handedness mirroring', () => {
  const text = [
    'Club,Club Path [deg],Face Angle [deg],Face To Path [deg],Side [yds],Attack Angle [deg]',
    '7 Iron,-4.0,-1.0,3.0,-12.0,-3.0',
  ].join('\n');

  it('leaves a right-hander untouched', () => {
    const { session } = trackmanCsvAdapter.parse({ name: 'r.csv', text }, { handedness: 'right' });
    const s = session?.shots[0];
    expect(s?.clubPath).toBe(-4);
    expect(s?.side).toBe(-12);
    expect(s?.attackAngle).toBe(-3);
  });

  it('mirrors left-handed data so every sign convention still holds', () => {
    const { session } = trackmanCsvAdapter.parse({ name: 'l.csv', text }, { handedness: 'left' });
    const s = session?.shots[0];
    expect(s?.clubPath).toBe(4);
    expect(s?.faceToPath).toBe(-3);
    expect(s?.side).toBe(12);
    // Attack angle is not a left/right quantity and must NOT be mirrored.
    expect(s?.attackAngle).toBe(-3);
  });
});

describe('registry', () => {
  it('routes a recognised file to the TrackMan adapter', () => {
    const { session } = ingest(load('trackman-session-imperial.csv'), { handedness: 'right' });
    expect(session?.source).toBe('trackman-csv');
  });

  it('explains itself when a file is not recognised', () => {
    const { session, warnings } = ingest(
      { name: 'holiday-photo.png', text: 'not csv' },
      { handedness: 'right' },
    );
    expect(session).toBeNull();
    expect(warnings[0]?.message).toContain('not recognised');
  });
});

describe('session kind detection', () => {
  it('reads a plain range export as a range session', () => {
    const { session } = trackmanCsvAdapter.parse(load('trackman-session-imperial.csv'), {
      handedness: 'right',
    });
    expect(session?.kind).toBe('range');
  });

  it('recognises a Combine from its target protocol, without the filename', () => {
    const text = readFileSync(resolve(fixtures, 'trackman-combine.csv'), 'utf8');
    const { session } = trackmanCsvAdapter.parse(
      { name: 'export-2026-08-27.csv', text },
      { handedness: 'right' },
    );
    expect(session?.kind).toBe('combine');
  });

  it('reads target distance, proximity and score', () => {
    const text = readFileSync(resolve(fixtures, 'trackman-combine.csv'), 'utf8');
    const { session } = trackmanCsvAdapter.parse(
      { name: 'trackman-combine.csv', text },
      { handedness: 'right' },
    );
    const withTarget = session?.shots.filter((s) => s.targetDistance !== null) ?? [];
    expect(withTarget.length).toBeGreaterThan(40);
    expect(withTarget[0]?.proximity).not.toBeNull();
    expect(withTarget[0]?.shotScore).not.toBeNull();
  });

  it('falls back to range rather than guessing when there are no targets', () => {
    const text = [
      'Club,Club Speed [mph],Carry [yds]',
      '7 Iron,82,160',
      '7 Iron,82,161',
    ].join('\n');
    const { session } = trackmanCsvAdapter.parse({ name: 'x.csv', text }, { handedness: 'right' });
    expect(session?.kind).toBe('range');
  });
});

describe('TrackMan shot-analysis ("Normalized") export', () => {
  const samples = resolve(here, '../../../../samples');
  const input = {
    name: '9-shot-analysis-export.csv',
    text: readFileSync(resolve(samples, '9-shot-analysis-export.csv'), 'utf8'),
  };

  it('parses despite the sep= hint and a separate units row', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    expect(session).not.toBeNull();
    // 40 rows, less the two the player flagged as not counting.
    expect(session?.shots).toHaveLength(38);
  });

  it('does not read the units row as a shot', () => {
    // "[mph],[deg],[rpm]" used to parse as a shot where every measurement
    // was exactly zero, which then dragged every median down.
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    for (const shot of session?.shots ?? []) {
      expect(shot.clubSpeed === 0 && shot.ballSpeed === 0).toBe(false);
    }
  });

  it('respects TrackMan’s own Use In Stat flag', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    // The player already told the launch monitor to disregard those swings.
    expect(session?.shots).toHaveLength(38);
  });

  it('finds carry, total and apex under their real column names', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    const shots = session?.shots ?? [];
    // These live under "Carry Flat - Length" and "Max Height - Height", and
    // were silently absent until those aliases existed.
    expect(shots.every((s) => s.carry !== null)).toBe(true);
    expect(shots.every((s) => s.total !== null)).toBe(true);
    expect(shots.every((s) => s.apexHeight !== null)).toBe(true);
    expect(shots.every((s) => s.landingAngle !== null)).toBe(true);
  });

  it('reads units from the units row, not the header', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    const first = session?.shots[0];
    // Curve is published in feet here; the schema stores yards.
    expect(first?.carry).toBeGreaterThan(80);
    expect(first?.carry).toBeLessThan(260);
    expect(first?.apexHeight).toBeGreaterThan(20);
  });

  it('reads a twelve-hour clock as the evening it was', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    // "5:20:00 PM" is 17:20, not 05:20 — otherwise an evening session sorts
    // before a morning one on the same day.
    expect(session?.startedAt?.getHours()).toBeGreaterThanOrEqual(17);
  });

  it('records whether spin was measured or estimated', () => {
    const { session } = trackmanCsvAdapter.parse(input, { handedness: 'right' });
    const shots = session?.shots ?? [];
    expect(shots.some((s) => s.spinMeasured === true)).toBe(true);
    expect(shots.some((s) => s.spinMeasured === false)).toBe(true);
  });
});
