import type { Club } from '../schema.js';
import { clubFamily } from '../clubs.js';
import type { ClubProfile } from '../stats/dispersion.js';
import type { Finding } from '../diagnose/types.js';
import { DRILLS, type Drill } from '../diagnose/drills.js';
import { PRACTICE_MODES, type PracticeMode, type PracticeModeId } from './modes.js';

/**
 * Turning findings into a practice session someone can actually run.
 *
 * The gap this closes: "work on your distance control" is not actionable to
 * a player standing in a bay looking at a menu. "Test Center, one target at
 * 145 yards, 10 shots with the 8-iron, count how many finish inside 20 feet"
 * is. Every prescription below names the mode, the setup, and what a good
 * result looks like, and every number in it comes from the player's own data
 * rather than a generic template.
 */

export interface Prescription {
  id: string;
  mode: PracticeMode;
  title: string;
  /** Why this, for this player, right now. */
  rationale: string;
  /** Literal steps to set it up in the bay. */
  setup: string[];
  /** What counts as a good result, so the session has a pass mark. */
  success: string;
  club: Club | null;
  /** Target carry for the mode, where the mode takes one. */
  targetDistance: number | null;
  shots: number;
  minutes: number;
  /** Finding ids this addresses. */
  addresses: string[];
  /** Supporting drills to run inside this block. */
  drills: Drill[];
}

export interface PracticeSession {
  /** Ordered blocks: build the change, vary it, measure it, take it to a course. */
  blocks: Prescription[];
  totalMinutes: number;
  /** Set when the engine had nothing specific to work on. */
  note: string | null;
}

const STAGE_ORDER: Record<PracticeMode['stage'], number> = {
  build: 0,
  vary: 1,
  measure: 2,
  play: 3,
};

function carryOf(profiles: ClubProfile[], club: Club | null): number | null {
  if (!club) return null;
  const p = profiles.find((x) => x.club === club);
  if (!p || !Number.isFinite(p.carry.median)) return null;
  return Math.round(p.carry.median);
}

function drillsFor(ids: string[]): Drill[] {
  return ids.map((id) => DRILLS[id]).filter((d): d is Drill => d !== undefined);
}

/**
 * How tight a proximity target to set, in feet.
 *
 * Scaled to the shot: asking for 15 feet from 170 yards is a tour standard
 * and asking for 40 feet from 80 yards is no standard at all. Roughly 7% of
 * the carry distance is a demanding-but-reachable band for a competent
 * amateur, which is what makes a test worth repeating.
 */
function proximityTargetFeet(carryYards: number): number {
  return Math.max(12, Math.round((carryYards * 0.07 * 3) / 5) * 5);
}

interface Template {
  /** Finding ids this template answers. */
  matches: (findingId: string) => boolean;
  build(finding: Finding, profiles: ClubProfile[]): Prescription | null;
}

