// Rapid toggling must not lose a scheduled notification.
//
// The old guard was `if (running) return running` — a caller arriving mid-flight got the IN-FLIGHT promise
// back, which had already read the database. So: tick a reminder off, tick it straight back on, and the second
// refill never ran. The reminder stayed active in the DB with no OS notification behind it — silent, and
// invisible until the day it failed to fire.
//
// The fix is to coalesce forward instead of backward: whoever asks while a run is in progress gets a promise
// for a FRESH run that starts after the current one finishes. Several callers arriving during the same window
// share that one trailing run rather than queueing a stampede.

import { describe, it, expect, vi } from 'vitest';
import { coalesce } from './coalesce';

describe('coalesce', () => {
  it('runs immediately when idle', async () => {
    const work = vi.fn().mockResolvedValue('a');
    const run = coalesce(work);
    await expect(run()).resolves.toBe('a');
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('a call during a run triggers ONE more run afterwards, not a shared stale result', async () => {
    let resolveFirst: (v: string) => void = () => {};
    const work = vi
      .fn()
      .mockImplementationOnce(() => new Promise<string>((r) => (resolveFirst = r)))
      .mockResolvedValue('second');

    const run = coalesce(work);
    const a = run(); // starts
    const b = run(); // arrives mid-flight → must NOT get a's result
    resolveFirst('first');

    await expect(a).resolves.toBe('first');
    await expect(b).resolves.toBe('second');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('many callers during one run share a single trailing run', async () => {
    let resolveFirst: (v: number) => void = () => {};
    let calls = 0;
    const work = vi.fn().mockImplementation(() => {
      calls++;
      return calls === 1 ? new Promise<number>((r) => (resolveFirst = r)) : Promise.resolve(calls);
    });

    const run = coalesce(work);
    const first = run();
    const during = [run(), run(), run()]; // three taps in the same window
    resolveFirst(1);

    await first;
    const results = await Promise.all(during);
    expect(work).toHaveBeenCalledTimes(2); // one in flight + exactly one trailing
    expect(new Set(results).size).toBe(1); // they all share the trailing run
  });

  it('a failure does not wedge the lock', async () => {
    const work = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    const run = coalesce(work);
    await expect(run()).rejects.toThrow('boom');
    await expect(run()).resolves.toBe('ok'); // still usable
  });

  it('sequential calls each run — no coalescing when nothing is in flight', async () => {
    const work = vi.fn().mockResolvedValue('x');
    const run = coalesce(work);
    await run();
    await run();
    await run();
    expect(work).toHaveBeenCalledTimes(3);
  });
});
