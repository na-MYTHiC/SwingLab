import { describe, expect, it } from 'vitest';
import { back, elapsed, formatClock, fresh, next, pause, resume, toggle, totalSpent } from './runState.js';

const MIN = 60_000;

describe('running a plan at the bay', () => {
  it('keeps time from the wall clock, so a locked phone loses nothing', () => {
    // No tick ever ran between these two reads: the phone was in a pocket.
    const s = fresh('k', 0);
    expect(elapsed(s, 10 * MIN)).toBe(10 * MIN);
  });

  it('stops the clock on pause and picks it up on resume', () => {
    let s = fresh('k', 0);
    s = pause(s, 3 * MIN);
    expect(elapsed(s, 50 * MIN)).toBe(3 * MIN);
    s = resume(s, 50 * MIN);
    expect(elapsed(s, 52 * MIN)).toBe(5 * MIN);
  });

  it('banks each block and starts the next one running', () => {
    let s = fresh('k', 0);
    s = next(s, 9 * MIN, 3);
    expect(s.block).toBe(1);
    expect(s.spent[0]).toBe(9 * MIN);
    expect(elapsed(s, 12 * MIN)).toBe(3 * MIN);
  });

  it('finishes after the last block', () => {
    let s = fresh('k', 0);
    s = next(s, 10 * MIN, 2);
    s = next(s, 25 * MIN, 2);
    expect(s.done).toBe(true);
    expect(totalSpent(s)).toBe(25 * MIN);
  });

  it('never counts a minute twice when stepping back and forward', () => {
    let s = fresh('k', 0);
    s = next(s, 10 * MIN, 3);   // block 0 took 10
    s = back(s, 12 * MIN);      // two minutes into block 1, go back
    expect(s.block).toBe(0);
    expect(elapsed(s, 12 * MIN)).toBe(10 * MIN);
    s = next(s, 14 * MIN, 3);   // two more on block 0
    expect(s.spent[0]).toBe(12 * MIN);
    expect(totalSpent(s)).toBe(12 * MIN);
  });

  it('ticks setup steps per block', () => {
    let s = toggle(fresh('k', 0), 2);
    expect(s.ticked[0]).toEqual([2]);
    s = toggle(s, 2);
    expect(s.ticked[0]).toEqual([]);
  });

  it('reads the clock the way a bay clock does', () => {
    expect(formatClock(9 * MIN + 5_000)).toBe('9:05');
    expect(formatClock(-(1 * MIN + 30_000))).toBe('1:30');
    expect(formatClock(65 * MIN)).toBe('1:05:00');
  });
});
