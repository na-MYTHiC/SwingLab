import type { ShotSession } from '@swinglab/core';

/**
 * Local-only session history.
 *
 * Everything stays on the device. There is no account, no server and no
 * bill — which is a deliberate product decision, not just a cost one: a
 * player's practice data never leaves their own machine.
 *
 * localStorage is the right size for v1 (a 50-shot session is roughly 20 KB,
 * so the ~5 MB budget holds a couple of hundred sessions). Move to IndexedDB
 * when history outgrows that; `loadAll`/`save` are the only two functions
 * that would need to change.
 */

const KEY = 'swinglab.sessions.v1';

interface StoredSession {
  session: ShotSession;
  importedAt: string;
}

function reviveDates(raw: StoredSession): StoredSession {
  return {
    ...raw,
    session: {
      ...raw.session,
      startedAt: raw.session.startedAt ? new Date(raw.session.startedAt) : null,
      shots: raw.session.shots.map((s) => ({ ...s, time: s.time ? new Date(s.time) : null })),
    },
  };
}

export function loadAll(): StoredSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredSession[];
    return parsed.map(reviveDates);
  } catch {
    // A corrupt store must not brick the app; start fresh rather than crash.
    return [];
  }
}

/** Save a session, replacing any earlier import of the same file. */
export function save(session: ShotSession): StoredSession[] {
  const existing = loadAll().filter((s) => s.session.id !== session.id);
  const next = [{ session, importedAt: new Date().toISOString() }, ...existing];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded — drop the oldest and retry once.
    const trimmed = next.slice(0, Math.max(1, next.length - 5));
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    return trimmed;
  }
  return next;
}

export function remove(sessionId: string): StoredSession[] {
  const next = loadAll().filter((s) => s.session.id !== sessionId);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** Remove every stored session. Used by the "clear all" control. */
export function clearAll(): StoredSession[] {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored, or storage is blocked — either way there is nothing left.
  }
  return [];
}

export type { StoredSession };

/**
 * The pass marks a session's plan set, kept so the next one can be judged.
 *
 * Stored beside the sessions rather than inside them: a plan is derived from a
 * session and changes when the engine changes, whereas the shots are a
 * measurement and must never be rewritten. Keyed by the id of the session the
 * plan was built *from*, which is what makes "did last time's work land?"
 * answerable without guessing which plan was in force.
 */
const TARGETS_KEY = 'swinglab.targets.v1';

type TargetStore = Record<string, { savedAt: string; targets: unknown[] }>;

function readTargets(): TargetStore {
  try {
    const raw = localStorage.getItem(TARGETS_KEY);
    return raw ? (JSON.parse(raw) as TargetStore) : {};
  } catch {
    return {};
  }
}

export function saveTargets(sessionId: string, targets: unknown[]): void {
  if (targets.length === 0) return;
  try {
    const store = readTargets();
    const existing = store[sessionId];
    // Written once. Re-deriving them on every render would quietly move the
    // goalposts to match whatever the engine says today, which is precisely
    // the thing a target exists to prevent.
    if (existing) return;
    store[sessionId] = { savedAt: new Date().toISOString(), targets };
    localStorage.setItem(TARGETS_KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked. The loop degrades to no targets, which is the
    // behaviour before they existed — not worth breaking the app over.
  }
}

export function loadTargets(sessionId: string): unknown[] | null {
  const entry = readTargets()[sessionId];
  return entry ? entry.targets : null;
}

export function forgetTargets(sessionId: string): void {
  try {
    const store = readTargets();
    delete store[sessionId];
    localStorage.setItem(TARGETS_KEY, JSON.stringify(store));
  } catch {
    // Nothing stored, or storage is blocked.
  }
}
