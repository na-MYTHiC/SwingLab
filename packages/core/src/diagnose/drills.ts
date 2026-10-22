/**
 * The drill library.
 *
 * Curated and static — no API, no subscription, no per-request cost. Built
 * around practice principles with real research behind them, and honest about
 * how strong that research is, because the difference between range folklore
 * and evidence is most of why practice fails to transfer:
 *
 *   - **Vary the practice as a change settles.** Repetition builds a change;
 *     variability makes it survive a golf course, so every drill has a build
 *     phase and a variable phase. Increasing variability step by step is the
 *     best-supported schedule (Porter & Magill 2010). The random-practice
 *     advantage (Shea & Morgan 1979) is large in the lab and smaller and less
 *     reliable in real sport (Brady 2004), so it is used for transfer, not as a
 *     guarantee.
 *
 *   - **Random practice feels worse while you are doing it.** Performance
 *     drops during acquisition and shows up on retention, and learners
 *     wrongly predict blocked practice will serve them better (Simon & Bjork
 *     2001). Each drill that has this effect says so, so a player does not
 *     conclude it is not working.
 *
 *   - **Contrast practice.** Deliberately hitting both sides of a pattern
 *     (called contrast or differential practice) is widely used by coaches to
 *     find the middle. The research is promising but thin (Tassignon et al.
 *     2021), so it is a tool to judge by your own numbers, not a proven method.
 *
 *   - **Aim at an outcome or a number, not a body part.** Attending to the
 *     effect of the movement — the window, the number, the flight — beats
 *     attending to the movement itself (Wulf et al. 1999; Wulf 2013). It is why
 *     most drills here are scored against screen numbers.
 *
 *   - **Several short sessions across a week** are generally a better use of
 *     the same time than one long one, which is why the plans stop rather than
 *     filling the slot.
 *
 *   - **One change at a time** is a coaching heuristic rather than a research
 *     finding: two unrelated mechanical changes in one block tend to interfere.
 *     A block can hold several drills, but only ones aimed at the same fault
 *     and only as many as fit its clock; a transfer drill may follow any of
 *     them.
 *
 * Bay constraints: drills are written for a hitting mat and a screen. Nothing
 * is pushed into the mat, nothing hard is placed near the ball, and nothing is
 * set up between the player and the screen.
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
    how: 'Fold a towel flat — one fold, not a roll — and lay it across the mat a hand-width, four to six inches, behind the ball. Strike the ball without touching it.',
    why: 'Punishes a low point behind the ball directly. On a mat it matters more than on grass: the club skids off the mat, so a slightly fat shot still flies and you never find out. The towel puts back the feedback the mat removes.',
    build: '15 shots, same club, three-quarter swings. If you clip the towel while TrackMan shows Low Point ahead of the ball, move it back an inch — the towel is too close, not the swing.',
    transfer: 'Then 10 shots alternating clubs and targets with the towel still down. Missing it under variability is the test.',
    dose: '25 shots, about 12 minutes.',
    minutes: 12,
    treats: 'strike',
  },
  'powder-line-low-point': {
    id: 'powder-line-low-point',
    name: 'Line on the mat',
    how: 'Spray a thin line of foot powder across the mat, or lay a strip of masking tape, square to the target line, and put the ball just on the target side of it. After each shot, look at where the club first marked the mat, then check Low Point on screen. Ask the venue before spraying their mat.',
    why: 'On a mat the club skids, so a shot hit an inch fat can still fly almost normally. The powder shows where the club first touched and the Low Point number confirms it, which gives back the feedback a divot gives on grass.',
    build: '12 shots with one mid iron at three-quarter length, re-spraying every three. Every mark should start on the target side of the line.',
    transfer: '8 more alternating two clubs and two targets, moving to a fresh patch of mat every two shots so you are not grooving one picture.',
    dose: '20 shots, about 12 minutes.',
    minutes: 12,
    treats: 'strike',
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
    how: 'Use soft objects only — headcovers or a rolled towel, never alignment sticks or anything hard near the ball. Out-to-in: put a headcover about four inches outside the ball and six inches behind it. In-to-out: put it about four inches outside the ball and a foot ahead of it, where an in-to-out path swings into it after impact. Swing without touching it.',
    why: 'Path is a motion problem, not an intention problem. A physical constraint changes it far faster than a swing thought, because it gives feedback on every rep rather than after the shot.',
    build: '15 slow swings through the gate, then 10 at full speed.',
    transfer: 'Remove the gate and hit 8 more, alternating targets. If the path holds but the ball starts going the other way, the face has not caught up with the new path yet — expected, and the next block\'s job.',
    dose: '30 swings, about 15 minutes.',
    minutes: 14,
    treats: 'path',
  },
  'split-hands-face': {
    id: 'split-hands-face',
    name: 'Split-hand release',
    how: 'Grip with your hands two to four inches apart and make easy half swings with a 7-iron, letting your trail forearm roll over your lead forearm after impact so the toe points up on both sides of the swing.',
    why: 'The split grip makes the trail arm feel long and lets the lead elbow fold, which lets the forearms rotate and close the face through impact. A face that arrives consistently open starts arriving square. It can overdo it: if the ball starts hooking, stop — this is a feel drill, not a new grip.',
    build: '20 split-hand half swings, no ball for the first ten.',
    transfer: 'Alternate three split-hand and three normal, five times through. The alternation is what carries the feel into your real grip.',
    dose: '35 swings, about 14 minutes.',
    minutes: 14,
    treats: 'face',
  },
  'exaggerate-both-ways': {
    id: 'exaggerate-both-ways',
    name: 'Exaggerate both directions',
    how: 'Put Face to Path on screen. Hit five shots deliberately overdoing your fault, five deliberately overdoing the opposite, then five trying to land in the middle. Repeat.',
    why: 'Hitting both sides of a pattern on purpose teaches what each one feels like and what you did to cause it, which makes the middle easier to find than aiming at it directly. Coaches call this contrast or differential practice; the research behind it is promising but thin, so judge it by your own numbers.',
    build: 'Two full cycles of five-five-five with one club.',
    transfer: 'A third cycle changing club each set, so the correction is not tied to one club.',
    dose: '45 shots, about 22 minutes.',
    minutes: 22,
    treats: 'face',
    feelsWorse: true,
  },
  'target-window': {
    id: 'target-window',
    name: 'Start-line window',
    how: 'Pick a target on the screen and put Launch Direction on the display. Your window is Launch Direction within 2° of the target line — about five yards either side at 150. Score each shot in or out from the number, not the flight. Set nothing up between you and the screen.',
    why: 'Start line is mostly face angle — about three-quarters of it with an iron, more with a driver. A narrow window read off the launch monitor makes face control measurable on every swing, and scoring it stops you ignoring the misses. Anything placed between ball and screen is a ricochet hazard and too close to judge start line by eye anyway.',
    build: '15 shots at one target, keeping score.',
    transfer: 'Then 10 shots changing target between every shot. A window you have to re-aim at is much closer to a golf course than one you settle into.',
    dose: '25 shots, about 12 minutes.',
    minutes: 12,
    treats: 'face',
  },
  'lead-arm-only': {
    id: 'lead-arm-only',
    name: 'Lead-arm-only swings',
    how: 'Choke down on a wedge or 9-iron and make half swings with your lead arm only, trail hand on your lead shoulder. Half speed at most.',
    why: 'Takes the trail hand out of the strike, so the lead arm and body have to square the face on their own. Most players find the face arrives open at first; learning to rotate it closed without the trail hand is the point. Stop if your lead wrist or elbow complains.',
    build: '10 lead-arm swings, then 5 normal shots trying to keep the same feel.',
    transfer: 'Two more rounds of that, changing target each time.',
    dose: '30 swings, about 12 minutes.',
    minutes: 10,
    treats: 'face',
    feelsWorse: true,
  },
  'step-change-tempo': {
    id: 'step-change-tempo',
    name: 'Step drill',
    how: 'Start with your feet together, ball opposite your trail foot. As the club reaches hip height going back, step your lead foot toward the target and plant it, then swing down. Short irons, three-quarter swings, flat-soled shoes — mats can be slippery.',
    why: 'Gets pressure onto your lead side before the club comes down. Low point sits roughly under the lead side of your chest, so weight left on the trail side bottoms the club out behind the ball; this drill is very hard to do with the weight left back.',
    build: '12 step-through shots with one club, watching Low Point.',
    transfer: '8 normal-stance shots alternating two clubs, keeping the Low Point number you had with the step.',
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
    how: 'Six shots each with consecutive clubs, recording the median carry — not the best one. If your bay has TrackMan Map My Bag, use it; it builds the same table.',
    why: 'Gapping problems masquerade as swing problems. You cannot fix them without a clean carry number per club; three shots is not enough, because one mishit moves the median, and the best-ever number is not the one you will hit on the course.',
    build: 'One pass through up to seven clubs, six shots each.',
    transfer: 'A second pass in random club order, one shot each, calling the number before each shot.',
    dose: 'About 50 shots, 25 minutes.',
    minutes: 25,
    treats: 'distance',
  },
  'random-practice-block': {
    id: 'random-practice-block',
    name: 'Randomised rotation',
    how: 'Never hit the same club twice in a row. Call your shot shape and target out loud before every swing, and take a full routine each time.',
    why: 'Blocked practice makes range numbers look better than your golf. Mixing clubs and targets tends to hold up better a day later — strongly in lab studies, more weakly and less reliably in real sport. What is consistent is that it looks worse while you do it, so judge it by the next session, not this one.',
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
    how: 'Lay two tees flat on the mat, or use two small foam markers, one just outside the toe and one just inside the heel, a little wider than the clubhead. Strike the ball without disturbing either. If your miss is one-sided, use one marker: inside the heel for toe strikes, outside the toe for heel strikes.',
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
    treats: 'strike',
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
    why: 'Good players tend to swing at roughly a 3:1 backswing-to-downswing ratio on every club, though their overall speeds differ. A fixed count removes one thing that changes from swing to swing, so it is worth trying when your strike wanders for no mechanical reason — but it will not fix a positional fault.',
    build: '10 swings to the count with a mid iron, half of them without a ball.',
    transfer: '10 more changing club every two shots, holding the same count.',
    dose: '20 swings, about 8 minutes.',
    minutes: 8,
    treats: 'strike',
  },
  'aim-reset': {
    id: 'aim-reset',
    name: 'Aim check every third shot',
    how: 'Lay one stick along your toes and a second parallel to it, a clubhead outside the ball, pointing at your target on the screen — never on the ball-to-target line, where the club will hit it. Every third shot, step away, re-aim from behind the ball, and reset both sticks.',
    why: 'A consistent push or pull with a square face-to-path is usually aim, not a swing fault — and it is invisible from inside the stance. Aim drifts within a session, which is why this is a repeated check. Also ask whether the bay\'s target line has been calibrated to the screen: TrackMan measures direction against that line, so a bay that is out reads every shot as a push or pull.',
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
    how: 'Tee the driver so half the ball sits above the crown and play it off your lead heel. At address, tilt your spine slightly away from the target so your trail shoulder sits lower than your lead, and keep your head behind the ball until after impact.',
    why: 'A negative attack angle with driver adds spin and costs carry. Ball position and tee height change attack angle far more reliably than any swing thought.',
    build: '10 drivers watching attack angle only, ignoring where the ball goes.',
    transfer: '8 more alternating between driver and an iron, so the change does not live only in your driver setup.',
    dose: '18 shots, about 10 minutes.',
    minutes: 10,
    treats: 'delivery',
  },
  'driver-setup-ladder': {
    id: 'driver-setup-ladder',
    name: 'Attack angle ladder',
    how: 'Driver, teed so half the ball is above the crown. Hit three from your normal setup, three with the ball two inches further forward, and three with the ball forward and your spine tilted a little more away from the target. Read Attack Angle and Spin after every shot.',
    why: 'A downward driver strike has several setup causes — ball too far back, too little tilt, head drifting ahead of the ball — and they need different fixes. Changing one at a time and reading the number shows which one moves yours, instead of guessing.',
    build: 'Two passes through the three setups, writing down the median attack angle for each.',
    transfer: '8 more with the setup that gave the best number, re-teeing and stepping away between every shot, alternating two fairway targets.',
    dose: '26 shots, about 14 minutes.',
    minutes: 14,
    treats: 'delivery',
    feelsWorse: true,
  },
  'strike-map': {
    id: 'strike-map',
    name: 'Toe, heel, centre',
    how: 'Spray the face. Hit three shots deliberately off the toe, three deliberately off the heel, then three trying for the centre, checking the mark after every ball. Keep the heel shots at half speed — a shank in a bay goes sideways into the walls.',
    why: 'Hitting the toe and heel on purpose teaches what each one feels like and what you did to cause it, so a miss stops being a mystery. The centre is easier to find once you can find both edges.',
    build: 'Two rounds of toe-heel-centre with a 7-iron at three-quarter speed.',
    transfer: 'A third round calling the strike out loud before each ball and changing club every three, scoring whether the mark matched the call.',
    dose: '27 shots, about 15 minutes.',
    minutes: 15,
    treats: 'strike',
    feelsWorse: true,
  },
  'spin-loft-window': {
    id: 'spin-loft-window',
    name: 'Spin loft read',
    how: 'Put Spin Loft, Attack Angle, Dynamic Loft and Spin Rate on screen. Hit five from your normal setup, five with the ball half a ball further forward, and five half a ball further back. Watch which way spin loft moves, and spin with it.',
    why: 'Spin follows spin loft — roughly dynamic loft minus attack angle — and both come from the strike, not from effort. Reading all of them shows which one is out for you, so you change the cause rather than chasing the spin number.',
    build: '15 balls, five per setup, with the club that was flagged.',
    transfer: '8 more with the setup that moved spin the right way, alternating with the next club up.',
    dose: '23 shots, about 12 minutes.',
    minutes: 12,
    treats: 'delivery',
  },
  'clock-wedges': {
    id: 'clock-wedges',
    name: 'Clock wedges',
    how: 'Use three backswing lengths you can repeat — lead arm at 7:30, 9:00 and 10:30 on a clock face — with the same rhythm and a full finish on all three. Record the median carry of each length with each wedge.',
    why: 'Inside full-swing distance most players control distance by feel and decelerate. Fixed lengths at one rhythm give you a small set of distances you actually own, and a chart turns a 63-yard shot into a choice instead of a guess.',
    build: 'Five balls at each length with one wedge, recording the median carry. Add another wedge next session rather than rushing two now.',
    transfer: '10 balls to random numbers from your chart, calling wedge and clock position first and scoring carry within 4 yards.',
    dose: '25 shots, about 15 minutes.',
    minutes: 15,
    treats: 'distance',
  },
  'stance-path': {
    id: 'stance-path',
    name: 'Foot back for path',
    how: 'Out-to-in: set up normally, then draw your trail foot back about six inches, keeping your shoulders square to the target. In-to-out: draw your lead foot back instead. Hit with Club Path and Face to Path on screen.',
    why: 'Path comes from how the body turns through the ball as much as from the arms. Moving one foot back changes the room the body has to turn in, so the club approaches from a different direction without a swing thought — a different mechanism from the gate, which only fences the club.',
    build: '12 shots with a short iron, watching Club Path move toward zero.',
    transfer: '8 from your normal stance alternating two targets. If path holds but the ball starts pushing or pulling, the face has not followed yet — expected.',
    dose: '20 shots, about 10 minutes.',
    minutes: 10,
    treats: 'path',
  },
  'driver-strike-height': {
    id: 'driver-strike-height',
    name: 'Find the driver sweet spot',
    how: 'Spray the driver face. Hit three each from a low tee, a middle tee and a high tee, checking the mark after every ball. Note which height puts the strike just above centre and slightly toward the toe — not up near the crown.',
    why: 'On a driver, low strikes add spin and lower launch; slightly high-toe strikes launch higher with less spin and lose little ball speed. A lot of high-spin driver numbers are strike height, not swing, and tee height is the cheapest way to move it.',
    build: 'One pass of three-three-three, then 6 more at the height that gave the best mark.',
    transfer: '6 drivers with a fresh tee every ball, alternating two fairway targets, spraying before every second shot.',
    dose: '21 shots, about 12 minutes.',
    minutes: 12,
    treats: 'strike',
  },
  'grip-check': {
    id: 'grip-check',
    name: 'Grip ladder',
    how: 'Hit five with your lead hand a quarter-turn stronger than normal, five a quarter-turn weaker, and five neutral — about two knuckles visible. Read Face to Path after each.',
    why: 'A face that sits consistently open or closed to the path is often set before the swing starts. Grip is the one cause you can change standing still, and seeing how far a quarter-turn moves Face to Path tells you whether the problem is in your hands or in your release.',
    build: 'One pass of five-five-five with a 7-iron, recording the median Face to Path for each grip.',
    transfer: '8 more with the grip that put Face to Path nearest zero, re-gripping from scratch before every ball and alternating two clubs.',
    dose: '23 shots, about 12 minutes.',
    minutes: 12,
    treats: 'face',
    feelsWorse: true,
  },
  'wedge-ladder': {
    id: 'wedge-ladder',
    name: 'Landing ladder',
    how: 'Set targets at 50, 60, 70, 80 and 90 yards. Hit one ball to each going up, then one to each coming down. Score carry within 4 yards of the number.',
    why: 'On a course you never hit the same number twice. Climbing and descending forces you to recalibrate on every ball, which is what makes a wedge number hold up when it counts.',
    build: 'One ladder up and down with one wedge, scoring each ball.',
    transfer: 'Two more ladders choosing your own wedge for each rung. Write the score down and try to beat it next session.',
    dose: '30 shots, about 15 minutes.',
    minutes: 15,
    treats: 'distance',
    feelsWorse: true,
  },
  'choke-down-fill': {
    id: 'choke-down-fill',
    name: 'Fill the gap',
    how: 'Take the longer club either side of the oversized gap. Hit five full, five choked down an inch, and five choked down an inch with a three-quarter swing, recording the median carry of each.',
    why: 'An oversized gap is usually an equipment fact, not a swing fault, and until the lofts are fixed you need a shot that lands in it. Tests disagree on what choking down costs — anywhere from two to twelve yards — so measure yours rather than trusting a rule of thumb.',
    build: '15 balls as above.',
    transfer: '8 balls alternating the shorter club\'s stock shot and your new in-between shot, calling the number before each.',
    dose: '23 shots, about 12 minutes.',
    minutes: 12,
    treats: 'distance',
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
    // A transfer drill is the second half of any block, so it may follow any fault family.
    if (chosen.length > 0 && d.treats !== target && d.treats !== 'transfer') continue;
    if (chosen.length > 0 && spent + d.minutes > budget) continue;
    chosen.push(d);
    spent += d.minutes;
  }
  return chosen;
}
