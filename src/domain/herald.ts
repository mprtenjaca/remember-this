// Which reminder is the FACE of a note in "Danas još" / "Dolazi".
//
// A same-day pair (reconcile E23 / sameDay.ts) is two reminders: "sat prije" and "u to vrijeme". Listing the
// soonest one showed "19:00 Rođendan" for a birthday at 20:00 — the herald, not the event (Marko, 2026-08-28).
// The row should answer "when is it?", so the event is the face and the herald becomes the subtitle.

export const HOUR_MS = 60 * 60 * 1000;

/** The labels the same-day rule gives its hour-before reminder, in both UI languages. */
export function isHeraldLabel(label: string | null | undefined): boolean {
  return label === 'sat prije' || label === 'an hour before';
}

export interface Face<T> {
  /** The reminder to show — the event when the soonest one was only its herald. */
  trigger: T;
  /** When the herald fires, if the face has one. */
  heraldAt: number | null;
}

/**
 * @param sorted this note's upcoming reminders, soonest first (fireAt non-null)
 */
export function faceOf<T extends { fireAt: number | null; label: string | null }>(sorted: readonly T[]): Face<T> | null {
  const first = sorted[0];
  if (!first) return null;
  const second = sorted[1];
  if (isHeraldLabel(first.label) && second && first.fireAt != null && second.fireAt === first.fireAt + HOUR_MS) {
    return { trigger: second, heraldAt: first.fireAt };
  }
  return { trigger: first, heraldAt: null };
}
