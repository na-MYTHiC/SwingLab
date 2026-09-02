import { describe, expect, it } from 'vitest';
import { diagnoseShots } from './index.js';
import type { Shot } from './schema.js';

/**
 * Every sentence the engine can say, read by a machine that is looking for
 * the ways generated prose goes wrong.
 *
 * The findings, scores and drills are assembled from templates with numbers
 * interpolated into them, and the failure mode is not a crash — it is a
 * sentence that is grammatically broken in a way no test asserting a number
 * would ever notice. Three shipped: a pattern described as running "From -16
 * to 50 yards off line", where a bare minus sign in the middle of a sentence
 * reads as a typo rather than as sixteen yards left; a Delivery line that ran
 * "scored on how close each sits to the tour figure for your swing speed
 * rather than merely inside it", whose closing "it" had lost its referent
 * four clauses earlier; and two different numbers to club off, on two
 * screens, from two modules that each believed they owned the question.
 *
 * So this walks a spread of sessions chosen to light up as many templates as
 * possible and applies the checks a copy editor would.
 */

let seq = 0;
function shot(over: Partial<Shot> = {}): Shot {
  seq += 1;
  return {
    id: `s${seq}`, source: 'trackman-csv', time: new Date(2026, 0, 1, 10, seq % 60),
    sequence: seq, club: '7i',
    clubSpeed: 87, ballSpeed: 115, smashFactor: 1.32, attackAngle: -3.4, clubPath: 0.2,
    faceAngle: 0.3, faceToPath: 0.1, dynamicLoft: 25, spinLoft: 28, lowPointDistance: 3,
    impactOffset: 0, impactHeight: 0, launchAngle: 17, launchDirection: 0.3,
    spinRate: 6800, spinAxis: 0, carry: 169, total: 178, side: 0, curve: 0,
    apexHeight: 30, landingAngle: 47, targetDistance: null, proximity: null, shotScore: null,
    spinMeasured: true, smashIndex: null, spinIndex: null,
    lowPointSide: null, swingRadius: null, dynamicLie: null, flags: [],
    ...over,
  } as Shot;
}

/**
 * A deterministic spread that actually reaches both ends of its range.
 *
 * A sine on a short cycle looked random but only covered about two thirds of
 * [-1, 1], which quietly meant no fixture here ever produced a shot left of
 * the target line. Two of the checks below were passing on sessions that
 * could not have failed them. This walks the interval properly.
 */
const wobble = (i: number) => (((i * 7) % 21) / 10) - 1;

/** Sessions picked to exercise as many sentence templates as possible. */
function sessions(): { name: string; shots: Shot[] }[] {
  const n = 30;
  const build = (name: string, f: (i: number) => Partial<Shot>) => ({
    name,
    shots: Array.from({ length: n }, (_, i) => shot(f(i))),
  });
  return [
    build('tidy', (i) => ({ carry: 169 + wobble(i), side: wobble(i) })),
    // A slice: face open to path, pattern pushed right and wide.
    build('slicer', (i) => ({
      clubPath: -3.5 + wobble(i), faceAngle: 2.5 + wobble(i) * 2, faceToPath: 6 + wobble(i) * 2,
      side: 14 + wobble(i) * 18, curve: 9 + wobble(i) * 6, spinAxis: 8 + wobble(i) * 5,
      carry: 165 + wobble(i) * 9,
    })),
    // A pull: the mirror image, so left-hand phrasing gets exercised too.
    build('puller', (i) => ({
      clubPath: 3.5 + wobble(i), faceAngle: -2.5 + wobble(i) * 2, faceToPath: -6 + wobble(i) * 2,
      side: -14 + wobble(i) * 33, curve: -9 + wobble(i) * 6, carry: 165 + wobble(i) * 9,
    })),
    /*
     * The real 1 September session, reproduced closely enough to fire the same
     * templates: heel strikes, a wide launch window, spin estimated on half
     * the shots, three duffs, and a fifty-yard pattern centred twelve yards
     * right that still reaches sixteen yards left of the line. That last part
     * is the one that matters — it is what puts a negative number in front of
     * the sentence that used to print it raw.
     */
    build('scattered', (i) => ({
      impactOffset: -9 + wobble(i) * 3,
      launchAngle: 17 + wobble(i) * 5,
      spinRate: 6000 + wobble(i) * 1800,
      spinMeasured: i % 2 === 0,
      carry: i % 10 === 3 ? 40 : 175 + wobble(i) * 12,
      side: 12 + wobble(i) * 33,
    })),
    // A driver session, for the templates only it can reach.
    build('driver', (i) => ({
      club: 'Dr', clubSpeed: 104, ballSpeed: 152, smashFactor: 1.46,
      attackAngle: -2.7 + wobble(i), launchAngle: 11 + wobble(i),
      spinRate: 3400 + wobble(i) * 300, carry: 245 + wobble(i) * 10, side: wobble(i) * 20,
    })),
  ];
}