const TEMPLATES: Template[] = [
  // ---------------------------------------------------------------- strike
  {
    matches: (id) =>
      id === 'strike-scattered' || id === 'strike-toe-biased' || id === 'strike-heel-biased',
    build(finding, profiles) {
      const club = finding.club;
      const carry = carryOf(profiles, club);
      return {
        id: `rx-strike-${club}`,
        mode: PRACTICE_MODES.range,
        title: `Strike location block with the ${club}`,
        rationale:
          'Strike has to come first. Path and face numbers measured off a scattered strike are not trustworthy, so fixing contact makes every other number in your session mean something.',
        setup: [
          'Open the Practice Range and select the club.',
          'Spray the face or apply impact tape before every fifth shot.',
          'Hit in sets of five at roughly 70% effort — speed hides strike problems rather than fixing them.',
          'Photograph the face after each set so you can see the pattern move.',
        ],
        success:
          'Four of every five strikes inside a coin-sized area near the centre, with smash factor steady to within 0.03.',
        club,
        targetDistance: carry,
        shots: 30,
        minutes: 20,
        addresses: [finding.id],
        drills: drillsFor(['foot-spray-strike', 'towel-behind-ball']),
      };
    },
  },
  {
    matches: (id) => id === 'low-point-behind-ball' || id === 'low-point-inconsistent',
    build(finding, profiles) {
      const club = finding.club;
      return {
        id: `rx-lowpoint-${club}`,
        mode: PRACTICE_MODES.range,
        title: `Low point control with the ${club}`,
        rationale:
          'Your low point is the reason contact varies. It is also one of the fastest things in golf to change, because the feedback can be made physical.',
        setup: [
          'Practice Range, ball on the mat rather than a tee.',
          'Place a towel one clubhead-width behind the ball.',
          'Hit shots at three-quarter length, ball first, without touching the towel.',
          'Watch the Low Point number rather than the ball flight — that is the number you are moving.',
        ],
        success: 'Low point 2 to 4 inches ahead of the ball on eight of ten swings.',
        club,
        targetDistance: carryOf(profiles, club),
        shots: 25,
        minutes: 15,
        addresses: [finding.id],
        drills: drillsFor(['towel-behind-ball', 'tee-forward-low-point']),
      };
    },
  },
  {
    matches: (id) => id === 'low-smash-factor',
    build(finding, profiles) {
      const club = finding.club;
      return {
        id: `rx-smash-${club}`,
        mode: PRACTICE_MODES.range,
        title: `Recover ball speed with the ${club}`,
        rationale:
          'This is distance available without swinging harder — smash factor is a strike and spin-loft story, not a speed one.',
        setup: [
          'Practice Range, club selected, impact tape on the face.',
          'Hit ten shots at 80% effort and note the smash factor for each.',
          'Then ten more consciously trying to strike the centre rather than hit it far.',
          'Compare the two sets. Centre strikes at 80% usually beat toe strikes at 100%.',
        ],
        success: 'Median smash factor up by 0.03 or more against your session baseline.',
        club,
        targetDistance: carryOf(profiles, club),
        shots: 20,
        minutes: 15,
        addresses: [finding.id],
        drills: drillsFor(['foot-spray-strike', 'spin-loft-control']),
      };
    },
  },
  // ------------------------------------------------------------- direction
  {
    matches: (id) => id === 'face-inconsistent',
    build(finding, profiles) {
      const club = finding.club;
      const carry = carryOf(profiles, club);
      return {
        id: `rx-face-${club}`,
        mode: PRACTICE_MODES['target-practice'],
        title: `Start-line window with the ${club}`,
        rationale:
          'Start line is almost entirely face angle, and yours moves shot to shot. A target makes that visible on every swing instead of only in the averages, where open and closed misses cancel out and look like nothing.',
        setup: [
          `Target Practice with a target at ${carry ?? 150} yards.`,
          'Pick a narrow start-line window and call it out loud before each shot.',
          'Score each shot yourself: did it start inside the window, yes or no.',
          'Do not chase the finish position — only the start line counts here.',
        ],
        success: 'Seven of ten shots starting inside your window, with face angle spread under 2°.',
        club,
        targetDistance: carry,
        shots: 20,
        minutes: 15,
        addresses: [finding.id],
        drills: drillsFor(['target-window', 'lead-arm-only']),
      };
    },
  },
  {
    matches: (id) => id === 'face-open-to-path' || id === 'face-closed-to-path',
    build(finding, profiles) {
      const club = finding.club;
      const open = finding.id === 'face-open-to-path';
      return {
        id: `rx-f2p-${club}`,
        mode: PRACTICE_MODES.range,
        title: `Square the face to the path with the ${club}`,
        rationale: `Your face sits consistently ${open ? 'open' : 'closed'} to your path, which is what curves the ball. Because it is consistent, it is trainable — you are not fighting randomness, you are moving one relationship.`,
        setup: [
          'Practice Range, club selected, Face to Path visible on screen.',
          `Hit five shots deliberately exaggerating the opposite — ${open ? 'a hard hook feel' : 'a hard cut feel'}.`,
          'Then five trying to land Face to Path between -1° and +1°.',
          'Alternate the two. Exaggeration in both directions finds the middle faster than aiming for it.',
        ],
        success: 'Median face to path inside ±1.5° over your last ten shots.',
        club,
        targetDistance: carryOf(profiles, club),
        shots: 25,
        minutes: 15,
        addresses: [finding.id],
        drills: drillsFor(open ? ['split-hands-face', 'lead-arm-only'] : ['target-window', 'gate-path']),
      };
    },
  },
  {
    matches: (id) => id === 'path-out-to-in' || id === 'path-in-to-out',
    build(finding, profiles) {
      const club = finding.club;
      return {
        id: `rx-path-${club}`,
        mode: PRACTICE_MODES.range,
        title: `Neutralise your ${club} path`,
        rationale:
          'Path this far from neutral limits which shapes are available to you and forces the face to compensate to hit anything straight.',
        setup: [
          'Practice Range with a physical gate — two headcovers or alignment sticks.',
          'Angle the gate along the path you want, not the path you have.',
          'Half swings first, full speed only once you are through it cleanly five times.',
        ],
        success: 'Median club path inside ±2° with the face still within 2° of it.',
        club,
        targetDistance: carryOf(profiles, club),
        shots: 25,
        minutes: 15,
        addresses: [finding.id],
        drills: drillsFor(['gate-path', 'step-change-tempo']),
      };
    },
  },
  // ----------------------------------------------------------------- driver
  {
    matches: (id) => id === 'driver-negative-aoa' || (id === 'spin-too-high'),
    build(finding, profiles) {
      if (finding.club !== 'Dr') return null;
      return {
        id: 'rx-driver-launch',
        mode: PRACTICE_MODES.range,
        title: 'Driver launch conditions',
        rationale:
          'You are hitting down on it and spinning it too much, which is the classic high-spin low-carry driver. This is mostly a setup change, and it is usually worth more carry than any speed work.',
        setup: [
          'Practice Range, driver, teed so half the ball sits above the crown.',
          'Ball forward, off the lead heel. Shoulders slightly tilted away from the target.',
          'Watch Attack Angle only. Ignore distance for the first fifteen swings.',
          'Once attack angle is positive, check that spin has come down with it.',
        ],
        success: 'Attack angle at or above 0° and spin under 3,000 rpm on the majority of swings.',
        club: 'Dr',
        targetDistance: null,
        shots: 20,
        minutes: 15,
        addresses: [finding.id],
        drills: drillsFor(['tee-height-aoa']),
      };
    },
  },
  // -------------------------------------------------------- distance control
  {
    matches: (id) => id === 'carry-inconsistent',
    build(finding, profiles) {
      const club = finding.club;
      const carry = carryOf(profiles, club);
      if (carry === null) return null;
      const feet = proximityTargetFeet(carry);
      return {
        id: `rx-distance-${club}`,
        mode: PRACTICE_MODES['test-center'],
        title: `Distance control test at ${carry} yards`,
        rationale:
          'Your carry with this club swings too widely to commit to a number on the course. A scored, repeatable test turns that from a feeling into a figure you can watch move.',
        setup: [
          'Test Center → build a custom test.',
          `Add a single target at ${carry} yards.`,
          `Set 10 shots with the ${club}.`,
          'Save the test so you can run the identical thing next visit.',
        ],
        success: `Six of ten finishing inside ${feet} feet, and carry spread under ±${Math.max(3, Math.round(carry * 0.035))} yards.`,
        club,
        targetDistance: carry,
        shots: 10,
        minutes: 12,
        addresses: [finding.id],
        drills: drillsFor(['random-practice-block']),
      };
    },
  },
  {
    matches: (id) => id.startsWith('gap-'),
    build(finding, profiles) {
      const eligible = profiles
        .filter((p) => clubFamily(p.club) !== 'putter' && Number.isFinite(p.carry.median))
        .slice(0, 8);
      return {
        id: 'rx-gapping',
        mode: PRACTICE_MODES['test-center'],
        title: 'Carry ladder through the bag',
        rationale:
          'Your gapping has a problem in it, and gapping cannot be fixed from a session where each club got a handful of swings. A ladder gives every club a clean carry number to work from.',
        setup: [
          'Test Center → build a custom test.',
          'Add one target per club, at roughly the carry you expect from each.',
          'Five shots per club, working from the shortest upward.',
          'Record the median carry, not the best one — the best one is not the shot you will hit on the course.',
        ],
        success:
          'Every adjacent pair of clubs separated by 10 to 15 yards, with no two clubs covering the same number.',
        club: null,
        targetDistance: null,
        shots: Math.max(20, eligible.length * 5),
        minutes: 25,
        addresses: [finding.id],
        drills: drillsFor(['ladder-gapping']),
      };
    },
  },
  // ------------------------------------------------------- target work
  {
    matches: (id) => id === 'target-short-bias' || id === 'target-long-bias',
    build(finding) {
      const short = finding.id === 'target-short-bias';
      const bias = finding.evidence.find((e) => e.label === 'Distance bias')?.value ?? 0;
      return {
        id: 'rx-calibration',
        mode: PRACTICE_MODES['test-center'],
        title: 'Recalibrate your carry numbers',
        rationale: `You finish a median of ${Math.abs(Math.round(bias))} yards ${short ? 'short of' : 'past'} your targets. That is not a swing fault — the numbers you are playing to are wrong, and no amount of practice fixes a wrong number. This is the cheapest stroke saving available to you.`,
        setup: [
          'Test Center → build a custom test.',
          'Add a target at the honest carry for each of your five most-used clubs.',
          'Five shots per club, and write down the median carry rather than the best one.',
          `Update your yardages to what you actually carry${short ? ', then club up until the median lands on the flag' : ''}.`,
        ],
        success: 'Median carry within 3 yards of the target for every club in the test.',
        club: null,
        targetDistance: null,
        shots: 25,
        minutes: 20,
        addresses: [finding.id],
        drills: drillsFor(['ladder-gapping']),
      };
    },
  },
  {
    matches: (id) => id === 'weak-target-distance',
    build(finding) {
      const distance = finding.evidence.find((e) => e.label === 'Weakest target')?.value ?? null;
      if (distance === null) return null;
      const feet = proximityTargetFeet(distance);
      return {
        id: `rx-weak-distance-${distance}`,
        mode: PRACTICE_MODES['test-center'],
        title: `Build a repeatable test at ${distance} yards`,
        rationale: `Of every distance you were tested at, ${distance} yards scored worst by a clear margin. An hour spent there is worth more than an hour spread evenly across distances you already handle.`,
        setup: [
          'Test Center → build a custom test.',
          `One target at ${distance} yards, 10 shots.`,
          'Save it under a name you will recognise and run the identical test every visit.',
          'Track the score, not the feeling.',
        ],
        success: `Six of ten inside ${feet} feet, and a score that climbs across visits.`,
        club: null,
        targetDistance: distance,
        shots: 10,
        minutes: 15,
        addresses: [finding.id],
        drills: drillsFor(['random-practice-block']),
      };
    },
  },
  {
    matches: (id) => id === 'target-distance-spread',
    build(finding) {
      return {
        id: 'rx-target-spread',
        mode: PRACTICE_MODES.bullseye,
        title: 'Tighten distance control under a score',
        rationale:
          'Your carry lands in a wide band around the target. Scoring every shot is what makes that band shrink — unscored range balls let you ignore the misses, and Bullseye will not.',
        setup: [
          'Virtual Golf → Games → Bullseye.',
          'Pick a distance you face often on the course.',
          'Full pre-shot routine on every ball, and no re-hits.',
        ],
        success: 'Carry inside ±6 yards of the target on seven of ten shots.',
        club: null,
        targetDistance: null,
        shots: 20,
        minutes: 20,
        addresses: [finding.id],
        drills: drillsFor(['random-practice-block']),
      };
    },
  },
  {
    matches: (id) => id === 'high-mishit-rate',
    build(finding, profiles) {
      const club = finding.club;
      return {
        id: `rx-mishit-${club}`,
        mode: PRACTICE_MODES['capture-the-flag'],
        title: `Pressure-test the ${club}`,
        rationale:
          'Your mishit rate is high enough that it is costing you shots on the course rather than just yards on the range. Mishits under a scoreboard are the honest measure — they usually rise the moment a shot counts.',
        setup: [
          'Virtual Golf → Games → Capture the Flag.',
          'Change target every shot so no two swings in a row are the same.',
          'Commit to a full pre-shot routine on every ball.',
        ],
        success: 'Mishit rate under 10% across the game, matching what you produce on the range.',
        club,
        targetDistance: carryOf(profiles, club),
        shots: 18,
        minutes: 20,
        addresses: [finding.id],
        drills: drillsFor(['random-practice-block']),
      };
    },
  },
];

