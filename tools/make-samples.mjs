/**
 * Generates the sample TrackMan exports in `samples/`.
 *
 * These exist so the app can be exercised without owning a TrackMan, and so
 * each analysis path has a file that deliberately triggers it. Every sample
 * is internally consistent — face to path really is face minus path, smash
 * really is ball speed over club speed — because a fixture with impossible
 * physics in it will eventually be used to "prove" a rule works when it does
 * not.
 *
 * Deterministic: same seed, same files. Run with `node tools/make-samples.mjs`.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../samples');
mkdirSync(OUT, { recursive: true });

/** Mulberry32 — small, seeded, and good enough for plausible-looking noise. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGauss(rand) {
  return (mu, sd) => {
    // Box-Muller.
    const u = Math.max(1e-9, rand());
    const v = rand();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

const CLUB = {
  Driver: { speed: 98, smash: 1.47, launch: 11.5, spin: 2600, dyn: 14, carry: 245 },
  '3 Wood': { speed: 93, smash: 1.46, launch: 12.5, spin: 3400, dyn: 17, carry: 220 },
  '5 Iron': { speed: 87, smash: 1.38, launch: 15.5, spin: 5100, dyn: 22, carry: 180 },
  '6 Iron': { speed: 85, smash: 1.36, launch: 17, spin: 5900, dyn: 25, carry: 170 },
  '7 Iron': { speed: 83, smash: 1.33, launch: 18.5, spin: 6700, dyn: 27, carry: 160 },
  '8 Iron': { speed: 80, smash: 1.31, launch: 20.5, spin: 7500, dyn: 30, carry: 148 },
  '9 Iron': { speed: 77, smash: 1.28, launch: 23, spin: 8300, dyn: 33, carry: 135 },
  PW: { speed: 74, smash: 1.23, launch: 25.5, spin: 9100, dyn: 36, carry: 120 },
  GW: { speed: 70, smash: 1.2, launch: 28, spin: 9600, dyn: 40, carry: 105 },
  SW: { speed: 65, smash: 1.15, launch: 30, spin: 10200, dyn: 44, carry: 88 },
};

const HEADERS = [
  'Date', 'Time', 'Club', 'Club Speed [mph]', 'Attack Angle [deg]', 'Club Path [deg]',
  'Face Angle [deg]', 'Face To Path [deg]', 'Dynamic Loft [deg]', 'Spin Loft [deg]',
  'Low Point [in]', 'Impact Offset [mm]', 'Impact Height [mm]', 'Ball Speed [mph]',
  'Smash Factor', 'Launch Angle [deg]', 'Launch Direction [deg]', 'Spin Rate [rpm]',
  'Spin Axis [deg]', 'Carry [yds]', 'Total [yds]', 'Side [yds]', 'Curve [yds]',
  'Height [ft]', 'Landing Angle [deg]', 'Hang Time [s]',
];

const TARGET_HEADERS = [...HEADERS.slice(0, 3), 'Target [yds]', ...HEADERS.slice(3),
  'Distance To Pin [yds]', 'Score'];

/**
 * Build one shot. `bias` describes what is deliberately wrong with the swing,
 * so each sample can be written as "a player with these specific faults".
 */
