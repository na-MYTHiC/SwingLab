/**
 * The drill library.
 *
 * Curated and static — no API, no subscription, no per-request cost. Built
 * around what the motor-learning literature actually supports rather than
 * around range folklore, because the difference between the two is most of
 * why practice fails to transfer:
 *
 *   - **Blocked then random beats either alone.** Repetition builds a change;
 *     variability makes it survive contact with a golf course. Studies
 *     comparing the three consistently find the combination best on retention
 *     *and* transfer, so every drill here has both a build phase and a
 *     variable phase rather than being one or the other.
 *
 *   - **Random practice feels worse while you are doing it.** Performance
 *     drops during acquisition and improves on retention. Players who are not
 *     warned about this conclude the drill is not working and go back to
 *     hitting forty balls at the same target, so each drill says so.
 *
 *   - **Differential learning works.** Deliberately exaggerating a movement in
 *     both directions finds the middle faster than aiming at the middle,
 *     because it hands the player the boundaries of the pattern instead of a
 *     position to hold.
 *
 *   - **Distributed beats massed.** Three twenty-minute blocks across a week
 *     beat one hour, which is why the plans stop rather than filling time.
 */

export interface Drill {
  id: string;
  name: string;
  /** What the player actually does, in the order they do it. */
  how: string;
  /** Why this drill addresses the measured fault. */
  why: string;
  /** The repetition phase that builds the change. */
  build: string;
  /** The variable phase that makes it survive a golf course. */
  transfer: string;
  /** Roughly how long a useful dose is. */
  dose: string;
  /** Set when the drill is expected to feel worse before it feels better. */
  feelsWorse?: boolean;
}

