import { describe, expect, it } from 'vitest';
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