/** Always-available blocks that do not depend on a specific finding. */
function baselineBlocks(profiles: ClubProfile[], hasFindings: boolean): Prescription[] {
  const out: Prescription[] = [];

  if (!hasFindings) {
    out.push({
      id: 'rx-combine',
      mode: PRACTICE_MODES.combine,
      title: 'Take a Combine to get a baseline',
      rationale:
        'Nothing in this session was clear enough to act on — either it was a clean day or there were too few shots per club. The Combine is the fastest way to find out where you actually stand, because it scores ten distances in half an hour.',
      setup: [
        'TPS → Practice → Test Center → Combine.',
        'Warm up for ten minutes first. The Combine is a measurement and a cold measurement is worthless.',
        '60 shots: three at each of 60, 70, 80, 90, 100, 120, 140, 160 and 180 yards plus driver, twice through.',
      ],
      success:
        'A score you can repeat against. The number matters less than which distances scored worst.',
      club: null,
      targetDistance: null,
      shots: 60,
      minutes: 40,
      addresses: [],
      drills: [],
    });
  }

  out.push({
    id: 'rx-transfer',
    mode: PRACTICE_MODES['virtual-golf'],
    title: 'Finish on a course',
    rationale:
      'Range numbers flatter everyone. Nine holes is the only environment that tests whether anything you just worked on survives a different club, a different target and a consequence on every shot.',
    setup: [
      'Virtual Golf → Play → nine holes.',
      'Full routine on every shot, no mulligans, play the ball where it finishes.',
      'Note which of the faults you worked on reappears under a card.',
    ],
    success: 'The pattern you worked on shows up less than it did before. If it shows up just as much, the change has not transferred yet.',
    club: null,
    targetDistance: null,
    shots: 0,
    minutes: 45,
    addresses: [],
    drills: [],
  });

  return out;
}

