// "Novo" on the Today screen — the trace of what you just wrote.
//
// After a note is filed it used to vanish from Today unless it had a question or a reminder soon: nothing said
// "this landed, and here is what will happen to it" (Marko, device, 2026-08-28). This picks the notes that
// section shows. Pure, so the window and the cap are tested numbers.

/** How long a note counts as "new" on Today. A day: the morning after, Today is clean again; "Sve" keeps it. */
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Never more than this many — Today is the resurface screen, not a list. */
export const RECENT_MAX = 3;

export interface PickRecentOptions {
  now: number;
  /** Notes that already have their own card on Today (a question, "reading…", a failure) — not repeated here. */
  excludeIds?: Iterable<string>;
  windowMs?: number;
  max?: number;
}

/**
 * Notes written inside the window, newest first, minus the ones already shown as a card, capped.
 * `notes` may arrive in any order.
 */
export function pickRecent<T extends { id: string; createdAt: number }>(notes: readonly T[], opts: PickRecentOptions): T[] {
  const windowMs = opts.windowMs ?? RECENT_WINDOW_MS;
  const max = opts.max ?? RECENT_MAX;
  const exclude = new Set(opts.excludeIds ?? []);
  const since = opts.now - windowMs;
  return notes
    .filter((n) => n.createdAt >= since && n.createdAt <= opts.now && !exclude.has(n.id))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, max);
}
