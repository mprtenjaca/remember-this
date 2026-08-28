// Dates the app can work out for itself, so it never wastes a question on them.
//
// Marko's rule (2026-08-25): ALWAYS ask for a birthday — the app cannot know it and guessing is worse than
// asking. But a public, church or world date ("Valentinovo", "Dan žena", "Božić", "Uskrs") is common knowledge:
// look it up, anchor it, ask nothing.
//
// Fixed dates are stored as MM-DD. Easter moves, so it is computed (Gregorian/Western, Anonymous algorithm),
// and the feasts that hang off it are offsets in days from Easter Sunday.
//
// Pure domain: no DB, no React, no network.

import type { AnchorKind } from '../types';
import { fold } from './heuristic';
import { formatMonthDay } from '../triggers/resolve';

export interface KnownDate {
  /** Canonical label shown in "Datumi" and on reminders, in the note's language. */
  label: { hr: string; en: string };
  /** Words that name this occasion (folded, diacritics-free, matched as prefixes). */
  match: string[];
  /** Fixed date as MM-DD, or an offset in days from Easter Sunday. */
  monthDay?: string;
  easterOffset?: number;
  kind: AnchorKind;
}

/**
 * Easter Sunday (Western/Gregorian) for a year — Meeus/Jones/Butcher "Anonymous" algorithm.
 * Returns local midnight of that day.
 */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day); // ⚠ month − 1: JS months are 0-indexed
}

/** MM-DD of a feast defined as an offset from Easter, in a given year. */
export function easterBasedMonthDay(year: number, offsetDays: number): string {
  const d = easterSunday(year);
  d.setDate(d.getDate() + offsetDays);
  return formatMonthDay(d.getMonth() + 1, d.getDate());
}

// Croatian public holidays, church feasts and the widely-marked world days.
// `match` entries are folded prefixes, so any case form matches ("Valentinovu", "Božića").
export const KNOWN_DATES: KnownDate[] = [
  // ── fixed, secular / public (Croatia)
  { label: { hr: 'Nova godina', en: 'New Year' }, match: ['nova godina', 'nove godine', 'novu godinu', 'new year'], monthDay: '01-01', kind: 'annual' },
  { label: { hr: 'Sveta tri kralja', en: 'Epiphany' }, match: ['sveta tri kralja', 'tri kralja', 'bogojavljenje', 'epiphany'], monthDay: '01-06', kind: 'annual' },
  { label: { hr: 'Valentinovo', en: "Valentine's Day" }, match: ['valentinov', 'valentin', 'dan zaljubljenih', 'valentine'], monthDay: '02-14', kind: 'annual' },
  { label: { hr: 'Dan žena', en: "International Women's Day" }, match: ['dan zena', 'osmi mart', 'osmi marta', 'womens day', 'women s day'], monthDay: '03-08', kind: 'annual' },
  { label: { hr: 'Dan očeva', en: "Father's Day" }, match: ['dan oceva', 'dan oca', 'fathers day', 'father s day'], monthDay: '03-19', kind: 'annual' },
  { label: { hr: 'Praznik rada', en: 'Labour Day' }, match: ['praznik rada', 'prvi maj', 'prvi maja', 'labour day', 'labor day'], monthDay: '05-01', kind: 'annual' },
  { label: { hr: 'Majčin dan', en: "Mother's Day" }, match: ['majcin dan', 'dan majki', 'dan mama', 'mothers day', 'mother s day'], monthDay: '05-11', kind: 'annual' },
  { label: { hr: 'Dan državnosti', en: 'Statehood Day' }, match: ['dan drzavnosti', 'statehood'], monthDay: '05-30', kind: 'annual' },
  { label: { hr: 'Dan antifašističke borbe', en: 'Anti-Fascist Struggle Day' }, match: ['dan antifasisticke borbe', 'antifasisticke borbe'], monthDay: '06-22', kind: 'annual' },
  { label: { hr: 'Dan pobjede', en: 'Victory Day' }, match: ['dan pobjede', 'dan domovinske zahvalnosti', 'oluja'], monthDay: '08-05', kind: 'annual' },
  { label: { hr: 'Dan svih svetih', en: "All Saints' Day" }, match: ['svi sveti', 'svih svetih', 'all saints'], monthDay: '11-01', kind: 'annual' },
  { label: { hr: 'Dan sjećanja na Vukovar', en: 'Vukovar Remembrance Day' }, match: ['dan sjecanja', 'vukovar'], monthDay: '11-18', kind: 'annual' },
  { label: { hr: 'Badnjak', en: 'Christmas Eve' }, match: ['badnjak', 'badnjaka', 'christmas eve'], monthDay: '12-24', kind: 'annual' },
  { label: { hr: 'Božić', en: 'Christmas' }, match: ['bozic', 'bozica', 'christmas', 'xmas'], monthDay: '12-25', kind: 'annual' },
  { label: { hr: 'Sveti Stjepan', en: "St Stephen's Day" }, match: ['sveti stjepan', 'stipanje', 'boxing day'], monthDay: '12-26', kind: 'annual' },
  { label: { hr: 'Silvestrovo', en: "New Year's Eve" }, match: ['silvestrov', 'stara godina', 'new years eve', 'nye'], monthDay: '12-31', kind: 'annual' },

  // ── fixed, church
  { label: { hr: 'Tijelovo', en: 'Corpus Christi' }, match: ['tijelovo', 'corpus christi'], easterOffset: 60, kind: 'annual' },
  { label: { hr: 'Velika Gospa', en: 'Assumption of Mary' }, match: ['velika gospa', 'velike gospe', 'assumption'], monthDay: '08-15', kind: 'annual' },
  { label: { hr: 'Mala Gospa', en: 'Nativity of Mary' }, match: ['mala gospa', 'male gospe'], monthDay: '09-08', kind: 'annual' },
  { label: { hr: 'Sveti Nikola', en: 'St Nicholas' }, match: ['sveti nikola', 'nikolinje'], monthDay: '12-06', kind: 'annual' },
  { label: { hr: 'Sveta Lucija', en: 'St Lucy' }, match: ['sveta lucija', 'lucijin'], monthDay: '12-13', kind: 'annual' },
  { label: { hr: 'Bezgrešno začeće', en: 'Immaculate Conception' }, match: ['bezgresno zacece', 'immaculate conception'], monthDay: '12-08', kind: 'annual' },

  // ── moveable, church (offsets in days from Easter Sunday)
  { label: { hr: 'Pepelnica', en: 'Ash Wednesday' }, match: ['pepelnica', 'ciste srijede', 'ash wednesday'], easterOffset: -46, kind: 'annual' },
  { label: { hr: 'Cvjetnica', en: 'Palm Sunday' }, match: ['cvjetnica', 'palm sunday'], easterOffset: -7, kind: 'annual' },
  { label: { hr: 'Veliki petak', en: 'Good Friday' }, match: ['veliki petak', 'velikog petka', 'good friday'], easterOffset: -2, kind: 'annual' },
  { label: { hr: 'Uskrs', en: 'Easter' }, match: ['uskrs', 'uskrsa', 'easter'], easterOffset: 0, kind: 'annual' },
  { label: { hr: 'Uskrsni ponedjeljak', en: 'Easter Monday' }, match: ['uskrsni ponedjeljak', 'easter monday'], easterOffset: 1, kind: 'annual' },
  { label: { hr: 'Duhovi', en: 'Pentecost' }, match: ['duhovi', 'duhova', 'pentecost', 'whitsun'], easterOffset: 49, kind: 'annual' },

  // ── world days people actually note
  { label: { hr: 'Dan planeta Zemlje', en: 'Earth Day' }, match: ['dan planeta zemlje', 'dan zemlje', 'earth day'], monthDay: '04-22', kind: 'annual' },
  { label: { hr: 'Svjetski dan knjige', en: 'World Book Day' }, match: ['dan knjige', 'world book day'], monthDay: '04-23', kind: 'annual' },
  { label: { hr: 'Dan djeteta', en: "Children's Day" }, match: ['dan djeteta', 'dan djece', 'childrens day'], monthDay: '11-20', kind: 'annual' },
  { label: { hr: 'Noć knjige', en: 'Night of the Book' }, match: ['noc knjige'], monthDay: '04-23', kind: 'annual' },
  { label: { hr: 'Halloween', en: 'Halloween' }, match: ['halloween', 'noc vjestica'], monthDay: '10-31', kind: 'annual' },
];

