import type { SessionKind } from '../schema.js';

/**
 * The TrackMan practice modes, as they actually appear in the bay.
 *
 * The point of this catalog is that a prescription has to be executable. It
 * is useless to tell someone "work on your distance control" — they are
 * standing in a simulator bay looking at a menu, and what they need is which
 * item on that menu to pick and how to set it up. Every mode here maps to
 * something a player can actually select in TPS or TrackMan Virtual Golf.
 */

export type PracticeModeId =
  | 'range'
  | 'target-practice'
  | 'test-center'
  | 'combine'
  | 'performance-center'
  | 'bullseye'
  | 'capture-the-flag'
  | 'closest-to-pin'
  | 'longest-drive'
  | 'virtual-golf'
  | 'putting';

export interface PracticeMode {
  id: PracticeModeId;
  name: string;
  /** Where to find it in the software. */
  location: string;
  /** One line on what the mode is. */
  what: string;
  /** What it is genuinely good at training, and what it is not. */
  trains: string;
  /** The session kind an export from this mode produces. */
  producesKind: SessionKind;
  /**
   * Whether the mode scores each shot. Scored modes create pressure and
   * measure transfer; unscored modes are for building a change.
   */
  scored: boolean;
  /**
   * Where the mode sits in a practice session. Block work builds a change,
   * random work tests whether it survives variability, and scored work
   * measures whether it transfers under pressure.
   */
  stage: 'build' | 'vary' | 'measure' | 'play';
}

export const PRACTICE_MODES: Record<PracticeModeId, PracticeMode> = {
  range: {
    id: 'range',
    name: 'Practice Range',
    location: 'TPS → Practice → Driving Range',
    what: 'Free hitting with full shot data and no target scoring.',
    trains:
      'Building a mechanical change with immediate numeric feedback. Weakest at telling you whether the change survives outside the bay — range numbers flatter everyone.',
    producesKind: 'range',
    scored: false,
    stage: 'build',
  },
  'target-practice': {
    id: 'target-practice',
    name: 'Target Practice',
    location: 'TPS → Practice → Target Practice',
    what: 'Open practice with a target to aim at, at a distance you choose.',
    trains:
      'Start line and distance control together, with a real reference to miss. The step between grooving something on the range and being scored on it.',
    producesKind: 'target',
    scored: false,
    stage: 'vary',
  },
  'test-center': {
    id: 'test-center',
    name: 'Test Center',
    location: 'TPS → Practice → Test Center',
    what:
      'Build your own scored test: pick the target distances, pick how many shots at each, repeat it on later visits to see the trend.',
    trains:
      'Exactly what you tell it to. The most useful mode in the building, because a custom test turns a vague weakness into a number you can move.',
    producesKind: 'test',
    scored: true,
    stage: 'measure',
  },
  combine: {
    id: 'combine',
    name: 'TrackMan Combine',
    location: 'TPS → Practice → Test Center → Combine',
    what:
      '60 shots to fixed targets at 60, 70, 80, 90, 100, 120, 140, 160 and 180 yards plus driver — three shots at each, twice through. Every shot scored 0-100 on proximity, and an overall score at the end.',
    trains:
      'Nothing directly. It is a benchmark, not practice — its value is a single comparable number and a map of which distances are costing you.',
    producesKind: 'combine',
    scored: true,
    stage: 'measure',
  },
  'performance-center': {
    id: 'performance-center',
    name: 'Performance Center',
    location: 'TPS → Practice → Performance Center',
    what:
      'Approach shots scored in strokes gained against the PGA Tour average from the same distance.',
    trains:
      'Approach play in the currency that actually decides scores. Converts "I hit that close" into whether it beat a tour player from there.',
    producesKind: 'performance',
    scored: true,
    stage: 'measure',
  },
  bullseye: {
    id: 'bullseye',
    name: 'Bullseye',
    location: 'TrackMan Virtual Golf → Games → Bullseye',
    what: 'Concentric rings around a target; closer shots score more.',
    trains:
      'Precision under a scoreboard. The scoring makes you commit to a target, which is the thing most range practice never asks for.',
    producesKind: 'target',
    scored: true,
    stage: 'measure',
  },
  'capture-the-flag': {
    id: 'capture-the-flag',
    name: 'Capture the Flag',
    location: 'TrackMan Virtual Golf → Games → Capture the Flag',
    what: 'Claim flags by landing shots closest to each target.',
    trains:
      'Shot-by-shot commitment with changing targets, so no two swings in a row are the same. Good pressure without a full round.',
    producesKind: 'target',
    scored: true,
    stage: 'vary',
  },
  'closest-to-pin': {
    id: 'closest-to-pin',
    name: 'Closest to the Pin',
    location: 'TrackMan Virtual Golf → Games → Closest to the Pin',
    what: 'One target, scored on proximity.',
    trains: 'Single-shot execution. Useful for wedge distance control when the number matters.',
    producesKind: 'target',
    scored: true,
    stage: 'measure',
  },
  'longest-drive': {
    id: 'longest-drive',
    name: 'Longest Drive',
    location: 'TrackMan Virtual Golf → Games → Longest Drive',
    what: 'Driver only, scored on total distance.',
    trains:
      'Speed and launch conditions, with the honesty of a scoreboard. Handle with care — it rewards swinging harder, which is the opposite of what most driver problems need.',
    producesKind: 'range',
    scored: true,
    stage: 'measure',
  },
  'virtual-golf': {
    id: 'virtual-golf',
    name: 'Virtual Golf',
    location: 'TrackMan Virtual Golf → Play',
    what: 'Play real courses from the bay, one shot at a time with a card.',
    trains:
      'Transfer. Every shot is a different club to a different target with a consequence, which is the only environment that tests whether a range change is real.',
    producesKind: 'course',
    scored: true,
    stage: 'play',
  },
  putting: {
    id: 'putting',
    name: 'Putting',
    location: 'TPS → Practice → Putting',
    what: 'Putting practice with roll and stroke data.',
    trains: 'Speed and start line on the greens.',
    producesKind: 'putting',
    scored: true,
    stage: 'measure',
  },
};

export function practiceMode(id: PracticeModeId): PracticeMode {
  return PRACTICE_MODES[id];
}

/** Which mode produced a given session kind, where the mapping is unambiguous. */
export function modeForKind(kind: SessionKind): PracticeMode | null {
  switch (kind) {
    case 'combine':
      return PRACTICE_MODES.combine;
    case 'performance':
      return PRACTICE_MODES['performance-center'];
    case 'test':
      return PRACTICE_MODES['test-center'];
    case 'course':
      return PRACTICE_MODES['virtual-golf'];
    case 'putting':
      return PRACTICE_MODES.putting;
    case 'range':
      return PRACTICE_MODES.range;
    case 'target':
      return PRACTICE_MODES['target-practice'];
    default:
      return null;
  }
}
