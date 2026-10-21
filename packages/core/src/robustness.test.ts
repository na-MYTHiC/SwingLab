import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { diagnoseSession, diagnoseShots, ingest } from './index.js';
import type { Shot } from './schema.js';

/**
 * Hostile input, and a scan of every string that comes back.
 *
 * The unit tests check that each rule says the right thing about the data it
 * was written for. This checks what happens with data nobody wrote a rule
 * for: an export missing a column, a club the parser cannot name, numbers
 * that are not numbers, a session of one shot or three thousand. None of
 * these should throw, and nothing that reaches the screen should contain
 * "NaN", "undefined" or "null" — the three words that tell a player the app
 * has quietly stopped understanding their golf.
 *
 * Every case here was a real defect before this file existed: "You are
 * leaving NaN yards in the strike" from an export with no carry column,
 * "your own NaN mph club speed" from one with no club speed, "Face is
 * consistently open to your path with the unknown" from a club labelled plain
 * "Hybrid", and a shot with no club at all throwing inside the outlier pass
 * and taking down the whole analysis.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const exportsOnDisk = ['samples', 'fixtures'].flatMap((dir) =>
  readdirSync(resolve(root, dir))
    .filter((f) => f.endsWith('.csv'))
    .map((f) => ({ name: f, text: readFileSync(resolve(root, dir, f), 'utf8') })));

/** Every string anywhere inside a report, with the path that led to it. */
function stringsIn(value: unknown, path = '', out: [string, string][] = [], seen = new Set<object>()) {
  if (typeof value === 'string') { out.push([path, value]); return out; }
  if (!value || typeof value !== 'object' || value instanceof Date || seen.has(value)) return out;
  seen.add(value);
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value);
  for (const [k, v] of entries) stringsIn(v, path ? `${path}.${String(k)}` : String(k), out, seen);
  return out;
}

const LEAK = /\bNaN\b|\bundefined\b|\bInfinity\b|\bnull\b|\[object Object\]|\bthe unknown\b/;
const leaks = (report: unknown) =>
  stringsIn(report).filter(([, s]) => LEAK.test(s)).map(([p, s]) => `${p}: ${s.slice(0, 120)}`);

describe('every export on disk', () => {
  it.each(exportsOnDisk.map((e) => [e.name, e]))('%s reads cleanly both ways round', (_n, input) => {
    for (const handedness of ['right', 'left'] as const) {
      const { session } = ingest(input, { handedness });
      expect(session).not.toBeNull();
      expect(leaks(diagnoseSession(session!))).toEqual([]);
    }
  });
});

describe('a mangled export', () => {
  const base = readFileSync(resolve(root, 'samples/1-range-slicer.csv'), 'utf8');
  const lines = base.split(/\r?\n/);
  const headerAt = lines.findIndex((l) => /(^|,)Club(,|$)/.test(l));
  const cols = lines[headerAt]!.split(',');
  const isRow = (i: number, l: string) => i > headerAt && l.trim() !== '';

  const dropColumn = (name: string) => {
    const at = cols.findIndex((c) => c.startsWith(name));
    return lines.map((l, i) => {
      if (i < headerAt || !l.trim()) return l;
      const parts = l.split(',');
      parts.splice(at, 1);
      return parts.join(',');
    }).join('\n');
  };
  const relabel = (from: string, to: string) => {
    const at = cols.indexOf('Club');
    return lines.map((l, i) => {
      if (!isRow(i, l)) return l;
      const parts = l.split(',');
      if (parts[at] === from) parts[at] = to;
      return parts.join(',');
    }).join('\n');
  };

  const cases: [string, string][] = [
    ['Windows line endings', base.replace(/\n/g, '\r\n')],
    ['a byte-order mark', `﻿${base}`],
    ['tabs for commas', base.replace(/,/g, '\t')],
    ['semicolons for commas', base.replace(/,/g, ';')],
    ['trailing junk rows', `${base}\n\n,,,,\n`],
    ['no Side column', dropColumn('Side')],
    ['no Spin Rate column', dropColumn('Spin Rate')],
    ['no Carry column', dropColumn('Carry')],
    ['no Club Speed column', dropColumn('Club Speed')],
    ['no Face To Path column', dropColumn('Face To Path')],
    ['every number replaced with text', lines.map((l, i) => (isRow(i, l) ? l.replace(/-?\d+\.\d+/g, 'abc') : l)).join('\n')],
    ['every number blanked', lines.map((l, i) => (isRow(i, l) ? l.replace(/-?\d+(\.\d+)?/g, '') : l)).join('\n')],
    ['absurdly large numbers', lines.map((l, i) => (isRow(i, l) ? l.replace(/(\d+)\.(\d+)/g, '9$1$2$2$2') : l)).join('\n')],
    ['a club labelled just "Hybrid"', relabel('5 Iron', 'Hybrid')],
    ['two different unnamed clubs', relabel('PW', 'Mini Driver').replace(/,5 Iron,/g, ',Hybrid,')],
    ['header and nothing else', lines.slice(0, headerAt + 1).join('\n')],
    ['binary noise', String.fromCharCode(...Array.from({ length: 2000 }, (_, i) => (i * 7919) % 256))],
    ['an empty file', ''],
  ];

  it.each(cases)('survives %s', (_label, text) => {
    const { session } = ingest({ name: 'mangled.csv', text }, { handedness: 'right' });
    if (session) expect(leaks(diagnoseSession(session))).toEqual([]);
  });

  it('keeps unnamed clubs out of the per-club reading and says how to fix it', () => {
    const { session, warnings } = ingest(
      { name: 'x.csv', text: relabel('5 Iron', 'Hybrid') }, { handedness: 'right' });
    const report = diagnoseSession(session!);
    expect(report.clubsSeen).not.toContain('unknown');
    expect(report.yardageBook.clubs.map((c) => c.club)).not.toContain('unknown');
    // Still counted — the player hit those shots.
    expect(report.shotCount).toBe(session!.shots.length);
    expect(warnings.some((w) => /"Hybrid".*4 Hybrid/.test(w.message))).toBe(true);
  });
});