/**
 * Build a full practice session from the diagnosis.
 *
 * Blocks come out in coaching order — build the change, then vary it, then
 * measure it, then take it to a course — rather than in severity order. A
 * session that opens with a scored test measures a swing the player has not
 * changed yet, which wastes the test and the session.
 */
export function prescribePractice(
  findings: Finding[],
  profiles: ClubProfile[],
  opts: { maxBlocks?: number } = {},
): PracticeSession {
  const { maxBlocks = 4 } = opts;
  const blocks: Prescription[] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    if (blocks.length >= maxBlocks) break;
    const template = TEMPLATES.find((t) => t.matches(finding.id));
    if (!template) continue;

    const rx = template.build(finding, profiles);
    if (!rx) continue;

    const existing = blocks.find((b) => b.id === rx.id);
    if (existing) {
      // One block can answer several findings; say so rather than repeating it.
      for (const id of rx.addresses) {
        if (!existing.addresses.includes(id)) existing.addresses.push(id);
      }
      continue;
    }
    if (seen.has(rx.id)) continue;

    seen.add(rx.id);
    blocks.push(rx);
  }

  const withBaseline = [...blocks, ...baselineBlocks(profiles, blocks.length > 0)];
  withBaseline.sort((a, b) => STAGE_ORDER[a.mode.stage] - STAGE_ORDER[b.mode.stage]);

  return {
    blocks: withBaseline,
    totalMinutes: withBaseline.reduce((sum, b) => sum + b.minutes, 0),
    note:
      blocks.length === 0
        ? 'No specific fault stood out, so this plan is about measurement rather than repair.'
        : null,
  };
}

export type { PracticeMode, PracticeModeId };