function shot(g, date, time, clubName, bias = {}, target = null) {
  const base = CLUB[clubName];
  const {
    aoa = clubName === 'Driver' ? 1.5 : -3.5,
    path = 0,
    faceToPath = 0,
    lowPoint = clubName === 'Driver' ? 0 : 2.5,
    offset = 0,
    smashPenalty = 0,
    spinScale = 1,
    spread = 1,
    carryOffset = 0,
  } = bias;

  const clubSpeed = g(base.speed, base.speed * 0.017 * spread);
  const attackAngle = g(aoa, 0.9 * spread);
  const clubPath = g(path, 1.5 * spread);
  const f2p = g(faceToPath, 1.4 * spread);
  const faceAngle = clubPath + f2p;
  const dynamicLoft = g(base.dyn, 1.3 * spread);
  const spinLoft = dynamicLoft - attackAngle;
  const impactOffset = g(offset, 5.5 * spread);

  // Off-centre strikes cost ball speed; that is the whole point of smash.
  const offCentrePenalty = Math.min(0.09, (Math.abs(impactOffset) / 100) * 1.6);
  const smash = Math.max(
    0.8,
    g(base.smash, 0.018 * spread) - smashPenalty - offCentrePenalty,
  );
  const ballSpeed = clubSpeed * smash;

  const launchAngle = g(base.launch, 1.0 * spread);
  // Start line is dominated by the face, with a little path in it.
  const launchDirection = faceAngle * 0.8 + clubPath * 0.2 + g(0, 0.35);
  const spinRate = Math.max(500, g(base.spin, base.spin * 0.06 * spread) * spinScale
    + (spinLoft - (base.dyn - aoa)) * 110);
  const spinAxis = f2p * 2.5 + g(0, 1.1);

  const speedRatio = ballSpeed / (base.speed * base.smash);
  const carry = base.carry * speedRatio + carryOffset + g(0, base.carry * 0.012 * spread);
  const roll = clubName === 'Driver' ? 18 : clubName === '3 Wood' ? 12 : 4;
  const curve = spinAxis * carry * 0.004;
  /*
   * Lateral scatter needs its own term.
   *
   * Deriving side purely from launch direction and curve produced patterns
   * tighter than tour players hold, because those two are modelled almost
   * noiselessly here. Real dispersion also carries strike location, gear
   * effect and wind, none of which this generator simulates — so a scatter
   * term stands in for them. Without it every sample golfer read as scratch.
   */
  const lateralNoise = g(0, carry * 0.035 * spread);
  const side = Math.tan((launchDirection * Math.PI) / 180) * carry + curve + lateralNoise;

  const row = [
    date, time, clubName,
    clubSpeed.toFixed(1), attackAngle.toFixed(1), clubPath.toFixed(1),
    faceAngle.toFixed(1), f2p.toFixed(1), dynamicLoft.toFixed(1), spinLoft.toFixed(1),
    g(lowPoint, 1.0 * spread).toFixed(1), impactOffset.toFixed(1), g(1.5, 3.2).toFixed(1),
    ballSpeed.toFixed(1), smash.toFixed(3), launchAngle.toFixed(1),
    launchDirection.toFixed(1), spinRate.toFixed(0), spinAxis.toFixed(1),
    carry.toFixed(1), (carry + roll).toFixed(1), side.toFixed(1), curve.toFixed(1),
    g(base.launch * 3.4, 5).toFixed(1), g(45, 3).toFixed(1), g(6.2, 0.5).toFixed(1),
  ];

  if (target === null) return row;

  const proximity = Math.hypot(carry - target, side);
  return [
    ...row.slice(0, 3), String(target), ...row.slice(3),
    proximity.toFixed(1), Math.max(0, Math.min(100, 100 - proximity * 3.2)).toFixed(0),
  ];
}

