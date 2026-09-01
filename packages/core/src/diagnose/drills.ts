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
 *
 *   - **One change at a time.** Two unrelated mechanical changes worked in the
 *     same block interfere with each other and neither sticks. This is why
 *     `minutes` exists: a block can hold several drills, but only ones aimed
 *     at the *same* fault, and only as many as honestly fit its clock. Two
 *     drills on one fault is a build phase followed by a transfer phase and is
 *     better than either alone; two drills on two faults is a wasted hour.
 *
 * `minutes` is a real estimate, not a label. It assumes roughly two balls a
 * minute for ordinary full shots — which is what actually happens in a bay
 * once you include setting up, watching the number and resetting — and slower
 * where the drill needs checking between shots or a constraint moved.
 */

/**
 * What a drill is aimed at. Blocks are built from a single target so two
 * unrelated changes never share a block.
 */
export type DrillTarget =
  | 'strike'      // where on the face, and where the low point is
  | 'face'        // face angle and start line
  | 'path'        // club path and curvature
  | 'delivery'    // loft, launch and spin delivery
  | 'distance'    // carry control and gapping
  | 'transfer';   // making any of it survive a golf course

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
  /** Roughly how long a useful dose is, in prose. */
  dose: string;
  /**
   * What that dose actually costs in bay time. Used to fit drills into a
   * block rather than listing more than the clock allows.
   */
  minutes: number;
  /** The fault family this drill treats; a block only mixes within one. */
  treats: DrillTarget;
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
    minutes: 12,
    treats: 'strike',
  },
  'tee-forward-low-point': {
    id: 'tee-forward-low-point',
    name: 'Two-tee low point ladder',
    how: 'Push a tee into the mat an inch ahead of the ball. Clip both ball and tee, ball first.',
    why: 'Trains a low point ahead of the ball, which is what produces compression and repeatable iron distance.',
    build: '12 shots with one club, aiming to take the forward tee every time.',
    transfer: 'Move the tee to a different distance ahead every three shots. Varying the target position stops you grooving one fixed picture.',
    dose: '20 shots, about 10 minutes.',
    minutes: 10,
    treats: 'strike',
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
    minutes: 10,
    treats: 'strike',
  },
  'gate-path': {
    id: 'gate-path',
    name: 'Gate drill for club path',
    how: 'Form a gate with two headcovers or alignment sticks angled along the path you want — not the one you have — and swing through without touching either.',
    why: 'Path is a motion problem, not an intention problem. A physical constraint changes it far faster than a swing thought, because it gives feedback on every rep rather than after the shot.',
    build: '15 slow swings through the gate, then 10 at full speed.',
    transfer: 'Remove the gate and hit 8 more, alternating targets. Keeping the path without the constraint is the point of having used one.',
    dose: '30 swings, about 15 minutes.',
    minutes: 14,
    treats: 'path',
  },
  'split-hands-face': {
    id: 'split-hands-face',
    name: 'Split-hand release',
    how: 'Grip with your hands two inches apart and make half swings, feeling the lead wrist flex and the trail wrist extend through impact.',
    why: 'Exaggerates the forearm rotation that squares the face, so a face that arrives consistently open starts arriving square.',
    build: '20 split-hand half swings, no ball for the first ten.',
    transfer: 'Alternate three split-hand and three normal, five times through. The alternation is what carries the feel into your real grip.',
    dose: '35 swings, about 12 minutes.',
    minutes: 10,
    treats: 'face',
  },
  'exaggerate-both-ways': {
    id: 'exaggerate-both-ways',
    name: 'Exaggerate both directions',
    how: 'Hit five shots deliberately overdoing the fault, then five overdoing the opposite, then five trying to land in the middle. Repeat.',
    why: 'Differential learning: handing yourself the boundaries of a pattern finds its middle faster than aiming at the middle does. You learn the range, not a position — and a range survives pressure, where a position does not.',
    build: 'Two full cycles of five-five-five with one club.',
    transfer: 'A third cycle changing club each set, so the correction is not tied to one club.',
    dose: '45 shots, about 18 minutes.',
    minutes: 20,
    treats: 'face',
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
    minutes: 12,
    treats: 'face',
  },
  'lead-arm-only': {
    id: 'lead-arm-only',
    name: 'Lead-arm-only swings',
    how: 'Choke down on a 9-iron and make half swings with your lead arm only, hitting soft shots.',
    why: 'Removes the trail-hand steering that flips the face, and builds the sense of the club releasing from the body rather than from the hands.',
    build: '10 lead-arm swings, then 5 normal shots trying to keep the same feel.',
    transfer: 'Two more rounds of that, changing target each time.',
    dose: '30 swings, about 12 minutes.',
    minutes: 10,
    treats: 'face',
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
    minutes: 10,
    treats: 'strike',
  },
  'spin-loft-control': {
    id: 'spin-loft-control',
    name: 'Trajectory ladder',
    how: 'Hit the same club low, then medium, then high, on purpose. Three of each, cycling.',
    why: 'Delivering a different loft on demand is the skill underneath both spin control and distance control. Being able to choose it is what makes the normal one repeatable.',
    build: 'Two cycles of three-three-three with a mid iron.',
    transfer: 'A third cycle where you call the trajectory out loud before each shot and score whether you produced it.',
    dose: '27 shots, about 14 minutes.',
    minutes: 14,
    treats: 'delivery',
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
    minutes: 20,
    treats: 'distance',
  },
  'random-practice-block': {
    id: 'random-practice-block',
    name: 'Randomised rotation',
    how: 'Never hit the same club twice in a row. Call your shot shape and target out loud before every swing, and take a full routine each time.',
    why: 'Blocked practice inflates range performance and does not transfer; randomised practice transfers. The research is unusually consistent on this — and equally consistent that it will look worse while you do it.',
    build: 'No build phase. This one is the transfer.',
    transfer: 'The last 20 balls of every session, without exception.',
    dose: '20 shots, about 12 minutes.',
    minutes: 12,
    treats: 'transfer',
    feelsWorse: true,
  },
  'toe-heel-gate': {
    id: 'toe-heel-gate',
    name: 'Strike gate at the ball',
    how: 'Put a tee just outside the toe and another just inside the heel, a little wider than the clubhead. Strike the ball without clipping either.',
    why: 'A face-spray pattern tells you where you are hitting it; a gate makes you fix it. Heel and toe strikes lose ball speed and move the face at impact, so a wandering strike location shows up as inconsistent distance *and* inconsistent direction from one fault.',
    build: '12 shots at three-quarter speed. Widen the gate if you hit a tee twice running — the drill only works if most reps succeed.',
    transfer: '8 more at full speed with the gate slightly narrower, alternating between two targets.',
    dose: '20 shots, about 10 minutes.',
    minutes: 10,
    treats: 'strike',
  },
  'shaft-lean-irons': {
    id: 'shaft-lean-irons',
    name: 'Ball back, hands forward',
    how: 'Move the ball one ball-width back in your stance, set your hands ahead of it at address, and keep them ahead through impact. Hit punchy three-quarter shots.',
    why: 'Hitting up on an iron adds loft and spin at impact and costs both compression and distance. Ball position and hand position change attack angle far more reliably than trying to feel a steeper swing, which usually just produces a lunge.',
    build: '12 punch shots, watching attack angle only and ignoring where the ball finishes.',
    transfer: '8 normal-length swings keeping the same hand position, changing club every two shots.',
    dose: '20 shots, about 10 minutes.',
    minutes: 10,
    treats: 'delivery',
  },
  'call-the-number': {
    id: 'call-the-number',
    name: 'Call the number',
    how: 'Before every shot, say the carry you intend out loud. Hit it. Write down the miss, signed — short is negative, long is positive.',
    why: 'Distance control is a prediction skill, not a power skill. Saying the number first turns every shot into a test you can pass or fail, and the signed miss shows whether you have a bias to correct or a spread to tighten — two completely different problems that look identical in an average.',
    build: '12 shots to one number, recording every miss.',
    transfer: '12 more with the number changing every shot across a 40-yard span. Being able to call it only after settling in is not distance control.',
    dose: '24 shots, about 14 minutes.',
    minutes: 14,
    treats: 'distance',
    feelsWorse: true,
  },
  'tempo-ratio': {
    id: 'tempo-ratio',
    name: 'Three-to-one tempo',
    how: 'Count "one-two-three" going back and "one" coming down, out loud or to a metronome. Same count on every club.',
    why: 'Tour players are remarkably consistent at roughly a 3:1 backswing-to-downswing ratio, and the ratio holds across clubs even though the absolute times differ. A repeatable ratio is what makes a repeatable low point possible, so this is often the cheapest fix for a strike that wanders for no mechanical reason.',
    build: '10 swings to the count with a mid iron, half of them without a ball.',
    transfer: '10 more changing club every two shots, holding the same count.',
    dose: '20 swings, about 8 minutes.',
    minutes: 8,
    treats: 'strike',
  },
  'aim-reset': {
    id: 'aim-reset',
    name: 'Aim check every third shot',
    how: 'Lay a stick along your toes and another on the target line. Every third shot, step away, re-aim from behind the ball, and reset both sticks.',
    why: 'A consistent push or pull with a square face-to-path is an aiming problem, not a swing problem — and it is invisible from inside the stance, because a body aimed thirty yards right still feels straight. Aim drifts within a session too, which is why this is a repeated check rather than a one-off.',
    build: '9 shots with the sticks down, resetting every third.',
    transfer: '6 shots with the sticks removed, re-aiming from behind the ball each time.',
    dose: '15 shots, about 8 minutes.',
    minutes: 8,
    treats: 'face',
  },
  'one-flight': {
    id: 'one-flight',
    name: 'Same window, same finish',
    how: 'Pick a window in the net or on the screen and hit every shot through it, holding your finish until the ball lands.',
    why: 'Delivering a different loft on every swing produces a different flight on every swing, and it is the reason a good average carry can still miss greens. Holding one flight forces the delivery to repeat, and holding the finish is what stops you steering the club at the last moment.',
    build: '12 shots through the window with one club.',
    transfer: '9 more alternating three clubs, keeping the same window. Same flight from different lofts is the real skill.',
    dose: '21 shots, about 12 minutes.',
    minutes: 12,
    treats: 'delivery',
  },
  'pressure-nine': {
    id: 'pressure-nine',
    name: 'Nine-shot scorecard',
    how: 'Nine shots, each to a different target, one attempt each. Score a point for anything inside your own good band and write the total down. Try to beat it next session.',
    why: 'Practice performance and course performance diverge because practice has no consequence. A single-attempt scored test brings back the one thing a range removes, and a written score turns the whole session into something you can win or lose — which is what makes the next one worth booking.',
    build: 'No build phase. The absence of a second attempt is the point.',
    transfer: 'Run it as the last nine balls of every session.',
    dose: '9 shots, about 8 minutes.',
    minutes: 8,
    treats: 'transfer',
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
    minutes: 10,
    treats: 'delivery',
  },
};