export interface KnownDateHit {
  label: string;
  monthDay: string;
  kind: AnchorKind;
  /** The canonical Croatian label, used as the anchor's identity so two notes share one anchor. */
  key: string;
}

/**
 * Does the text name an occasion the app already knows? Returns its date for THIS year's occurrence
 * (the caller resolves the next future one as usual). Never matches a birthday or a personal anniversary —
 * those are the two things we always ask about.
 */
/**
 * Does the text contain this holiday, in any Croatian case?
 *
 * Rather than listing every inflection by hand ("velika gospa", "veliku gospu", "velike gospe", …), each word
 * of the pattern is matched by its STEM: the last two letters are treated as an ending, so "velik…" + "gosp…"
 * covers the whole paradigm in one entry. Words are matched in order but need not be adjacent, so "Veliku
 * Gospu" and "Gospu Veliku" both hit while unrelated prose does not.
 *
 * Short words (≤ 4 letters, e.g. "oluja", "dan") keep their exact form — trimming those would match far too
 * much. Latin/English patterns are unaffected because they have no inflection to strip.
 */
function matchesInflected(folded: string, pattern: string): boolean {
  if (folded.includes(pattern)) return true; // exact hit, the common case
  const words = pattern.split(/\s+/).filter(Boolean);
  let from = 0;
  for (const w of words) {
    // Trim two letters from 6 up ("velika" → "velik"), one at 4–5 ("gospa" → "gosp", "mala" → "mal"); 3 and
    // under stay whole so "dan"/"tri" cannot match half the language. A 4-letter word is only trimmed when the
    // pattern has more words to anchor it ("mala gospa"), never on its own.
    const stem = w.length >= 6 ? w.slice(0, -2) : w.length >= 4 && words.length > 1 ? w.slice(0, -1) : w;
    const at = folded.indexOf(stem, from);
    if (at === -1) return false;
    from = at + stem.length;
  }
  return true;
}

export function findKnownDate(text: string, year: number, lang: 'hr' | 'en' = 'hr'): KnownDateHit | null {
  const f = fold(text);
  // Longest match wins: "dan zena" must not lose to a shorter accidental hit.
  let best: { d: KnownDate; len: number } | null = null;
  for (const d of KNOWN_DATES) {
    for (const m of d.match) {
      if (!matchesInflected(f, m)) continue;
      if (!best || m.length > best.len) best = { d, len: m.length };
    }
  }
  if (!best) return null;
  const d = best.d;
  const monthDay = d.monthDay ?? (d.easterOffset != null ? easterBasedMonthDay(year, d.easterOffset) : null);
  if (!monthDay) return null;
  return { label: d.label[lang], monthDay, kind: d.kind, key: d.label.hr };
}