export const DRILLS: Record<string, Drill> = {
  'towel-behind-ball': {
    id: 'towel-behind-ball',
    name: 'Towel behind the ball',
    how: 'Lay a folded towel one clubhead-width behind the ball and strike the ball without touching it.',
    why: 'Punishes a low point behind the ball directly. The feedback is unmissable, so contact moves forward within a few swings instead of over a few weeks.',
    build: '15 shots, same club, three-quarter swings. Stop and shorten if you catch the towel three times running.',
    transfer: 'Then 10 shots alternating clubs and targets with the towel still down. Missing it under variability is the test.',
    dose: '25 shots, about 12 minutes.',
  },
  'tee-forward-low-point': {
    id: 'tee-forward-low-point',
    name: 'Two-tee low point ladder',
    how: 'Push a tee into the mat an inch ahead of the ball. Clip both ball and tee, ball first.',
    why: 'Trains a low point ahead of the ball, which is what produces compression and repeatable iron distance.',
    build: '12 shots with one club, aiming to take the forward tee every time.',
    transfer: 'Move the tee to a different distance ahead every three shots. Varying the target position stops you grooving one fixed picture.',
    dose: '20 shots, about 10 minutes.',
    feelsWorse: true,
  },
  'foot-spray-strike': {
    id: 'foot-spray-strike',
    name: 'Face spray for strike location',
    how: 'Mist the face with foot spray or use impact tape. Hit five, photograph the pattern, wipe, repeat.',
    why: 'Turns strike location from a feeling into a measurement. Heel and toe misses have completely different causes and you cannot fix what you cannot see.',
    build: 'Three sets of five with the same club, checking the pattern between each.',
    transfer: 'A final set of five alternating clubs. Strike location holding up across clubs is what makes it real.',
    dose: '20 shots, about 10 minutes.',
  },
  'gate-path': {
    id: 'gate-path',
    name: 'Gate drill for club path',
    how: 'Form a gate with two headcovers or alignment sticks angled along the path you want — not the one you have — and swing through without touching either.',
    why: 'Path is a motion problem, not an intention problem. A physical constraint changes it far faster than a swing thought, because it gives feedback on every rep rather than after the shot.',
    build: '15 slow swings through the gate, then 10 at full speed.',
    transfer: 'Remove the gate and hit 8 more, alternating targets. Keeping the path without the constraint is the point of having used one.',
    dose: '30 swings, about 15 minutes.',
  },
  'split-hands-face': {
    id: 'split-hands-face',
    name: 'Split-hand release',
    how: 'Grip with your hands two inches apart and make half swings, feeling the lead wrist flex and the trail wrist extend through impact.',
    why: 'Exaggerates the forearm rotation that squares the face, so a face that arrives consistently open starts arriving square.',
    build: '20 split-hand half swings, no ball for the first ten.',
    transfer: 'Alternate three split-hand and three normal, five times through. The alternation is what carries the feel into your real grip.',
    dose: '35 swings, about 12 minutes.',
  },
  'exaggerate-both-ways': {
    id: 'exaggerate-both-ways',
    name: 'Exaggerate both directions',
    how: 'Hit five shots deliberately overdoing the fault, then five overdoing the opposite, then five trying to land in the middle. Repeat.',
    why: 'Differential learning: handing yourself the boundaries of a pattern finds its middle faster than aiming at the middle does. You learn the range, not a position — and a range survives pressure, where a position does not.',
    build: 'Two full cycles of five-five-five with one club.',
    transfer: 'A third cycle changing club each set, so the correction is not tied to one club.',
    dose: '45 shots, about 18 minutes.',
    feelsWorse: true,
  },
  'target-window': {
    id: 'target-window',
    name: 'Start-line window',
    how: 'Set two sticks eight feet ahead forming a window three feet wide. Every shot must start through it. Score each one in or out.',
    why: 'Start line is almost entirely face angle. A window makes face control measurable on every swing rather than theoretical, and scoring it stops you ignoring the misses.',
    build: '15 shots at one target, keeping score.',
    transfer: 'Then 10 shots moving the window between shots. A window you have to re-aim at is much closer to a golf course than one you settle into.',
    dose: '25 shots, about 12 minutes.',
  },
  'lead-arm-only': {
    id: 'lead-arm-only',
    name: 'Lead-arm-only swings',
    how: 'Choke down on a 9-iron and make half swings with your lead arm only, hitting soft shots.',
    why: 'Removes the trail-hand steering that flips the face, and builds the sense of the club releasing from the body rather than from the hands.',
    build: '10 lead-arm swings, then 5 normal shots trying to keep the same feel.',
    transfer: 'Two more rounds of that, changing target each time.',
    dose: '30 swings, about 12 minutes.',
    feelsWorse: true,
  },
  'step-change-tempo': {
    id: 'step-change-tempo',
    name: 'Step-through tempo',
    how: 'Start with your feet together, step into the shot with your lead foot as you transition, then hit.',
    why: 'Forces a sequenced transition. Wide dispersion with a stable face is usually a timing problem rather than a mechanical one, and this is hard to do out of sequence.',
    build: '12 step-through shots with one club.',
    transfer: '8 normal-stance shots immediately after, holding the sequence you just felt.',
    dose: '20 shots, about 10 minutes.',
  },
  'spin-loft-control': {
    id: 'spin-loft-control',
    name: 'Trajectory ladder',
    how: 'Hit the same club low, then medium, then high, on purpose. Three of each, cycling.',
    why: 'Delivering a different loft on demand is the skill underneath both spin control and distance control. Being able to choose it is what makes the normal one repeatable.',
    build: 'Two cycles of three-three-three with a mid iron.',
    transfer: 'A third cycle where you call the trajectory out loud before each shot and score whether you produced it.',
    dose: '27 shots, about 14 minutes.',
    feelsWorse: true,
  },
  'ladder-gapping': {
    id: 'ladder-gapping',
    name: 'Carry ladder',
    how: 'Three shots each with consecutive clubs, recording the median carry — not the best one.',
    why: 'Gapping problems masquerade as swing problems. You cannot fix them without a clean carry number per club, and the best-ever number is not the one you will hit on the course.',
    build: 'One full pass through the bag, three shots per club.',
    transfer: 'A second pass in random club order, calling the number before each shot.',
    dose: 'One or two passes, about 20 minutes.',
  },
  'random-practice-block': {
    id: 'random-practice-block',
    name: 'Randomised rotation',
    how: 'Never hit the same club twice in a row. Call your shot shape and target out loud before every swing, and take a full routine each time.',
    why: 'Blocked practice inflates range performance and does not transfer; randomised practice transfers. The research is unusually consistent on this — and equally consistent that it will look worse while you do it.',
    build: 'No build phase. This one is the transfer.',
    transfer: 'The last 20 balls of every session, without exception.',
    dose: '20 shots, about 12 minutes.',
    feelsWorse: true,
  },
  'tee-height-aoa': {
    id: 'tee-height-aoa',
    name: 'Tee it up and hit up',
    how: 'Tee the driver so half the ball sits above the crown, play it off your lead heel, and feel your trail shoulder work under through impact.',
    why: 'A negative attack angle with driver adds spin and costs carry. Ball position and tee height change attack angle far more reliably than any swing thought.',
    build: '10 drivers watching attack angle only, ignoring where the ball goes.',
    transfer: '8 more alternating between driver and an iron, so the change does not live only in your driver setup.',
    dose: '18 shots, about 12 minutes.',
  },
};

export function drill(id: string): Drill | null {
  return DRILLS[id] ?? null;
}