export function drill(id: string): Drill | null {
  return DRILLS[id] ?? null;
}

/**
 * Fit drills into a block's clock.
 *
 * Takes them in priority order and stops when the next one will not fit,
 * rather than listing six drills for a fifteen-minute block and leaving the
 * player to guess which ones matter. Drills aimed at a different fault than
 * the first are dropped: a block that works two unrelated changes teaches
 * neither, which is the one place where doing more is worse than doing less.
 */
export function fitDrills(ids: string[], minutes: number): Drill[] {
  return fitDrillList(
    ids.map((id) => DRILLS[id]).filter((d): d is Drill => d !== undefined),
    minutes,
  );
}

/** As `fitDrills`, for drills that have already been resolved. */
export function fitDrillList(candidates: Drill[], minutes: number): Drill[] {
  const first = candidates[0];
  if (!first) return [];

  const target = first.treats;
  /*
   * The drills are what the block *is*, so the whole clock is available to
   * them. The honest consequence is that a fifteen-minute block usually holds
   * one drill and a twenty-five-minute block holds two — which is the answer
   * to "can I do more than one of these", and it is usually no.
   */
  const budget = minutes;

  const chosen: Drill[] = [];
  let spent = 0;
  for (const d of candidates) {
    if (chosen.length > 0 && d.treats !== target) continue;
    if (chosen.length > 0 && spent + d.minutes > budget) continue;
    chosen.push(d);
    spent += d.minutes;
  }
  return chosen;
}
