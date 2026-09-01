// Lifetime of the "Zapisano" card shown after a note is filed — pure, so the timing is a tested number rather
// than a feeling. The component (CaptureToast.tsx) owns the timer and the gesture; this decides what is visible.

/** How long the card stays up before it leaves on its own. It shows the note's words and a button; Marko wanted it to linger (device, 2026-08-28). */
export const TOAST_VISIBLE_MS = 8000;

/** What the card announces: a note was filed, or a question about it was answered. */
export type ToastKind = 'saved' | 'answered';

export interface ToastState {
  /** The note the card points at. */
  id: string;
  /** When it appeared (ms epoch). */
  shownAt: number;
  /** The words that were just filed. */
  text: string;
  kind: ToastKind;
}

/** A new save always wins: the card points at the newest note and its clock restarts. */
export function showToast(_prev: ToastState | null, id: string, now: number, text = '', kind: ToastKind = 'saved'): ToastState {
  return { id, shownAt: now, text, kind };
}

/**
 * Show only if the card for THIS note is not up any more — answering a question right after filing must not
 * restart the card that is still draining (Marko, 2026-08-28: "samo ako je nestao onaj prvi").
 */
export function showToastIfGone(prev: ToastState | null, id: string, now: number, text = '', kind: ToastKind = 'answered'): ToastState {
  if (prev && prev.id === id && toastVisible(prev, now)) return prev;
  return showToast(prev, id, now, text, kind);
}

export function toastRemaining(state: ToastState, now: number): number {
  return Math.max(0, state.shownAt + TOAST_VISIBLE_MS - now);
}

export function toastVisible(state: ToastState | null, now: number): boolean {
  return state != null && toastRemaining(state, now) > 0;
}
