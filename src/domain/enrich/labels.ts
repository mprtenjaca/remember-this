// How a person is named in UI copy. Pure domain: no DB, no React.
//
// Croatian possessives of names are a losing game. Our approximate rule produced "Martiov rođendan" for Marti,
// and would produce "Lukin"/"Nikolin" for Luka/Nikola — every wrong form reads as the app not knowing Croatian.
// The decision (Marko, 2026-08-25): NEVER inflect a name. Ask and label generally, with the name appended
// after a dash/separator, which is correct for every name and every gender.
//
//   before:  "Kad je Martiov rođendan?"     "Martiov rođendan · 3 tjedna prije"
//   after:   "Kad je rođendan — Marti?"     "Rođendan · Marti · 3 tjedna prije"
//   2026-08-28: the Croatian question dropped the name altogether — "Kad je rođendan?" — the card shows the note.

import type { AnchorKind, Language } from '../types';

/** Pseudo-person for a wedding anniversary — the anchor belongs to the marriage, not to a named spouse. */
export const MARRIAGE_PERSON = 'Brak';

export function kindNoun(kind: AnchorKind, lang: Language): string {
  // 'memorial' keeps the word people actually use for it ("god"), and never borrows the birthday's wording —
  // the whole point of the separate kind is that this reminder is not a celebration.
  const hr: Record<AnchorKind, string> = { birthday: 'rođendan', anniversary: 'godišnjica', annual: 'datum', oneoff: 'datum', memorial: 'god' };
  const en: Record<AnchorKind, string> = { birthday: 'birthday', anniversary: 'anniversary', annual: 'date', oneoff: 'date', memorial: 'memorial' };
  return (lang === 'hr' ? hr : en)[kind];
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The date question. "Kad je rođendan?", "Kad je godišnjica braka?", "When is Sarah's birthday?" */
export function anchorQuestionFor(person: string, kind: AnchorKind, lang: Language): string {
  if (person === MARRIAGE_PERSON) return lang === 'hr' ? 'Kad je godišnjica braka?' : 'When is your wedding anniversary?';
  if (lang === 'en') return `When is ${person}'s ${kindNoun(kind, 'en')}?`;
  // No name at all in Croatian (Marko, 2026-08-28): the card already shows the note, and "— Branki?" read as clutter.
  return `Kad je ${kindNoun(kind, 'hr')}?`;
}

/** The anchor's own label, shown in "Datumi" and on every bound reminder. "Rođendan · Marti". */
export function anchorLabelFor(person: string, kind: AnchorKind, lang: Language): string {
  if (person === MARRIAGE_PERSON) return lang === 'hr' ? 'Godišnjica braka' : 'Wedding anniversary';
  if (lang === 'en') return `${person}'s ${kindNoun(kind, 'en')}`;
  return `${cap(kindNoun(kind, 'hr'))} · ${person}`;
}