/** Every user-facing string one report can produce. */
function copyOf(shots: Shot[]): { where: string; text: string }[] {
  const r = diagnoseShots(shots);
  const out: { where: string; text: string }[] = [];
  const add = (where: string, text: string | null | undefined) => {
    if (typeof text === 'string' && text.trim()) out.push({ where, text });
  };
  for (const f of r.findings) { add(f.id, f.title); add(f.id, f.detail); }
  for (const c of r.score?.components ?? []) add(`score.${c.id}`, c.detail);
  add('score.summary', r.score?.summary);
  add('progression', r.progression.headline);
  add('progression', r.progression.detail);
  add('potential', r.potential?.headline);
  add('potential', r.potential?.detail);
  add('handicap', r.handicap?.headline);
  add('handicap', r.handicap?.caveat);
  add('consistency', r.consistency?.headline);
  for (const n of r.dataNotes) add('dataNote', n);
  for (const a of r.achievements) { add(`ach.${a.id}`, a.requirement); add(`ach.${a.id}`, a.meaning); }
  for (const b of r.practice.blocks ?? []) {
    add(`practice.${b.id ?? b.title}`, b.title);
    add(`practice.${b.id ?? b.title}`, b.how);
    add(`practice.${b.id ?? b.title}`, b.why);
  }
  for (const p of r.practicePlan ?? []) { add('plan', p.title); add('plan', p.how); }
  for (const c of r.yardageBook.clubs) add('yardage', `${c.club} plays ${c.plays}`);
  for (const o of r.yardageBook.omitted) add('yardage.omitted', o.reason);
  return out;
}

const ALL = sessions().flatMap((s) =>
  copyOf(s.shots).map((c) => ({ ...c, where: `${s.name}/${c.where}` })));

describe('generated copy', () => {
  it('produces a lot of sentences to check', () => {
    // Guards the guard: if a refactor stops the templates firing, the checks
    // below would all pass vacuously.
    expect(ALL.length).toBeGreaterThan(150);
  });

  it('actually reaches the templates that print signed numbers', () => {
    /*
     * This file shipped once already passing every check while catching
     * nothing: no fixture was wide enough to raise a dispersion finding, and
     * none put a shot left of the target line, so the sentence that carried
     * the bug was never generated. Naming the templates the checks depend on
     * means a fixture that stops producing them fails here instead of going
     * quietly green.
     */
    const ids = new Set(ALL.map((c) => c.where.split('/')[1]));
    for (const id of ['dispersion-wide', 'face-open-to-path', 'strike-heel-biased']) {
      expect([...ids].some((x) => x === id)).toBe(true);
    }
    const dispersion = ALL.filter((c) => c.where.endsWith('dispersion-wide'));
    expect(dispersion.some((c) => /left/.test(c.text))).toBe(true);
    expect(dispersion.some((c) => /right/.test(c.text))).toBe(true);
  });

  it.each([
    [
      'never prints a bare minus sign inside a sentence',
      // Attack angle is quoted signed by every launch monitor and every coach,
      // so "-2.7° — descending" is correct and exempt. Anything else with a
      // loose minus in prose is a number that should have been said in words.
      / -\d/,
      (t: string) => !/attack angle/i.test(t),
    ],
    ['never leaks undefined, NaN or null', /\b(undefined|NaN|null)\b/, () => true],
    ['never double-spaces', /\s{2}/, () => true],
    ['never leaves an empty bracket or a space before punctuation', /\(\s*\)|\[\s*\]|\s,|\s\./, () => true],
    ['never repeats a word', /\b(\w+)\s+\1\b/i, () => true],
    ['never ends on a dangling article or preposition', /\b(the|a|an|of|to|and|is|your|than)\s*$/i, () => true],
    ['never doubles a percent sign', /%\s*%|%\)/, () => true],
    // "1 yards left", "1 shots", "1 degrees" — the plural that slips through
    // whenever a rounded number lands on one.
    ['never pluralises a single unit', /\b1 (yards|shots|degrees|inches|strokes|sessions|clubs)\b/, () => true],
  ])('%s', (_label, pattern, applies) => {
    const bad = ALL.filter((c) => pattern.test(c.text.trim()) && applies(c.text));
    expect(bad.map((c) => `[${c.where}] ${c.text}`)).toEqual([]);
  });

  it('gives exactly one answer to "what should I club off"', () => {
    /*
     * The contradiction this file was written after. Potential took the 35th
     * percentile of the shots that flew and said "Club off 173, not 183"; the
     * yardage book took the 20th percentile of every readable shot and said
     * 162. Both on screen, a swipe apart, with no way to tell which was meant.
     */
    for (const s of sessions()) {
      const r = diagnoseShots(s.shots);
      expect(r.potential?.detail ?? '').not.toMatch(/club off \d/i);
    }
  });
});
