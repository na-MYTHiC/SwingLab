import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DRILLS, fitDrillList } from '../diagnose/drills.js';

/**
 * Drills are written for a hitting mat and a screen. These guard the ways a
 * drill can be correct on grass and wrong in a bay, and the ways its numbers
 * can quietly disagree with its own text.
 */
describe('the drill library', () => {
  const all = Object.values(DRILLS);

  it('has unique ids that match their keys', () => {
    for (const [key, d] of Object.entries(DRILLS)) expect(d.id).toBe(key);
  });

  it('says a dose in minutes that agrees with the clock it charges', () => {
    for (const d of all) {
      const said = /about (\d+) minutes|(\d+) minutes/.exec(d.dose);
      expect(said, `${d.id}: no minutes in "${d.dose}"`).not.toBeNull();
      const n = Number(said![1] ?? said![2]);
      expect(Math.abs(n - d.minutes), `${d.id}: says ${n}, charges ${d.minutes}`).toBeLessThanOrEqual(3);
    }
  });

  it('asks for nothing that only works on turf or near the screen', () => {
    for (const d of all) {
      const text = `${d.how} ${d.build} ${d.transfer}`;
      expect(text, d.id).not.toMatch(/(push|press|stick)\w*[^.]{0,30}tee[^.]{0,30}(into|in) the (mat|ground)/i);
      expect(text, d.id).not.toMatch(/eight feet ahead/i);
      expect(text, d.id).not.toMatch(/divot/i);
    }
  });

  it('has a build phase and a variable phase for every drill', () => {
    for (const d of all) {
      expect(d.build.length, d.id).toBeGreaterThan(10);
      expect(d.transfer.length, d.id).toBeGreaterThan(10);
    }
  });

  it('lets a transfer drill follow a mechanical one inside a block', () => {
    const picked = fitDrillList(
      [DRILLS['powder-line-low-point']!, DRILLS['random-practice-block']!],
      30,
    );
    expect(picked.map((d) => d.id)).toEqual(['powder-line-low-point', 'random-practice-block']);
  });

  it('still drops a second mechanical fault from the same block', () => {
    const picked = fitDrillList([DRILLS['powder-line-low-point']!, DRILLS['grip-check']!], 60);
    expect(picked.map((d) => d.id)).toEqual(['powder-line-low-point']);
  });
});

/**
 * fitDrillList keeps only drills in the first drill's family, so a candidate list
 * that mixes two families silently loses everything after the first change of
 * family. Read the lists out of the source: every list must either stay in one
 * family or the dropped drill must be a deliberate transfer drill.
 */
describe('candidate drill lists', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const files = [
    join(root, 'practice', 'prescribe.ts'),
    ...readdirSync(join(root, 'diagnose'))
      .filter((f) => f.startsWith('rules-') && f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => join(root, 'diagnose', f)),
  ];

  const lists: { file: string; ids: string[] }[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\[('[a-z0-9-]+'(?:,\s*'[a-z0-9-]+')*)\]/g)) {
      const ids = [...m[1]!.matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]!);
      if (ids.length > 0 && ids.every((id) => id in DRILLS)) lists.push({ file, ids });
    }
  }

  it('finds the lists it is meant to check', () => {
    expect(lists.length).toBeGreaterThan(20);
  });

  it('refers only to drills that exist', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:drillsFor|drills:)\s*\(?\[([^\]]+)\]/g)) {
        for (const id of m[1]!.matchAll(/'([a-z0-9-]+)'/g)) {
          expect(id[1]! in DRILLS, `${file}: unknown drill ${id[1]}`).toBe(true);
        }
      }
    }
  });

  it('never loses a mechanical drill to the family filter', () => {
    const lost: string[] = [];
    for (const { file, ids } of lists) {
      const first = DRILLS[ids[0]!]!.treats;
      for (const id of ids.slice(1)) {
        const d = DRILLS[id]!;
        if (d.treats !== first && d.treats !== 'transfer') {
          lost.push(`${file.split('/').pop()}: ${id} (${d.treats}) follows ${ids[0]} (${first})`);
        }
      }
    }
    expect(lost).toEqual([]);
  });
});