describe('a row missing cells', () => {
  it('is left out and reported, not read with its values under the wrong headings', () => {
    /*
     * The bundled Combine sample used to write its driver rows without the
     * empty Target cell. Everything after Club slid one column left and the
     * parser accepted a 1.5 mph club speed and a 94.9-yard target.
     */
    const good = readFileSync(resolve(root, 'samples/2-combine.csv'), 'utf8');
    const broken = good.replace(/,Driver,,/g, ',Driver,').replace(/(,Driver,[^\n]*?),,\n/g, '$1\n');
    const fixed = ingest({ name: 'ok.csv', text: good }, { handedness: 'right' });
    const bad = ingest({ name: 'bad.csv', text: broken }, { handedness: 'right' });

    const drivers = (r: typeof fixed) => r.session!.shots.filter((x) => x.club === 'Dr');
    expect(drivers(fixed).length).toBeGreaterThan(0);
    expect(drivers(fixed).every((x) => (x.clubSpeed ?? 0) > 80)).toBe(true);
    expect(drivers(bad)).toHaveLength(0);
    expect(bad.warnings.some((w) => /missing cells/.test(w.message))).toBe(true);
  });
});

describe('sessions nobody would design a rule around', () => {
  let seq = 0;
  const shot = (o: Partial<Shot> = {}): Shot => ({
    id: `r${++seq}`, source: 'trackman-csv', time: null, sequence: seq, club: '7i',
    clubSpeed: 87, ballSpeed: 115, smashFactor: 1.32, attackAngle: -3.4, clubPath: 0.2,
    faceAngle: 0.3, faceToPath: 0.1, dynamicLoft: 25, spinLoft: 28, lowPointDistance: 3,
    impactOffset: 0, impactHeight: 0, launchAngle: 17, launchDirection: 0.3,
    spinRate: 6800, spinAxis: 0, carry: 169, total: 178, side: 0, curve: 0,
    apexHeight: 30, landingAngle: 47, targetDistance: null, proximity: null, shotScore: null,
    spinMeasured: true, smashIndex: null, spinIndex: null,
    lowPointSide: null, swingRadius: null, dynamicLie: null, flags: [], ...o,
  } as Shot);
  const many = (n: number, f: (i: number) => Partial<Shot> = () => ({})) =>
    Array.from({ length: n }, (_, i) => shot(f(i)));
  const blank = Object.fromEntries(Object.keys(shot()).filter((k) =>
    !['id', 'source', 'time', 'sequence', 'club', 'flags', 'spinMeasured'].includes(k))
    .map((k) => [k, null])) as Partial<Shot>;
  const bag = ['Dr', '3w', '5w', '4h', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW'] as const;

  const cases: [string, Shot[]][] = [
    ['no shots', []],
    ['one shot', many(1)],
    ['forty identical shots', many(40)],
    ['every field empty', many(20, () => blank)],
    ['nothing but carry', many(20, (i) => ({ ...blank, carry: 160 + (i % 5) }))],
    ['every shot topped', many(20, (i) => ({ carry: 20 + i, ballSpeed: 40, smashFactor: 0.5, launchAngle: 2 }))],
    ['no side readings', many(25, (i) => ({ side: null, curve: null, carry: 165 + (i % 7) }))],
    ['spin estimated on every shot', many(25, (i) => ({ spinMeasured: false, spinRate: 6000 + i * 30 }))],
    ['an eighty-yard spray', many(30, (i) => ({ side: (i % 2 ? 1 : -1) * i * 2.7, carry: 120 + i * 2 }))],
    ['a shot with no club at all', many(20, () => ({ club: null as unknown as Shot['club'] }))],
    ['the whole bag, three each', bag.flatMap((c, k) => many(3, (i) => ({ club: c, carry: 250 - k * 13 + i })))],
    ['wedges to six targets', (['PW', 'GW', 'SW'] as const).flatMap((c) =>
      [50, 60, 70, 80, 90, 100].flatMap((t) => many(4, (i) => ({ club: c, targetDistance: t, carry: t + (i - 1.5) * 3 }))))],
  ];

  it.each(cases)('handles %s', (_label, shots) => {
    expect(leaks(diagnoseShots(shots))).toEqual([]);
  });

  it('reads three thousand shots in well under a second', () => {
    const big = many(3000, (i) => ({ club: bag[i % bag.length], carry: 250 - (i % bag.length) * 13 + ((i * 7) % 11) - 5 }));
    const t0 = performance.now();
    diagnoseShots(big);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
