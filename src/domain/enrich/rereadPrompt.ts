// Should editing a note's text offer to re-read it?
//
// Marko's rule (2026-08-25): the user can always fix the title and the description themselves. But if they
// change the description *substantially*, the reasoning behind the reminders is now based on text that no
// longer exists — so offer to run enrichment again. Offer, never do it silently: re-reading can move
// reminders, and hard rule 3 says a hand-made change is sacred.
//
// A trivial edit (a typo, a comma, a couple of characters) must NOT nag. This decides which is which, in pure
// TS so the threshold is testable rather than a feeling.

/** Word-level difference, 0 (identical) → 1 (nothing in common). */
export function textDistance(before: string, after: string): number {
  // Case, punctuation and diacritics are not words: "odlican" → "odličan" is the same note, better spelled.
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[.,;:!?()"„”—–-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

  const a = norm(before);
  const b = norm(after);
  if (a.length === 0 && b.length === 0) return 0;

  // Multiset overlap: repeated words count, so "sutra sutra" ≠ "sutra".
  const pool = new Map<string, number>();
  for (const w of a) pool.set(w, (pool.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of b) {
    const left = pool.get(w) ?? 0;
    if (left > 0) {
      shared++;
      pool.set(w, left - 1);
    }
  }
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - shared / longest;
}

/** Words that carry the reasoning: if one of these appears or disappears, the reminders are likely wrong now. */
const MEANINGFUL =
  /\b(sutra|prekosutra|danas|jučer|ponedjelj|utorak|srijed|četvrt|cetvrt|petak|subot|nedjelj|tjedan|tjedna|mjesec|mjeseca|godin|rođendan|rodendan|godišnjic|godisnjic|poklon|dar|kupiti|kupi|nazvati|platiti|rezervirat|servis|ujutro|navečer|navecer|popodne|\d{1,2}[.\/:]\d{1,2}|\d{1,2}\s*h\b|tomorrow|today|birthday|anniversary|gift|next\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export interface RereadDecision {
  /** Ask the user whether to re-read. */
  ask: boolean;
  /** Why — shown to nobody, but it makes the tests read like the rule. */
  reason: 'unchanged' | 'trivial' | 'changed' | 'substantial' | 'meaning-words-changed';
}

/** Above this the edit is a rewrite, not a correction — kept for the reason label and the tests. */
export const REREAD_THRESHOLD = 0.34;

/**
 * Decide whether an edit to the note's own text should offer a re-read.
 * Editing only the TITLE never triggers this — the title is a label, not the source of the reasoning.
 *
 * Marko, 2026-08-28: offer it whenever a WORD changed, not only past a threshold — the offer is one tap to
 * decline, while an unoffered re-read after a real change left reminders reasoned from text that no longer
 * exists. Only spelling, case, punctuation and diacritics stay quiet: those change no word.
 */
export function shouldOfferReread(before: string, after: string): RereadDecision {
  const a = before.trim();
  const b = after.trim();
  if (a === b) return { ask: false, reason: 'unchanged' };

  const distance = textDistance(a, b);
  if (distance === 0) return { ask: false, reason: 'trivial' };

  // A word that drives the reasoning appeared or disappeared — the reason worth naming.
  // ("nazvati Marka" → "nazvati Marka sutra" is four characters and changes everything.)
  const beforeHas = MEANINGFUL.test(a);
  const afterHas = MEANINGFUL.test(b);
  if (beforeHas !== afterHas || (afterHas && distance > 0.15)) return { ask: true, reason: 'meaning-words-changed' };

  return { ask: true, reason: distance >= REREAD_THRESHOLD ? 'substantial' : 'changed' };
}
