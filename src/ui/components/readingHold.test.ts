// The reading card must be READABLE. Enrichment can finish in 300 ms; the explanation may not flash past.

import { describe, it, expect } from 'vitest';
import { readingState, remainingHold, MIN_VISIBLE_MS, STEP_AT_MS } from './readingHold';

const T0 = 1_000_000;

describe('the card is never a flash', () => {
  it('work finishing almost instantly still keeps the card up for the full window', () => {
    // The heuristic path: enrichment done after 120 ms.
    expect(readingState(T0, T0 + 120, true).visible).toBe(true);
    expect(readingState(T0, T0 + 1000, true).visible).toBe(true);
    expect(readingState(T0, T0 + MIN_VISIBLE_MS - 1, true).visible).toBe(true);
    // Only once the window has elapsed may it go.
    expect(readingState(T0, T0 + MIN_VISIBLE_MS, true).visible).toBe(false);
  });

  it('all three steps are actually reached within the guaranteed window', () => {
    const steps = new Set<number>();
    for (let t = 0; t < MIN_VISIBLE_MS; t += 50) steps.add(readingState(T0, T0 + t, true).step);
    expect([...steps].sort()).toEqual([0, 1, 2]);
  });

  it('each step gets a readable slice — at least 500 ms', () => {
    for (let i = 1; i < STEP_AT_MS.length; i++) {
      expect(STEP_AT_MS[i]! - STEP_AT_MS[i - 1]!).toBeGreaterThanOrEqual(500);
    }
    // and the last step holds until the end of the window
    expect(MIN_VISIBLE_MS - STEP_AT_MS[STEP_AT_MS.length - 1]!).toBeGreaterThanOrEqual(500);
  });
});

describe('slow work keeps the card up as long as it needs', () => {
  it('while the work runs the card stays, well past the minimum', () => {
    expect(readingState(T0, T0 + 10_000, false).visible).toBe(true);
    expect(readingState(T0, T0 + 60_000, false).visible).toBe(true);
  });

  it('the last step holds rather than claiming completion early', () => {
    expect(readingState(T0, T0 + 30_000, false).step).toBe(STEP_AT_MS.length - 1);
  });

  it('once slow work finishes, the card can go immediately (window long since passed)', () => {
    expect(readingState(T0, T0 + 30_000, true).visible).toBe(false);
  });
});

describe('progress rail', () => {
  it('runs 0 → 1 across the window and never exceeds it', () => {
    expect(readingState(T0, T0, false).progress).toBe(0);
    expect(readingState(T0, T0 + MIN_VISIBLE_MS / 2, false).progress).toBeCloseTo(0.5, 1);
    expect(readingState(T0, T0 + MIN_VISIBLE_MS, false).progress).toBe(1);
    expect(readingState(T0, T0 + 99_999, false).progress).toBe(1);
  });

  it('is robust against a clock that appears to go backwards', () => {
    const s = readingState(T0, T0 - 500, false);
    expect(s.progress).toBe(0);
    expect(s.step).toBe(0);
    expect(s.visible).toBe(true);
  });
});

describe('remainingHold tells the screen when it may drop the card', () => {
  it('is the full window at the start and zero after it', () => {
    expect(remainingHold(T0, T0)).toBe(MIN_VISIBLE_MS);
    expect(remainingHold(T0, T0 + 700)).toBe(MIN_VISIBLE_MS - 700);
    expect(remainingHold(T0, T0 + MIN_VISIBLE_MS)).toBe(0);
    expect(remainingHold(T0, T0 + 99_999)).toBe(0);
  });
});
