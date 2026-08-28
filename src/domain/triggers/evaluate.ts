import type { Clock } from '../clock';
import { DAY_MS } from '../clock';
import type { Surfacing, Trigger } from '../types';
import { FATIGUE } from './scoring';

/** Active triggers whose fire_at falls in (from, to], ascending. */
export function dueInWindow(triggers: Trigger[], from: number, to: number): Trigger[] {
  return triggers
    .filter((t) => t.state === 'active' && t.fireAt != null && t.fireAt > from && t.fireAt <= to)
    .sort((a, b) => a.fireAt! - b.fireAt!);
}

/**
 * Which un-reacted surfacings still count as "open on Today".
 *
 * Bounded at both ends. Without the upper bound a surfacing stamped in the FUTURE is open forever — the
 * `>= since` test is trivially true for it — so it sits on Today every day until reacted to. Dev time travel
 * produces exactly those rows, and a reminder due in January appeared on today's screen.
 */
export function isOpenOnToday(shownAt: number, reacted: boolean, since: number, until: number): boolean {
  return !reacted && shownAt >= since && shownAt <= until;
}

/**
 * Never before 08:00, never at/after 21:00 (local). Quiet-hour hits move to 08:00
 * of the next allowed morning. Wall-clock math → DST safe.
 */
export function clampToWakingHours(fireAt: number): number {
  const [quietStart, quietEnd] = FATIGUE.quietHours;
  const d = new Date(fireAt);
  const h = d.getHours();
  if (h >= quietStart) {
    d.setDate(d.getDate() + 1);
    d.setHours(quietEnd, 0, 0, 0);
    return d.getTime();
  }
  if (h < quietEnd) {
    d.setHours(quietEnd, 0, 0, 0);
    return d.getTime();
  }
  return fireAt;
}

const COUNTED_CHANNELS: ReadonlySet<Surfacing['channel']> = new Set(['notification', 'today']);

/**
 * Per-note fatigue: max 3 surfacings ever, with cooldown 7d → 30d → never.
 * "Better to miss than to falsely call."
 */
export function canSurfaceNote(noteHistory: Surfacing[], now: number): boolean {
  const counted = noteHistory.filter((s) => COUNTED_CHANNELS.has(s.channel)).sort((a, b) => a.shownAt - b.shownAt);
  const n = counted.length;
  if (n === 0) return true;
  if (n >= FATIGUE.maxFiresPerNote) return false;
  const cooldownDays = FATIGUE.cooldownDays[n - 1] ?? Infinity;
  if (!Number.isFinite(cooldownDays)) return false;
  const last = counted[n - 1]!.shownAt;
  return now - last >= cooldownDays * DAY_MS;
}

function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** How many push notifications were already shown on the local day of `now`. */
export function pushesOnDay(history: Surfacing[], now: number): number {
  return history.filter((s) => s.channel === 'notification' && sameLocalDay(s.shownAt, now)).length;
}

/**
 * Which due triggers actually get to surface between now and `until`, after every
 * anti-fatigue rule. One note at most once per plan. Higher certainty wins ties.
 */
export function planSurfacings(triggers: Trigger[], history: Surfacing[], clock: Clock, until: number): Trigger[] {
  const now = clock.now();
  const budget = FATIGUE.maxPushPerDay - pushesOnDay(history, now);
  if (budget <= 0) return [];

  const byNote = new Map<string, Surfacing[]>();
  for (const s of history) {
    const arr = byNote.get(s.noteId) ?? [];
    arr.push(s);
    byNote.set(s.noteId, arr);
  }

  const due = dueInWindow(triggers, now - DAY_MS, until) // include recently-missed
    .filter((t) => canSurfaceNote(byNote.get(t.noteId) ?? [], now))
    .sort((a, b) => b.certainty - a.certainty || a.fireAt! - b.fireAt!);

  const picked: Trigger[] = [];
  const seenNotes = new Set<string>();
  for (const t of due) {
    if (picked.length >= budget) break;
    if (seenNotes.has(t.noteId)) continue;
    seenNotes.add(t.noteId);
    picked.push(t);
  }
  return picked;
}
