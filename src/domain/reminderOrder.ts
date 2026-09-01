// The order reminders are listed in — by WHEN they are (or were), whatever their state or origin.
//
// The repo sorts by fire_at, but a fired one-off has fire_at cleared (markFired) and sank to the bottom regardless
// of its time, and hand-added reminders looked out of place next to the chain (Marko, 2026-08-28: "podsjetnici nisu
// sortirani… uopće"). One rule instead: the time it fires, or the time it fired; those with neither go last, in
// the order they were made.

export interface Whenable {
  fireAt: number | null;
  lastFiredAt: number | null;
  createdAt: number;
}

/** The moment a reminder is about: upcoming time, else the time it went off. */
export function whenOf(t: Whenable): number | null {
  return t.fireAt ?? t.lastFiredAt ?? null;
}

export function sortByWhen<T extends Whenable>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const wa = whenOf(a);
    const wb = whenOf(b);
    if (wa == null && wb == null) return a.createdAt - b.createdAt;
    if (wa == null) return 1;
    if (wb == null) return -1;
    return wa - wb || a.createdAt - b.createdAt;
  });
}