function clock(i) {
  const m = 5 + i;
  return `${String(14 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
}

function write(name, headers, rows, preamble) {
  const body = [...preamble, '', headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  writeFileSync(resolve(OUT, name), `${body}\n`);
  console.log(`${name.padEnd(34)} ${rows.length} shots`);
}

// ---------------------------------------------------------------------------
// 1. Range session — a slicer who also hits down on the driver.
{
  const g = makeGauss(rng(101));
  const rows = [];
  let i = 0;
  const push = (club, bias, n) => {
    for (let k = 0; k < n; k++) rows.push(shot(g, '2026-08-24', clock(i++), club, bias));
  };
  push('Driver', { aoa: -2.6, path: -1.5, faceToPath: 1.8, spinScale: 1.35 }, 12);
  push('5 Iron', { path: -2.5, faceToPath: 2.2, offset: 4 }, 10);
  push('7 Iron', { path: -4.2, faceToPath: 3.4, offset: 10, spread: 1.15 }, 14);
  push('PW', { path: -2.0, faceToPath: 1.5 }, 10);
  write('1-range-slicer.csv', HEADERS, rows, [
    'TrackMan Performance Studio', 'Player: Test Player', 'Activity: Driving Range',
  ]);
}

// 2. Combine — consistently short of every flag, weakest at 160.
{
  const g = makeGauss(rng(202));
  const targets = [[60, 'SW'], [70, 'SW'], [80, 'GW'], [90, 'GW'], [100, 'PW'],
    [120, '9 Iron'], [140, '8 Iron'], [160, '7 Iron'], [180, '5 Iron'], [null, 'Driver']];
  const rows = [];
  let i = 0;
  for (let rep = 0; rep < 2; rep++) {
    for (const [target, club] of targets) {
      for (let k = 0; k < 3; k++) {
        const weak = target === 160;
        const bias = target === null
          ? {}
          : { carryOffset: (weak ? -16 : -7) - CLUB[club].carry + target, spread: weak ? 2.4 : 0.85 };
        rows.push(shot(g, '2026-08-27', clock(i++), club, bias, target));
      }
    }
  }
  write('2-combine.csv', TARGET_HEADERS, rows, [
    'TrackMan Performance Studio', 'Player: Test Player', 'Activity: Combine',
  ]);
}

// 3. Test Center — a wedge ladder, loose distance control but no bias.
{
  const g = makeGauss(rng(303));
  const rows = [];
  let i = 0;
  for (const [target, club] of [[80, 'GW'], [100, 'PW'], [120, '9 Iron'], [140, '8 Iron']]) {
    for (let k = 0; k < 8; k++) {
      // Loose distance control, but not a catastrophe — at spread 2.2 this
      // produced a player with a fault on every club and every metric, which
      // is not a useful test case, it is just noise.
      rows.push(shot(g, '2026-08-29', clock(i++), club, {
        carryOffset: target - CLUB[club].carry, spread: 1.35,
      }, target));
    }
  }
  write('3-test-center-wedges.csv', TARGET_HEADERS, rows, [
    'TrackMan Performance Studio', 'Player: Test Player', 'Activity: Test Center',
  ]);
}

// 4. A clean session — nothing worth reporting. Tests that the app stays quiet.
{
  const g = makeGauss(rng(404));
  const rows = [];
  let i = 0;
  for (const club of ['Driver', '7 Iron', 'PW']) {
    for (let k = 0; k < 12; k++) {
      rows.push(shot(g, '2026-08-30', clock(i++), club, { spread: 0.55 }));
    }
  }
  write('4-clean-session.csv', HEADERS, rows, [
    'TrackMan Performance Studio', 'Player: Test Player', 'Activity: Driving Range',
  ]);
}

// 5-8. Four weekly sessions with a genuine improvement, for the Trends view.
{
  const weeks = [
    { date: '2026-07-13', f2p: 5.2, path: -4.5, offset: 11, name: '5-trend-week1.csv' },
    { date: '2026-07-20', f2p: 4.4, path: -4.0, offset: 9, name: '6-trend-week2.csv' },
    { date: '2026-07-27', f2p: 2.1, path: -2.6, offset: 5, name: '7-trend-week3.csv' },
    { date: '2026-08-03', f2p: 0.8, path: -1.4, offset: 3, name: '8-trend-week4.csv' },
  ];
  weeks.forEach((w, idx) => {
    const g = makeGauss(rng(500 + idx));
    const rows = [];
    let i = 0;
    for (const club of ['7 Iron', 'Driver']) {
      for (let k = 0; k < 12; k++) {
        // Keep the spread realistic. At 1.25 the driver rows swung wildly
        // enough to read as 38% heavy strikes and an 81-yard improvement
        // across one session, which is not a player, it is noise.
        rows.push(shot(g, w.date, clock(i++), club, {
          path: w.path, faceToPath: w.f2p, offset: w.offset,
          spread: 0.95 - idx * 0.12,
        }));
      }
    }
    write(w.name, HEADERS, rows, [
      'TrackMan Performance Studio', 'Player: Test Player', 'Activity: Driving Range',
    ]);
  });
}

// ---------------------------------------------------------------------------
// 9. The TrackMan shot-analysis ("Normalized") export.
//
// A different layout from Table View: a `sep=` hint, units on their own row
// beneath the header, twelve-hour timestamps, several competing carry columns,
// and TrackMan's own Use In Stat flag. Synthetic values — a real session is
// personal data and does not belong in a public repository — but the shape is
// faithful, which is the part the parser has to survive.
{
  const g = makeGauss(rng(909));
  const HEAD = [
    'Date', 'TMD No', 'TMD Filename', 'Player', 'Club', 'Ball', 'Club Speed',
    'Attack Angle', 'Club Path', 'Low Point', 'Swing Plane', 'Swing Direction',
    'Dyn. Loft', 'Face Angle', 'Face To Path', 'Ball Speed', 'Smash Factor',
    'Launch Angle', 'Launch Direction', 'Spin Rate', 'Spin Rate Type', 'Spin Axis',
    'Max Height - Height', 'Carry Flat - Length', 'Carry Flat - Side',
    'Carry Flat - Land. Angle', 'Est. Total Flat - Length', 'Est. Total Flat - Side',
    'Impact Offset', 'Impact Height', 'Curve', 'Spin Loft', 'Low Point Side',
    'Use In Stat', 'Condition',
  ];
  const UNITS = [
    '', '', '', '', '', '', '[mph]', '[deg]', '[deg]', '[in]', '[deg]', '[deg]',
    '[deg]', '[deg]', '[deg]', '[mph]', '[]', '[deg]', '[deg]', '[rpm]', '[]',
    '[deg]', '[ft]', '[yds]', '[yds]', '[deg]', '[yds]', '[yds]', '[mm]', '[mm]',
    '[ft]', '[deg]', '[mm]', '', '',
  ];

  const rows = [];
  for (let i = 0; i < 40; i++) {
    const r = shot(g, '', '', '7 Iron', { path: -1.0, faceToPath: 2.4, spread: 1.5 });
    const idx = (name) => HEADERS.indexOf(name);
    const at = (name) => r[idx(name)];

    const hour = 5;
    const minute = 20 + Math.floor(i * 1.4);
    const stamp = `9/2/2026 ${hour}:${String(minute % 60).padStart(2, '0')}:00 PM`;
    // A couple of practice swings the player told TrackMan to disregard.
    const useInStat = i === 7 || i === 22 ? 'FALSE' : 'TRUE';

    rows.push([
      `"${stamp}"`, '', '', '"Sample Player"', '"7 Iron"', '"Premium"',
      at('Club Speed [mph]'), at('Attack Angle [deg]'), at('Club Path [deg]'),
      at('Low Point [in]'), g(58, 3).toFixed(3), at('Club Path [deg]'),
      at('Dynamic Loft [deg]'), at('Face Angle [deg]'), at('Face To Path [deg]'),
      at('Ball Speed [mph]'), at('Smash Factor'), at('Launch Angle [deg]'),
      at('Launch Direction [deg]'), at('Spin Rate [rpm]'),
      i % 20 === 0 ? 'Measured' : 'Estimated', at('Spin Axis [deg]'),
      at('Height [ft]'), at('Carry [yds]'), at('Side [yds]'),
      at('Landing Angle [deg]'), at('Total [yds]'), at('Side [yds]'),
      at('Impact Offset [mm]'), at('Impact Height [mm]'),
      (Number(at('Curve [yds]')) * 3).toFixed(2), at('Spin Loft [deg]'),
      g(-4, 4).toFixed(0), useInStat,
      '"Data are normalized to no wind conditions at 4700 ft altitude"',
    ]);
  }

  const body = [
    'sep=,',
    HEAD.join(','),
    UNITS.join(','),
    ...rows.map((r) => r.join(',')),
  ].join('\n');
  writeFileSync(resolve(OUT, '9-shot-analysis-export.csv'), `${body}\n`);
  console.log(`${'9-shot-analysis-export.csv'.padEnd(34)} ${rows.length} shots`);
}
