// How long the "I'm reading this" card stays on screen.
//
// The problem it solves: enrichment often finishes in well under a second (the local heuristic is instant, and
// a warm model answers in ~400 ms). The note leaves `pending`, the live query fires, the card unmounts — and
// the user sees a flash of something they cannot read. An explanation nobody can read is worse than none,
// because it reads as a glitch.
//
// So the card's lifetime is decoupled from the work: once shown it stays for MIN_VISIBLE_MS, finishing its
// three steps, then reports done. Real work that takes LONGER simply keeps it up until it finishes.
//
// Pure module — no React, no timers of its own — so the arithmetic is testable.

/** Total time the card is guaranteed to stay up, in ms. Three readable steps plus a beat to land. */
export const MIN_VISIBLE_MS = 2200;

/** Per-step boundaries inside MIN_VISIBLE_MS. The last step holds until the work is actually done. */
export const STEP_AT_MS = [0, 700, 1400] as const;

export interface ReadingState {
  /** 0-based index of the step to highlight. */
  step: number;
  /** Should the card still be on screen? */
  visible: boolean;
  /** Fraction of the guaranteed window elapsed, 0..1 — drives the progress rail. */
  progress: number;
}

/**
 * What the card should show, given when it appeared, the clock now, and whether the work has finished.
 *
 * - Work still running → walk the steps, hold on the last one (never claim "done" early).
 * - Work finished early → keep going until MIN_VISIBLE_MS so all three steps are actually seen.
 * - Work finished and the window has elapsed → not visible any more.
 */
export function readingState(shownAt: number, now: number, workDone: boolean): ReadingState {
  const elapsed = Math.max(0, now - shownAt);
  const progress = Math.min(1, elapsed / MIN_VISIBLE_MS);

  // Which step are we on by the clock?
  let step = 0;
  for (let i = STEP_AT_MS.length - 1; i >= 0; i--) {
    if (elapsed >= STEP_AT_MS[i]!) {
      step = i;
      break;
    }
  }

  // While the work runs we never show the last step as complete; the card holds there.
  const visible = !workDone || elapsed < MIN_VISIBLE_MS;
  return { step, visible, progress };
}

/** ms left before the card may disappear, given the work finished at `now`. 0 = it can go now. */
export function remainingHold(shownAt: number, now: number): number {
  return Math.max(0, MIN_VISIBLE_MS - (now - shownAt));
}
