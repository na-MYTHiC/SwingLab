/**
 * The state of a practice plan being run at the bay.
 *
 * Kept free of React and the DOM so the timing rules can be tested directly,
 * because they are the part that has to be right with the phone in a pocket.
 *
 * TIME IS STORED AS TIMESTAMPS, NEVER AS A COUNTER. A counter decremented by
 * `setInterval` stops when the phone locks or the browser throttles a
 * background tab, and a player who pockets their phone for ten minutes of
 * strike work would come back to find the clock had barely moved. Instead the
 * state records how long earlier stretches lasted and when the current one
 * began, and elapsed time is worked out from the wall clock whenever it is
 * read. A reload, a locked screen or a switch to another tab costs nothing.
 */

export interface RunState {
  /** Which plan this belongs to, so a different session's plan starts fresh. */
  key: string;
  block: number;
  /** Milliseconds banked on the current block before the latest resume. */
  banked: number;
  /** Wall-clock ms when the current stretch began; null while paused. */
  since: number | null;
  /** Ticked setup steps, per block. */
  ticked: Record<number, number[]>;
  /** Total time per finished block, for the summary. */
  spent: number[];
  done: boolean;
}

export function fresh(key: string, now: number): RunState {
  return { key, block: 0, banked: 0, since: now, ticked: {}, spent: [], done: false };
}

/** Time on the current block so far. */
export function elapsed(s: RunState, now: number): number {
  return s.banked + (s.since !== null ? Math.max(0, now - s.since) : 0);
}

export function pause(s: RunState, now: number): RunState {
  if (s.since === null) return s;
  return { ...s, banked: elapsed(s, now), since: null };
}

export function resume(s: RunState, now: number): RunState {
  if (s.since !== null || s.done) return s;
  return { ...s, since: now };
}

/** Move on, banking this block's time. The new block starts running. */
export function next(s: RunState, now: number, blocks: number): RunState {
  const spent = [...s.spent];
  spent[s.block] = (spent[s.block] ?? 0) + elapsed(s, now);
  if (s.block + 1 >= blocks) return { ...s, spent, banked: 0, since: null, done: true };
  return { ...s, spent, block: s.block + 1, banked: 0, since: now };
}

/**
 * Step back to the previous block, resuming its clock where it left off.
 * Its time comes out of `spent` and back into the running clock, so stepping
 * back and forward again never counts a minute twice.
 */
export function back(s: RunState, now: number): RunState {
  if (s.block === 0) return s;
  const spent = [...s.spent];
  const earlier = spent[s.block - 1] ?? 0;
  spent[s.block - 1] = 0;
  return { ...s, spent, block: s.block - 1, banked: earlier, since: now, done: false };
}

export function toggle(s: RunState, step: number): RunState {
  const have = s.ticked[s.block] ?? [];
  const ticked = have.includes(step) ? have.filter((x) => x !== step) : [...have, step];
  return { ...s, ticked: { ...s.ticked, [s.block]: ticked } };
}

export function totalSpent(s: RunState): number {
  return s.spent.reduce((a, b) => a + (b ?? 0), 0);
}

/** mm:ss, or h:mm:ss past the hour. Negative values read as overtime. */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

const STORE = 'swinglab.run';

export function loadRun(key: string): RunState | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const s = JSON.parse(raw) as RunState;
    return s && s.key === key ? s : null;
  } catch {
    return null;
  }
}

export function saveRun(s: RunState | null): void {
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  } catch {
    // Private browsing: the run still works, it just will not survive a reload.
  }
}
