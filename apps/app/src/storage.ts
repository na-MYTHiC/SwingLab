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
      // Sessions imported before conditions existed have none. Backfilling an
      // empty one keeps every consumer on the same shape instead of scattering
      // null checks through the engine.
      conditions: undefined,
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

/**
 * A whole-store backup, and the way back in.
 *
 * localStorage is not durable. Clearing site data wipes it, and iOS reclaims
 * storage from installed web apps without asking — so a player who has built
 * up months of sessions, baselines and practice targets is one browser tidy-up
 * away from losing all of it. Since everything is local by design, the backup
 * has to be a file the player holds.
 *
 * Versioned from the start: a restore that silently misreads an older export
 * would be worse than one that refuses.
 */
const BACKUP_VERSION = 1;

export interface Backup {
  app: 'swinglab';
  version: number;
  exportedAt: string;
  sessions: unknown[];
  targets: unknown;
}

export function buildBackup(): Backup {
  return {
    app: 'swinglab',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    sessions: (() => {
      try {
        const raw = localStorage.getItem(KEY);
        return raw ? (JSON.parse(raw) as unknown[]) : [];
      } catch {
        return [];
      }
    })(),
    targets: readTargets(),
  };
}

export interface RestoreResult {
  ok: boolean;
  added: number;
  skipped: number;
  message: string;
}

/**
 * Merge a backup in rather than replacing what is there.
 *
 * Replacing would make restoring an old file destructive, and the moment
 * somebody needs a backup is the moment they can least afford a second
 * mistake. Sessions already present by id are left alone.
 */
export function restoreBackup(text: string): RestoreResult {
  let parsed: Backup;
  try {
    parsed = JSON.parse(text) as Backup;
  } catch {
    return { ok: false, added: 0, skipped: 0, message: 'That file is not readable JSON.' };
  }
  if (parsed?.app !== 'swinglab' || !Array.isArray(parsed.sessions)) {
    return { ok: false, added: 0, skipped: 0, message: 'That is not a SwingLab backup.' };
  }
  if (typeof parsed.version !== 'number' || parsed.version > BACKUP_VERSION) {
    return {
      ok: false, added: 0, skipped: 0,
      message: 'That backup came from a newer version of SwingLab than this one.',
    };
  }

  const existing = loadAll();
  const seen = new Set(existing.map((s) => s.session.id));
  let added = 0;
  let skipped = 0;

  const merged = [...existing];
  for (const entry of parsed.sessions as StoredSession[]) {
    const id = entry?.session?.id;
    if (!id) { skipped += 1; continue; }
    if (seen.has(id)) { skipped += 1; continue; }
    merged.push(entry);
    seen.add(id);
    added += 1;
  }

  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
    if (parsed.targets && typeof parsed.targets === 'object') {
      const store = readTargets();
      // Existing targets win: they are the ones the current plan was judged
      // against, and overwriting them would move goalposts mid-loop.
      localStorage.setItem(
        TARGETS_KEY,
        JSON.stringify({ ...(parsed.targets as TargetStore), ...store }),
      );
    }
  } catch {
    return {
      ok: false, added: 0, skipped: 0,
      message: 'Not enough room on this device to restore that backup.',
    };
  }

  return {
    ok: true,
    added,
    skipped,
    message: skipped > 0
      ? `Restored ${added} session${added === 1 ? '' : 's'}; ${skipped} already here.`
      : `Restored ${added} session${added === 1 ? '' : 's'}.`,
  };
}
