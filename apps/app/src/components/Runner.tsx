import { useEffect, useRef, useState } from 'react';
import type { PracticeSession } from '@swinglab/core';
import {
  back, elapsed, formatClock, fresh, loadRun, next, pause, resume, saveRun, toggle, totalSpent,
  type RunState,
} from '../runState.js';

/**
 * The plan, run one block at a time.
 *
 * The Practice tab is a document — four blocks, every drill, every rationale —
 * which is right for reading the night before and wrong for a phone propped on
 * a bay shelf. This shows the block you are on and nothing else: how long is
 * left, what to set up, what good looks like, and a button to move on.
 *
 * The screen is kept awake while the clock runs, because a phone that locks
 * every thirty seconds is a phone nobody will use between shots. The clock is
 * worked out from timestamps (see `runState.ts`), so a reload, a locked screen
 * or a visit to another tab costs nothing.
 */
export function Runner({
  practice, planKey, onExit,
}: {
  practice: PracticeSession;
  planKey: string;
  onExit: () => void;
}) {
  const [state, setState] = useState<RunState>(() => loadRun(planKey) ?? fresh(planKey, Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const buzzed = useRef<number | null>(null);

  // Persist every change.
  useEffect(() => { saveRun(state); }, [state]);

  // Repaint once a second while running. The tick only redraws; it never
  // carries the time, so a throttled or frozen timer cannot corrupt it.
  const running = state.since !== null && !state.done;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  // Keep the screen on while the clock runs; re-request after the tab returns,
  // which is when browsers silently release the lock.
  useEffect(() => {
    if (!running || !('wakeLock' in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        lock = await (navigator as unknown as {
          wakeLock: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
        }).wakeLock.request('screen');
      } catch { /* refused or unsupported: the clock still works */ }
    };
    void request();
    const onVisible = () => { if (document.visibilityState === 'visible') void request(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, [running]);

  const blocks = practice.blocks;
  const block = blocks[Math.min(state.block, blocks.length - 1)];
  const spentHere = elapsed(state, now);
  const allotted = (block?.minutes ?? 0) * 60_000;
  const left = allotted - spentHere;
  const over = left < 0;

  // One buzz when a block's time runs out, once per block.
  useEffect(() => {
    if (over && running && buzzed.current !== state.block) {
      buzzed.current = state.block;
      try { navigator.vibrate?.(250); } catch { /* not supported */ }
    }
  }, [over, running, state.block]);

  const act = (f: (s: RunState, t: number) => RunState) => {
    const t = Date.now();
    setNow(t);
    setState((s) => f(s, t));
  };

  const stop = () => {
    saveRun(null);
    onExit();
  };

  if (state.done || !block) {
    const spent = totalSpent(state);
    return (
      <section className="card runner runner-done">
        <h2>Plan done</h2>
        <p className="runner-total">
          <strong>{formatClock(spent)}</strong> across {blocks.length} blocks
        </p>
        <ol className="runner-summary">
          {blocks.map((b, i) => (
            <li key={b.id}>
              <span>{b.title}</span>
              <span className="runner-summary-time">
                {formatClock(state.spent[i] ?? 0)}
                <small> / {b.minutes}:00</small>
              </span>
            </li>
          ))}
        </ol>
        <div className="runner-next-step">
          <b>Now close the loop</b>
          <p>
            In TrackMan: Table View → File Options → TrackMan CSV. Import that file here and the
            next session will open by telling you which of today's targets you hit.
          </p>
        </div>
        <button type="button" className="runner-primary" onClick={stop}>Back to the plan</button>
      </section>
    );
  }

  const ticked = state.ticked[state.block] ?? [];
  const fraction = allotted > 0 ? Math.min(1, spentHere / allotted) : 0;

  return (
    <section className="card runner" aria-label="Running practice plan">
      <div className="runner-top">
        <button type="button" className="runner-exit" onClick={stop}>End</button>
        <span className="runner-count">Block {state.block + 1} of {blocks.length}</span>
      </div>

      <h2 className="runner-title">{block.title}</h2>
      <div className="mode-chip">
        <strong>{block.mode.name}</strong>
        <span>{block.mode.location}</span>
      </div>

      <div className={over ? 'runner-clock is-over' : 'runner-clock'}>
        <span className="runner-time" role="timer" aria-live="off">
          {over ? '+' : ''}{formatClock(left)}
        </span>
        <span className="runner-time-label">
          {over ? 'over — move on when ready' : `left of ${block.minutes} min`}
        </span>
        <div className="runner-bar" aria-hidden="true">
          <div style={{ width: `${fraction * 100}%` }} />
        </div>
        <button
          type="button"
          className="runner-pause"
          onClick={() => act(running ? pause : resume)}
          aria-pressed={!running}
        >
          {running ? 'Pause' : 'Resume'}
        </button>
      </div>

      <h3 className="block-sub">Set it up</h3>
      <ul className="runner-steps">
        {block.setup.map((step, i) => {
          const on = ticked.includes(i);
          return (
            <li key={step}>
              <label className={on ? 'is-on' : undefined}>
                <input type="checkbox" checked={on} onChange={() => setState((s) => toggle(s, i))} />
                <span>{step}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <p className="success">
        <b>What good looks like</b>
        {block.success}
      </p>

      {block.targets.length > 0 && (
        <div className="runner-targets">
          <b>The next import checks</b>
          <ul>
            {block.targets.map((t) => <li key={t.id}>{t.label}</li>)}
          </ul>
        </div>
      )}

      <div className="runner-nav">
        <button
          type="button"
          className="ghost-btn"
          onClick={() => act(back)}
          disabled={state.block === 0}
        >
          ← Back
        </button>
        <button
          type="button"
          className="runner-primary"
          onClick={() => act((s, t) => next(s, t, blocks.length))}
        >
          {state.block + 1 === blocks.length ? 'Finish' : 'Next block →'}
        </button>
      </div>
    </section>
  );
}
