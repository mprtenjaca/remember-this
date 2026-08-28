// Temporal parsing — deterministic, testable, model-free.
//
// Marko's architecture note (2026-08-25): dates are the one thing an LLM must never compute. A model that
// "helpfully" turns "za 2 tjedna" into a date will eventually be off by a week, and there is no test that can
// hold it. So the model's job shrinks to CLASSIFYING a phrase; this file turns the phrase into a signal and
// resolves the signal into an instant, in plain TypeScript that 60+ tests pin down.
//
//   text ──parseTemporal──► TemporalSignal[] ──resolveSignal──► { fireAt, certainty, recurring }
//
// Signals are ordered by usefulness, which is the priority the prompt used to have to explain:
//
//   deadline > absolute > relative/weekday/part > recurring > offset_from_anchor > season > contextual
//
// Two rules run through everything:
//   1. Never invent. An offset with no known occasion, a bare season, a conditional ("kad budem u Zagrebu")
//      resolve to NO date — they are still returned, because the phrase belongs in the search keywords.
//   2. Never return the past. A day-month that already passed rolls to next year; an explicit past year drops.

import type { Certainty, Intent, Language } from '../types';
import { fold } from './heuristic';

// ── the signal shape the rest of the pipeline consumes

export type TemporalSignal =
  /** "10.6.", "10.6.2027", "10. lipnja" — a calendar date, optionally with a year and an hour. */
  | { type: 'absolute'; month: number; day: number; year: number | null; hour: number | null; minute: number; text: string }
  /** "u 15h" with no day — today or tomorrow. */
  | { type: 'time_only'; hour: number; minute: number; text: string }
  /** "sutra", "za 2 tjedna", "sljedeći mjesec" — an offset from now, in calendar units. */
  | { type: 'relative'; days?: number; weeks?: number; months?: number; years?: number; hour: number | null; minute: number; approximate: boolean; text: string }
  /** "u petak", "sljedeći petak", "ove subote". */
  | { type: 'weekday'; weekday: number; occurrence: 'next' | 'following'; hour: number | null; minute: number; text: string }
  /** "krajem tjedna", "sredinom mjeseca", "krajem godine" — a named part of a period. */
  | { type: 'part'; of: 'week' | 'month' | 'year'; at: 'start' | 'mid' | 'end'; next: boolean; hour: number; minute: number; text: string }
  /**
   * "prva srida u misecu", "zadnji petak u mjesecu", "prvi vikend u 7. misecu" — the Nth (or last) weekday of a
   * month. `month` is 1–12 when the month was named, else null meaning "the relevant one" (this month if the
   * day is still ahead, otherwise next).
   */
  | {
      type: 'nth_weekday';
      weekday: number;
      nth: number | 'last';
      month: number | null;
      /** Months from now when the sentence says "za 2 miseca" / "sljedećeg mjeseca" rather than naming one. */
      monthOffset?: number;
      hour: number | null;
      minute: number;
      text: string;
    }
  /** "ujutro", "navečer" — an hour band with no day of its own. */
  | { type: 'day_part'; part: 'morning' | 'noon' | 'afternoon' | 'evening' | 'dusk' | 'night'; text: string }
  /** "do petka", "najkasnije 15.9.", "prije petka" — the LAST useful moment. */
  | { type: 'deadline'; signal: TemporalSignal; text: string }
  /** "2 dana prije Aninog rođendana" — resolved later, against an anchor. */
  | { type: 'offset_from_anchor'; offsetDays: number; subject: string | null; text: string }
  /** "svakih 6 mjeseci", "svaki ponedjeljak", "svake godine". */
  | { type: 'recurring'; rule: 'daily' | 'weekly' | 'monthly' | 'yearly'; months?: number; weekday?: number; text: string }
  /** "ljeti", "prije ljeta", "oko Božića" — deliberately imprecise. */
  | { type: 'season'; season: 'spring' | 'summer' | 'autumn' | 'winter' | 'around'; text: string }
  /** "kad budem u Zagrebu" — not a time at all; keep the phrase for semantic search. */
  | { type: 'contextual'; phrase: string; text: string };

export interface ResolvedTime {
  /** Local epoch ms, or null when the signal deliberately has no date (contextual, unresolved offset, season). */
  fireAt: number | null;
  certainty: Certainty;
  recurring?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** For offsets: hand these to the anchor machinery instead of a fire time. */
  offsetDays?: number;
}

/** Hour used when a date carries no time. Per intent, never asked (hard rule 5). */
export const DEFAULT_HOUR: Record<string, number> = {
  task: 9,
  gift: 10,
  future_need: 9,
  idea: 10,
  fact: 9,
  contact: 9,
};

const HOUR_OF_PART: Record<string, number> = { morning: 9, noon: 12, afternoon: 15, dusk: 18, evening: 19, night: 21 };

const MONTH_STEMS: Record<string, number> = {
  sijec: 1, velja: 2, ozuj: 3, travn: 4, svib: 5, lip: 6, srp: 7, kolovoz: 8, ruj: 9, listopad: 10, studen: 11, prosin: 12,
  januar: 1, februar: 2, mart: 3, april: 4, maj: 5, jun: 6, jul: 7, august: 8, septemb: 9, oktob: 10, novemb: 11, decemb: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, june: 6, july: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Weekday stems, folded. Index = JS getDay().
// Dialect is not an edge case here: people dictate the way they speak, and Whisper transcribes it faithfully.
// Ikavica ("srida", "u sridu", "ponediljak", "nedija") is ordinary Dalmatian speech, and without these stems
// "nazvati kuma u sridu" parsed to no date at all — a good title and no reminder, which is the worst outcome.
// Stems are matched against fold(), so diacritics are already gone by the time they are compared.
const WEEKDAY_STEMS: string[][] = [
  ['nedjelj', 'nedilj', 'nedij', 'nedelj', 'sunday', 'sun'],
  ['ponedjelj', 'ponedilj', 'ponedelj', 'pondelj', 'monday', 'mon'],
  ['utorak', 'utork', 'tuesday', 'tue'],
  ['srijed', 'srid', 'sred', 'wednesday', 'wed'],
  ['cetvrt', 'cetrt', 'cetrtek', 'thursday', 'thu'],
  ['petak', 'petk', 'petek', 'friday', 'fri'],
  ['subot', 'sabot', 'saturday', 'sat'],
];

const NEXT_WORDS = /\b(sljedec\w*|iduc\w*|next)\b/;
const THIS_WORDS = /\b(ovaj|ovog|ove|ovu|this)\b/;

/**
 * "next year" as a qualifier on something else: "sljedeće godine u rujnu", "dogodine za Božić", "nagodinu".
 *
 * Distinct from NEXT_WORDS + "godina", which is the whole signal ("sljedeće godine" alone → 1 Jan). Here the
 * year only shifts a month/date that the sentence names separately. Without this the year was dropped
 * outright: "sljedeće godine u rujnu" resolved to THIS September, i.e. next month.
 */
const NEXT_YEAR_QUALIFIER = /\b(sljedec\w*|iduc\w*|naredn\w*|next)\s+(godin\w*|year)\b|\b(dogodine|nagodinu|na\s+godinu)\b/;

/** Years to add to a named month/date because the sentence said so. 0 when it did not. */
function yearShift(f: string): number {
  return NEXT_YEAR_QUALIFIER.test(f) ? 1 : 0;
}

function p2(n: number): number {
  return n;
}

/**
 * Add calendar months, clamping the day instead of overflowing.
 *
 * `d.setMonth(d.getMonth() + 1)` on 31 January gives 3 March, because February has no 31st and JS rolls over.
 * Every "za mjesec dana" written at the end of a month hit that. Clamping to the last valid day is what a
 * person means by "a month from now".
 */
function addMonths(base: Date, months: number): Date {
  const day = base.getDate();
  const d = new Date(base);
  d.setDate(1); // park on a day every month has, so the month arithmetic cannot roll over
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/** Local midnight of a day offset from `base`. */
function dayAt(base: number, addDays: number, hour: number, minute = 0): number {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

// ─────────────────────────────────────────────────────────────────────────────
// parsing

/**
 * Hour/minute written anywhere in the text: "u 15h", "15:30", "at 3pm", "u 8 ujutro", "u 2 popodne", "u 2".
 *
 * The hard part is a bare small number. "Nazvati u 2" is never 02:00 — nobody schedules a call for two in the
 * morning — so a bare 1–7 is read as the afternoon/evening one, exactly as a person would hear it. A named
 * part of the day overrides that ("u 2 ujutro" really is 02:00), and anything written in 24h form or with
 * minutes is left alone.
 */
function parseClock(f: string): { hour: number; minute: number } | null {
  const withUnit = /\b(?:u|at|@)?\s*(\d{1,2})(?::(\d{2}))?\s*(h|sati|sat|am|pm)\b/.exec(f);
  const withMinutes = /\b(?:u|at|@)\s*(\d{1,2})(?::(\d{2}))\b/.exec(f);
  // A bare "u 2" / "u 7" with no unit and no minutes — only after a preposition, so plain numbers in the text
  // ("kupiti 2 karte") are not mistaken for a time.
  const bare = /\b(?:u|at|@)\s*(\d{1,2})(?!\s*[:.\d])(?!\s*(?:h|sati|sat|am|pm|eur|kn|km|min))\b/.exec(f);
  const m = withUnit ?? withMinutes ?? bare;
  if (!m) return null;

  let hour = Number(m[1]);
  const suffix = m[3];
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;

  // A named part of the day decides an ambiguous hour, in either direction.
  const part = parseDayPart(f)?.part;
  const explicit24h = hour > 12 || !!m[2] || suffix === 'am' || suffix === 'pm';
  if (!explicit24h && hour >= 1 && hour <= 11) {
    if (part === 'afternoon' || part === 'evening' || part === 'night') hour += 12;
    else if (part === 'morning' || part === 'noon') {
      /* keep as written: "u 7 ujutro" is 07:00 */
    } else if (hour <= 7) {
      hour += 12; // bare 1–7 → the afternoon one. 8–11 stay morning hours.
    }
  }
  if (hour < 0 || hour > 23) return null;
  return { hour, minute: Number(m[2] ?? 0) };
}

/** A named part of the day, if the text says one. */
function parseDayPart(f: string): TemporalSignal & { type: 'day_part' } | null {
  // Order matters: the more specific phrase has to be tested before the one it contains, or "kasno navečer"
  // matches "navečer" and lands at 19:00 instead of 21:00, and "predvečer" never gets its own hour.
  const table: Array<[RegExp, 'morning' | 'noon' | 'afternoon' | 'evening' | 'dusk' | 'night']> = [
    [/\b(kasno\s+navecer|kasno\s+uvecer|late\s+night)\b/, 'night'],
    [/\b(predvecer|pred\s+vecer|predveče\w*)\b/, 'dusk'],
    [/\b(ujutro|jutro|prijepodne|morning)\b/, 'morning'],
    [/\b(oko\s+podne|podne|noon)\b/, 'noon'],
    [/\b(popodne|poslijepodne|afternoon)\b/, 'afternoon'],
    [/\b(navecer|vecer\w*|tonight|evening)\b/, 'evening'],
    [/\b(nocu|noc|night)\b/, 'night'],
  ];
  for (const [re, part] of table) {
    const m = re.exec(f);
    if (m) return { type: 'day_part', part, text: m[0] };
  }
  return null;
}

/** "10.6.", "10.6.2027", "10/6", "10. lipnja", "lipnja 10" — but never an hour like "u 10.30". */
function parseAbsolute(text: string, f: string): { month: number; day: number; year: number | null; text: string } | null {
  const numeric = /(?:^|[\s(])(\d{1,2})[./](\d{1,2})\.?(?:\s?(\d{4}))?(?=$|[\s,.;!?)])/g;
  let m: RegExpExecArray | null;
  while ((m = numeric.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 4), m.index + 1).toLowerCase();
    if (/\b(u|at|od|do)\s$/.test(before + ' ') && !m[3]) continue; // "u 10.30" is a clock
    // A word that introduces an identifier makes the number an identifier, not a date: "verzija 2.10",
    // "model 3.5", "soba 1.2", "broj police 12.09". Turning those into reminders is a pure false positive.
    const lead = fold(text.slice(Math.max(0, m.index - 24), m.index));
    if (/\b(verzij\w*|version|model\w*|br|broj\w*|number|no|soba|stan|kat|sifr\w*|sifra|kod|code|polic\w*|racun\w*|artikl\w*|serij\w*|tip)\s*\.?\s*$/.test(lead)) continue;
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return { day, month, year: m[3] ? Number(m[3]) : null, text: m[0].trim() };
    }
  }
  // "10. lipnja" / "lipnja 10" / bare "u listopadu"
  const named = /\b(\d{1,2})\.?\s+([a-zčćžšđ]{3,})/.exec(f);
  if (named) {
    const day = Number(named[1]);
    const month = monthFromWord(named[2]!);
    if (month && day >= 1 && day <= 31) return { day, month, year: null, text: named[0] };
  }
  return null;
}

function monthFromWord(word: string): number | null {
  const w = fold(word).replace(/\.$/, '');
  for (const [stem, n] of Object.entries(MONTH_STEMS)) if (w.startsWith(stem)) return n;
  return null;
}

/**
 * A month named with no day: "u listopadu", "sljedeći lipanj".
 * Requires a preposition/determiner cue — without it, ordinary words are matched as months by their stem
 * ("nazvati Marka" → "mar" → March, which turned a 15h reminder into next March).
 */
function parseBareMonth(f: string): { month: number; next: boolean; text: string } | null {
  const m = /\b(u|in|sljedec\w*|iduc\w*|next|pocetkom|krajem|sredinom)\s+([a-zčćžšđ]{4,})\b/g;
  let hit: RegExpExecArray | null;
  while ((hit = m.exec(f))) {
    const month = monthFromWord(hit[2]!);
    if (month) return { month, next: NEXT_WORDS.test(hit[0]), text: hit[0].trim() };
  }
  return null;
}

// A relation to a future EVENT rather than to the calendar: "kad budem u Zagrebu", "prije sljedećeg putovanja",
// "nakon povratka". These must never become a date — the phrase becomes search keywords instead.
const CONTEXTUAL =
  /\b(kad|kada|ako|nakon\s+(?:sto|što)|prije\s+sljedec\w*|prije\s+put\w*|nakon\s+povratk\w*|kad\s+god|when|if|once)\b[^.,;!?]{0,60}/;
const CONTEXTUAL_MARKERS =
  /\b(kad\s+bud\w*|kad\s+zavrsim|kad\s+opet|kad\s+nadem|kad\s+stigne|kad\s+krenem|kad\s+idem|ako\s+bud\w*|ako\s+se|ako\s+opet|nakon\s+sto|prije\s+sljedec\w*|prije\s+put\w*|nakon\s+povratk\w*|nakon\s+kupnj\w*|when\s+i|once\s+i|if\s+i)\b/;

const ORDINAL_WORDS: Record<string, number> = {
  prv: 1, drug: 2, trec: 3, cetvrt: 4, pet: 5,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
};

/** The month a phrase names: "u 7. misecu", "u srpnju", "sljedeći misec". Null when none is named. */
function namedMonth(f: string): number | null {
  // A duration is not a month name: "svakih 6 mjeseci" and "za 6 mjeseci" are lengths of time, while
  // "u 9. mjesecu" is September. The ordinal dot is the giveaway, and duration wording is refused outright.
  if (/\b(za|svak\w*|every|in)\s+\d{1,2}\s*(mjesec|misec|month)/.test(f)) return null;
  const numeric = /\b(\d{1,2})\.\s*(?:mjesec\w*|misec\w*|month)\b/.exec(f);
  if (numeric) {
    const n = Number(numeric[1]);
    if (n >= 1 && n <= 12) return n;
  }
  const named = /\b(?:u|in|tijekom)\s+([a-zčćžšđ]{4,})\b/.exec(f);
  if (named) {
    const m = monthFromWord(named[1]!);
    if (m) return m;
  }
  return null;
}

/**
 * "prva srida u misecu", "zadnji petak u mjesecu", "prvi vikend u 7. misecu".
 *
 * A weekend counts as Saturday — "prvi vikend u srpnju" means the first Saturday, which is what people turn up
 * for. Requires the "u ... mjesecu" tail so an ordinary "prvi petak" in prose is not swept up.
 */
function parseNthWeekday(f: string, hour: number | null, minute: number): (TemporalSignal & { type: 'nth_weekday' }) | null {
  const re = /\b(prv\w*|drug\w*|trec\w*|cetvrt\w*|pet\w*|zadnj\w*|posljednj\w*|first|second|third|last)\s+([a-zčćžšđ]{4,})\b/;
  const m = re.exec(f);
  if (!m) return null;

  // The phrase has to scope to a month somehow, or "prvi tjedan"/"prvi put" would match. Three ways count:
  // an explicit tail ("u 7. mjesecu", "u srpnju"), or a relative month elsewhere in the sentence
  // ("za 3 mjeseca prvi ponedjeljak", "prva srida sljedećeg miseca") — the latter two carry the month too.
  const hasMonthTail = /\b(u|in)\s+\d{0,2}\.?\s*(mjesec\w*|misec\w*|month)\b/.test(f) || /\b(u|in)\s+[a-zčćžšđ]{4,}\b/.test(f);
  const hasRelativeMonth =
    /\b(?:za|in)\s+\d{1,2}\s*(?:mjesec\w*|misec\w*|months?)\b/.test(f) || /\b(sljedec\w*|iduc\w*|next)\s+(mjesec\w*|misec\w*|month)\b/.test(f);
  if (!hasMonthTail && !hasRelativeMonth) return null;

  const word = m[2]!;
  let weekday: number | null = null;
  if (/^vikend/.test(word)) weekday = 6; // "prvi vikend" = the first Saturday
  else {
    for (let i = 0; i < 7; i++) if (WEEKDAY_STEMS[i]!.some((s) => word.startsWith(s))) weekday = i;
  }
  if (weekday == null) return null;

  const ordWord = m[1]!;
  let nth: number | 'last' = 1;
  if (/^(zadnj|posljednj|last)/.test(ordWord)) nth = 'last';
  else {
    for (const [stem, n] of Object.entries(ORDINAL_WORDS)) {
      if (ordWord.startsWith(stem)) {
        nth = n;
        break;
      }
    }
  }
  // Which month the phrase belongs to. Either it is named ("u 12. mjesecu"), or the sentence shifts it
  // relatively ("za 2 miseca", "sljedećeg mjeseca") — without this every "prva nedjelja" landed on the next
  // one regardless of what the note said.
  const relMonths = /\b(?:za|in)\s+(\d{1,2})\s*(?:mjesec\w*|misec\w*|months?)\b/.exec(f);
  const nextMonth = /\b(sljedec\w*|iduc\w*|next)\s+(mjesec\w*|misec\w*|month)\b/.test(f);
  const monthOffset = relMonths ? Number(relMonths[1]) : nextMonth ? 1 : undefined;

  return { type: 'nth_weekday', weekday, nth, month: namedMonth(f), monthOffset, hour, minute, text: m[0] };
}

/** Recurring: "svakih 6 mjeseci", "svaki ponedjeljak", "jednom godišnje". */
function parseRecurring(f: string): (TemporalSignal & { type: 'recurring' }) | null {
  if (/\b(jednom\s+godisnje|svake\s+godine|svaki\s+rodendan|godisnje|yearly|annually|every\s+year)\b/.test(f)) {
    const m = /\b(jednom\s+godisnje|svake\s+godine|svaki\s+rodendan|godisnje|yearly|annually|every\s+year)\b/.exec(f)!;
    return { type: 'recurring', rule: 'yearly', text: m[0] };
  }
  const nMonths = /\b(?:svak\w*|every)\s+(\d{1,2})\s*(mjesec\w*|months?)\b/.exec(f);
  if (nMonths) return { type: 'recurring', rule: 'monthly', months: Number(nMonths[1]), text: nMonths[0] };
  const nMonthsIh = /\b(?:svakih|svaka)\s+(\d{1,2})\s*(mjesec\w*|months?)\b/.exec(f);
  if (nMonthsIh) return { type: 'recurring', rule: 'monthly', months: Number(nMonthsIh[1]), text: nMonthsIh[0] };
  if (/\b(svaki\s+mjesec|mjesecno|monthly|every\s+month)\b/.test(f)) {
    const m = /\b(svaki\s+mjesec|mjesecno|monthly|every\s+month)\b/.exec(f)!;
    return { type: 'recurring', rule: 'monthly', months: 1, text: m[0] };
  }
  // "svaki ponedjeljak"
  const every = /\b(?:svak\w*|every)\s+([a-zčćžšđ]{4,})\b/.exec(f);
  if (every) {
    for (let i = 0; i < 7; i++) {
      if (WEEKDAY_STEMS[i]!.some((s) => every[1]!.startsWith(s))) {
        return { type: 'recurring', rule: 'weekly', weekday: i, text: every[0] };
      }
    }
  }
  if (/\b(svaki\s+dan|svako\s+jutro|dnevno|daily|every\s+day)\b/.test(f)) {
    const m = /\b(svaki\s+dan|svako\s+jutro|dnevno|daily|every\s+day)\b/.exec(f)!;
    return { type: 'recurring', rule: 'daily', text: m[0] };
  }
  return null;
}

/** "2 dana prije", "tjedan prije", "dan poslije" — an offset that needs an occasion to hang on. */
function parseOffset(f: string): (TemporalSignal & { type: 'offset_from_anchor' }) | null {
  // "tjedan DANA prije" — Croatian inserts a filler noun between the unit and the direction, so allow it.
  const re =
    /\b(?:(\d{1,2})\s*)?(dan|dana|tjedan|tjedna|tjedne|mjesec|mjeseca|days?|weeks?|months?)(?:\s+dana)?\s+(prije|ranije|before|earlier|poslije|nakon|kasnije|after|later)\b/;
  const m = re.exec(f);
  if (!m) return null;
  const n = m[1] ? Number(m[1]) : 1;
  const unit = m[2]!;
  const dir = /prije|ranije|before|earlier/.test(m[3]!) ? -1 : 1;
  let days = n;
  if (/^(tjed|week)/.test(unit)) days = n * 7;
  else if (/^(mjes|mises|misec|month)/.test(unit)) days = n * 30;
  // What the offset hangs off: the occasion word after it, if any.
  const subject = /\b(rodendan\w*|godisnjic\w*|birthday|anniversary)\b/.exec(f)?.[0] ?? null;
  return { type: 'offset_from_anchor', offsetDays: dir * days, subject, text: m[0] };
}

const SEASONS: Array<[RegExp, 'spring' | 'summer' | 'autumn' | 'winter' | 'around']> = [
  [/\b(prolje\w*|na\s+prolje\w*|spring)\b/, 'spring'],
  [/\b(ljet\w*|preko\s+ljeta|prije\s+ljeta|nakon\s+ljeta|pred\s+ljeto|summer)\b/, 'summer'],
  [/\b(jesen\w*|na\s+jesen|autumn|fall)\b/, 'autumn'],
  [/\b(zim\w*|winter)\b/, 'winter'],
  [/\b(oko\s+\w+|pred\s+\w+|around)\b/, 'around'],
];

/**
 * All temporal signals in the text, most useful first.
 * Never throws; an empty array means "no time signal at all".
 */
export function parseTemporal(text: string, now: number): TemporalSignal[] {
  const f = fold(text);
  const out: TemporalSignal[] = [];

  const clock = parseClock(f);
  const dayPart = parseDayPart(f);
  // An hour from a named part of the day, when no clock was written.
  const partHour = dayPart ? HOUR_OF_PART[dayPart.part]! : null;
  const hour = clock?.hour ?? partHour ?? null;
  const minute = clock?.minute ?? 0;

  // "do petka" / "najkasnije" = the last useful moment. "nakon petka" = the day after — the opposite, so an
  // "after" word disqualifies the deadline reading and shifts the resolved day by +1.
  const deadlineWord = /\b(do|najkasnije|deadline|rok|by)\b/.exec(f) ?? (/\bprije\s+\w/.test(f) && !/\bprije\s+sljedec/.test(f) ? /\bprije\b/.exec(f) : null);
  const afterWord = /\b(nakon|poslije|after)\s+(?!sto\b)/.exec(f);

  // ── relative day words
  const rel = (): TemporalSignal | null => {
    // Nearest first: "sutra ujutro, a ako ne, prekosutra" is a reminder for TOMORROW with a fallback the user
    // named themselves — never the later of the two.
    if (/\b(sutra|tomorrow)\b/.test(f)) return { type: 'relative', days: 1, hour, minute, approximate: false, text: 'sutra' };
    // Standard + ikavica (prikosutra) + kajkavian (prekjutro/prekojutro).
    if (/\b(prekosutra|preksutra|prikosutra|priksutra|prekjutro|prekojutro|day after tomorrow)\b/.test(f))
      return { type: 'relative', days: 2, hour, minute, approximate: false, text: 'prekosutra' };
    if (/\b(danas|today|tonight|veceras)\b/.test(f)) return { type: 'relative', days: 0, hour, minute, approximate: false, text: 'danas' };

    // "za 2-3 tjedna" — a range: take the first number, mark it approximate
    const range = /\b(?:za|in)\s+(\d{1,3})\s*[-–do]\s*(\d{1,3})\s*(dan\w*|tjed\w*|mjesec\w*|days?|weeks?|months?)\b/.exec(f);
    if (range) {
      const n = Number(range[1]);
      const unit = range[3]!;
      const s: TemporalSignal = { type: 'relative', hour, minute, approximate: true, text: range[0] };
      if (/^(tjed|week)/.test(unit)) return { ...s, weeks: n };
      if (/^(mjes|mises|misec|month)/.test(unit)) return { ...s, months: n };
      return { ...s, days: n };
    }

    const n = /\b(?:za|in)\s+(\d{1,3})\s*(dan|dana|tjedan|tjedna|tjedana|mjesec|mjeseca|mjeseci|misec|miseca|miseci|godin\w*|days?|weeks?|months?|years?)\b/.exec(f);
    if (n) {
      const v = Number(n[1]);
      const unit = n[2]!;
      const s: TemporalSignal = { type: 'relative', hour, minute, approximate: false, text: n[0] };
      if (/^(tjed|week)/.test(unit)) return { ...s, weeks: v };
      if (/^(mjes|mises|misec|month)/.test(unit)) return { ...s, months: v };
      if (/^(godin|year)/.test(unit)) return { ...s, years: v };
      return { ...s, days: v };
    }
    // "za tjedan dana", "za mjesec dana"
    if (/\bza\s+tjedan\s+dana\b/.test(f)) return { type: 'relative', weeks: 1, hour, minute, approximate: false, text: 'za tjedan dana' };
    if (/\bza\s+(mjesec|misec)\s+dana\b/.test(f)) return { type: 'relative', months: 1, hour, minute, approximate: false, text: 'za mjesec dana' };
    if (/\bza\s+godinu\s+dana\b/.test(f)) return { type: 'relative', years: 1, hour, minute, approximate: false, text: 'za godinu dana' };
    if (/\bza\s+koji\s+dan\b/.test(f)) return { type: 'relative', days: 3, hour, minute, approximate: true, text: 'za koji dan' };
    if (NEXT_WORDS.test(f) && /\b(tjedan|week)\b/.test(f)) return { type: 'relative', weeks: 1, hour, minute, approximate: false, text: 'sljedeci tjedan' };
    if (NEXT_WORDS.test(f) && /\b(mjesec|misec|month)\b/.test(f)) return { type: 'relative', months: 1, hour, minute, approximate: false, text: 'sljedeci mjesec' };
    // "sljedeće godine" is only a signal of its OWN when the sentence names nothing more specific. With a
    // month beside it ("sljedeće godine u rujnu") the year is a qualifier on that month, handled below —
    // returning 1 January here would bury the month the user actually wrote.
    if (NEXT_YEAR_QUALIFIER.test(f) && namedMonth(f) == null && !parseBareMonth(f))
      return { type: 'relative', years: 1, hour, minute, approximate: false, text: 'sljedece godine' };
    return null;
  };

  // ── week / month / year parts
  const part = (): TemporalSignal | null => {
    const next = NEXT_WORDS.test(f);
    if (/\b(kraj|krajem|pred\s+kraj)\s+(?:ovog\s+|sljedec\w*\s+|iduc\w*\s+)?(tjedn\w*|week)\b/.test(f))
      return { type: 'part', of: 'week', at: 'end', next, hour: hour ?? 15, minute, text: 'krajem tjedna' };
    if (/\b(pocetk\w*|pocetak)\s+(?:ovog\s+|sljedec\w*\s+)?(tjedn\w*|week)\b/.test(f))
      return { type: 'part', of: 'week', at: 'start', next, hour: hour ?? 9, minute, text: 'pocetkom tjedna' };
    if (/\b(sredin\w*|sredinom)\s+(?:ovog\s+|sljedec\w*\s+)?(tjedn\w*|week)\b/.test(f))
      return { type: 'part', of: 'week', at: 'mid', next, hour: hour ?? 12, minute, text: 'sredinom tjedna' };
    if (/\b(kraj|krajem)\s+(?:ovog\s+|sljedec\w*\s+|iduc\w*\s+)?(mjesec\w*|misec\w*|month)\b/.test(f))
      return { type: 'part', of: 'month', at: 'end', next, hour: hour ?? 10, minute, text: 'krajem mjeseca' };
    if (/\b(pocetk\w*|pocetak)\s+(?:ovog\s+|sljedec\w*\s+)?(mjesec\w*|misec\w*|month)\b/.test(f))
      return { type: 'part', of: 'month', at: 'start', next, hour: hour ?? 9, minute, text: 'pocetkom mjeseca' };
    if (/\b(sredin\w*|sredinom)\s+(?:ovog\s+|sljedec\w*\s+)?(mjesec\w*|misec\w*|month)\b/.test(f))
      return { type: 'part', of: 'month', at: 'mid', next, hour: hour ?? 10, minute, text: 'sredinom mjeseca' };
    if (/\b(kraj|krajem)\s+(?:ove\s+|sljedec\w*\s+)?(godin\w*|year)\b/.test(f))
      return { type: 'part', of: 'year', at: 'end', next, hour: hour ?? 10, minute, text: 'krajem godine' };
    if (/\b(pocetk\w*|pocetak)\s+(?:ove\s+|sljedec\w*\s+)?(godin\w*|year)\b/.test(f))
      return { type: 'part', of: 'year', at: 'start', next, hour: hour ?? 9, minute, text: 'pocetkom godine' };
    // "za vikend" / "ovog vikenda" → the coming Saturday
    if (/\b(za\s+vikend|ovog\s+vikenda|vikend\w*|weekend)\b/.test(f))
      return { type: 'weekday', weekday: 6, occurrence: 'next', hour, minute, text: 'vikend' };
    return null;
  };

  // ── weekday — ALL of them, in the order they appear. A note can name two ("u petak navečer … u subotu"):
  //    the first is when to remind, the later one is content the reminder is about.
  const weekdays = (): Array<TemporalSignal & { type: 'weekday'; at: number }> => {
    const found: Array<TemporalSignal & { type: 'weekday'; at: number }> = [];
    for (let i = 0; i < 7; i++) {
      for (const stem of WEEKDAY_STEMS[i]!) {
        // The cue set includes the deadline/after prepositions ("do petka", "nakon petka", "prije petka"),
        // because in Croatian a bare weekday noun is not a date on its own.
        // "v" is the kajkavian preposition ("v sredu", "v petek") — the same role as "u" in the standard.
        const re = new RegExp(`\\b(u|v|on|ovaj|ovog|ove|ovu|sljedec\\w*|iduc\\w*|next|this|do|prije|nakon|poslije|od|najkasnije)\\s+(${stem}\\w*)\\b`, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(f))) {
          // "sljedeći petak" says it directly; "sljedeći tjedan u petak" says it about the WEEK, and means the
          // same day. Both have to count, or the reminder lands seven days early.
          const nextWeekPhrase = /\b(sljedec\w*|iduc\w*|next)\s+(tjedan|tjedn\w*|week)\b/.test(f);
          const following = NEXT_WORDS.test(m[1]!) || nextWeekPhrase;
          found.push({ type: 'weekday', weekday: i, occurrence: following ? 'following' : 'next', hour, minute, text: m[0].trim(), at: m.index });
          break; // one hit per stem is enough
        }
      }
    }
    return found.sort((a, b) => a.at - b.at);
  };

  // Build the candidate list in priority order.
  const abs = parseAbsolute(text, f);
  const recurring = parseRecurring(f);
  const offset = parseOffset(f);
  const relative = rel();
  const partSig = part();
  const nth = parseNthWeekday(f, hour, minute);
  const wds = weekdays();
  const wdSig = wds[0] ?? null;

  const candidates: TemporalSignal[] = [];
  // "prva srida u misecu" is more specific than the bare weekday inside it, so it goes first.
  if (nth) candidates.push(nth);
  if (abs) candidates.push({ type: 'absolute', month: abs.month, day: abs.day, year: abs.year, hour, minute, text: abs.text });
  // A named weekday beats a bare period: "sljedeći tjedan u sridu" is Wednesday, not that week's Monday. The
  // period word only survives as the modifier that pushes the day into the following week (see weekdays()).
  const weekdayWins = wds.length > 0 && relative?.type === 'relative' && relative.weeks === 1;
  if (relative && !weekdayWins) candidates.push(relative);
  // The first weekday carries the note's own hour ("u petak navečer"); the later ones are content, at the default.
  for (const w of wds) {
    const { at: _at, ...clean } = w;
    candidates.push(w === wdSig ? clean : { ...clean, hour: null });
  }
  if (relative && weekdayWins) candidates.push(relative);
  if (partSig) candidates.push(partSig);
  // "u 9. misecu" / "u 7. mjesecu" — a month said by number, which numeric date parsing does not catch because
  // there is no day beside it. Treated as the 1st of that month, like a named one.
  // A named month can be pushed into next year by a qualifier elsewhere in the sentence ("sljedeće godine u
  // rujnu"). thisYear + shift, not null: leaving the year open let nextDated() roll to the NEAREST September,
  // which is this year's — the note said next year and got next month.
  const shift = yearShift(f);
  const shiftedYear = shift ? new Date(now).getFullYear() + shift : null;
  if (!nth && !abs && !relative && !wdSig && !partSig) {
    const byNumber = namedMonth(f);
    if (byNumber != null) candidates.push({ type: 'absolute', month: byNumber, day: 1, year: shiftedYear, hour, minute, text: `${byNumber}. mjesec` });
  }
  if (!abs && !relative && !wdSig && !partSig && candidates.length === 0) {
    const bare = parseBareMonth(f);
    if (bare) candidates.push({ type: 'absolute', month: bare.month, day: 1, year: shiftedYear, hour, minute, text: bare.text });
  }
  if (recurring) candidates.push(recurring);
  if (offset) candidates.push(offset);

  // A clock with no day at all.
  if (candidates.length === 0 && clock) candidates.push({ type: 'time_only', hour: clock.hour, minute: clock.minute, text: `${clock.hour}h` });
  // A day part with no day and no clock ("navečer nazvati mamu").
  if (candidates.length === 0 && dayPart) candidates.push(dayPart);

  // Seasons and conditionals: additive, never overriding a real date.
  const conditional = CONTEXTUAL_MARKERS.test(f) ? CONTEXTUAL.exec(f)?.[0] ?? null : null;
  let season: TemporalSignal | null = null;
  for (const [re, name] of SEASONS) {
    const m = re.exec(f);
    if (m && !/\bljeti\s+\d/.test(m[0])) {
      season = { type: 'season', season: name, text: m[0] };
      break;
    }
  }

  // "nakon petka" → the day AFTER that day. Shift before anything else looks at the candidate.
  if (afterWord && candidates[0] && !offset) {
    const c = candidates[0];
    if (c.type === 'weekday') candidates[0] = { ...c, occurrence: c.occurrence, weekday: (c.weekday + 1) % 7 };
    else if (c.type === 'relative') candidates[0] = { ...c, days: (c.days ?? 0) + 1 };
  }

  // ── order: a deadline wraps whatever it qualifies and goes first.
  const isDeadline = !!deadlineWord && !afterWord && candidates.length > 0 && deadlineIndexBefore(f, deadlineWord.index, candidates[0]!);
  if (isDeadline && candidates[0]) {
    out.push({ type: 'deadline', signal: candidates[0], text: deadlineWord![0] });
    out.push(...candidates.slice(1));
  } else {
    out.push(...candidates);
  }

  // Contextual and seasonal signals only matter when nothing concrete was found — or as extra keywords.
  if (conditional && out.length === 0) out.push({ type: 'contextual', phrase: conditional.trim(), text: conditional.trim() });
  else if (conditional) out.push({ type: 'contextual', phrase: conditional.trim(), text: conditional.trim() });
  if (season && out.length === 0) out.push(season);
  else if (season && season.season === 'around') out.push(season);

  return out;
}

/** Is the deadline word actually attached to this signal (i.e. before it in the sentence)? */
function deadlineIndexBefore(f: string, at: number, sig: TemporalSignal): boolean {
  const i = f.indexOf(sig.text.slice(0, Math.min(8, sig.text.length)));
  return i === -1 ? true : at <= i + 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// resolving

function defaultHour(intent: string): number {
  return DEFAULT_HOUR[intent] ?? 9;
}

/** Next occurrence of month/day at or after `now`, honouring an explicit year. */
function nextDated(now: number, month: number, day: number, year: number | null, hour: number, minute: number): number | null {
  if (year != null) {
    const t = new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
    return t > now ? t : null; // an explicitly past year is not a reminder
  }
  const thisYear = new Date(now).getFullYear();
  let t = new Date(thisYear, month - 1, day, hour, minute, 0, 0).getTime();
  if (t <= now) t = new Date(thisYear + 1, month - 1, day, hour, minute, 0, 0).getTime();
  return t;
}

/**
 * Signal → instant. `null` fireAt is a deliberate answer, not a failure: an offset with no anchor, a bare
 * season, or a conditional phrase must NOT become an invented date.
 */
export function resolveSignal(signal: TemporalSignal, now: number, intent: Intent | string = 'task'): ResolvedTime | null {
  const H = defaultHour(intent);

  switch (signal.type) {
    case 'absolute': {
      const fireAt = nextDated(now, signal.month, signal.day, signal.year, signal.hour ?? H, signal.minute);
      return { fireAt, certainty: signal.hour != null || signal.year != null ? 'high' : 'high' };
    }

    case 'time_only': {
      let t = dayAt(now, 0, signal.hour, signal.minute);
      if (t <= now) t = dayAt(now, 1, signal.hour, signal.minute);
      return { fireAt: t, certainty: 'high' };
    }

    case 'relative': {
      const d = new Date(now);
      if (signal.days) d.setDate(d.getDate() + signal.days);
      if (signal.weeks) d.setDate(d.getDate() + signal.weeks * 7);
      if (signal.months) d.setTime(addMonths(d, signal.months).getTime());
      if (signal.years) d.setFullYear(d.getFullYear() + signal.years);
      // "sljedeći tjedan" means the Monday of next week, not "today + 7"
      if (signal.weeks === 1 && /sljedec|iduc|next/.test(signal.text)) {
        const dow = d.getDay();
        d.setDate(d.getDate() - ((dow + 6) % 7)); // back to that week's Monday
      }
      // "sljedeći mjesec"/"sljedeće godine" start at the beginning of the period
      if (signal.months && /sljedec|iduc|next/.test(signal.text)) d.setDate(1);
      if (signal.years && /sljedec|iduc|next/.test(signal.text)) {
        d.setMonth(0);
        d.setDate(1);
      }
      d.setHours(signal.hour ?? H, signal.minute, 0, 0);
      if (signal.days === 0 && d.getTime() <= now) d.setDate(d.getDate() + 1); // "danas" but the hour passed
      return { fireAt: d.getTime(), certainty: signal.approximate ? 'low' : signal.hour != null ? 'high' : 'high' };
    }

    case 'weekday': {
      const d = new Date(now);
      if (signal.occurrence === 'following') {
        // "sljedeći tjedan u srijedu" means that day INSIDE next week — so anchor on next Monday and walk
        // forward, rather than adding 7 to the coming Wednesday. Said on a Friday those differ by a week:
        // the next Wednesday is already in next week, and +7 would overshoot into the week after.
        const daysToNextMonday = ((8 - d.getDay()) % 7) || 7;
        d.setDate(d.getDate() + daysToNextMonday);
        d.setDate(d.getDate() + ((signal.weekday - 1 + 7) % 7)); // Monday-based offset within that week
      } else {
        let diff = (signal.weekday - d.getDay() + 7) % 7;
        if (diff === 0) diff = 7; // "u petak" on a Friday means the next one
        d.setDate(d.getDate() + diff);
      }
      d.setHours(signal.hour ?? H, signal.minute, 0, 0);
      return { fireAt: d.getTime(), certainty: 'high' };
    }

    case 'part': {
      const d = new Date(now);
      if (signal.of === 'week') {
        const target = signal.at === 'end' ? 5 : signal.at === 'mid' ? 3 : 1; // Fri / Wed / Mon
        let diff = (target - d.getDay() + 7) % 7;
        if (signal.next || diff === 0) diff += 7;
        d.setDate(d.getDate() + diff);
      } else if (signal.of === 'month') {
        if (signal.next) d.setMonth(d.getMonth() + 1);
        if (signal.at === 'end') d.setMonth(d.getMonth() + 1, 0);
        else if (signal.at === 'mid') d.setDate(15);
        else {
          // start of month: if this month's 1st has passed, the next one
          d.setDate(1);
          if (d.getTime() <= now) d.setMonth(d.getMonth() + 1, 1);
        }
      } else {
        if (signal.next) d.setFullYear(d.getFullYear() + 1);
        if (signal.at === 'end') d.setMonth(11, 31);
        else if (signal.at === 'mid') d.setMonth(5, 30);
        else d.setMonth(0, 1);
      }
      d.setHours(signal.hour, signal.minute, 0, 0);
      let t = d.getTime();
      if (t <= now) {
        // roll forward one period rather than return the past
        const d2 = new Date(t);
        if (signal.of === 'week') d2.setDate(d2.getDate() + 7);
        else if (signal.of === 'month') d2.setMonth(d2.getMonth() + 1);
        else d2.setFullYear(d2.getFullYear() + 1);
        t = d2.getTime();
      }
      // A named part of a period is inherently vague: picking a concrete day does not make it certain.
      return { fireAt: t, certainty: 'medium' };
    }

    case 'nth_weekday': {
      const h = signal.hour ?? H;
      const now0 = new Date(now);
      // Which month: the one named ("u 12. mjesecu"), else the one the sentence shifts to ("za 2 miseca"),
      // else this one — rolling forward only when nothing was specified and the day has already gone by.
      const explicitMonth = signal.month != null || signal.monthOffset != null;
      const startMonth = signal.month != null ? signal.month - 1 : now0.getMonth() + (signal.monthOffset ?? 0);
      let year = now0.getFullYear();
      if (signal.month != null && startMonth < now0.getMonth()) year++;

      const pick = (y: number, monthIdx: number): number => {
        if (signal.nth === 'last') {
          const d = new Date(y, monthIdx + 1, 0); // last day of the month
          d.setDate(d.getDate() - ((d.getDay() - signal.weekday + 7) % 7));
          d.setHours(h, signal.minute, 0, 0);
          return d.getTime();
        }
        const first = new Date(y, monthIdx, 1);
        const offset = (signal.weekday - first.getDay() + 7) % 7;
        const d = new Date(y, monthIdx, 1 + offset + (signal.nth - 1) * 7);
        d.setHours(h, signal.minute, 0, 0);
        return d.getTime();
      };

      let t = pick(year, startMonth);
      // Only search forward when the month was NOT stated. If the note says "za 2 miseca" it means that month,
      // even if its first Sunday happens to be behind us by the time it fires.
      if (t <= now && !explicitMonth) t = pick(year, startMonth + 1);
      else if (t <= now && signal.month != null) t = pick(year + 1, startMonth);
      return { fireAt: t, certainty: 'high' };
    }

    case 'day_part': {
      const h = HOUR_OF_PART[signal.part]!;
      let t = dayAt(now, 0, h);
      if (t <= now) t = dayAt(now, 1, h);
      return { fireAt: t, certainty: 'medium' };
    }

    case 'deadline': {
      const inner = resolveSignal(signal.signal, now, intent);
      // The deadline IS the moment; certainty comes from the inner signal but never drops below medium.
      return inner ? { ...inner, certainty: inner.certainty === 'low' ? 'medium' : inner.certainty } : null;
    }

    case 'recurring': {
      const d = new Date(now);
      const h = defaultHour(intent);
      if (signal.rule === 'yearly') d.setFullYear(d.getFullYear() + 1);
      else if (signal.rule === 'monthly') d.setTime(addMonths(d, signal.months ?? 1).getTime());
      else if (signal.rule === 'weekly') {
        const target = signal.weekday ?? d.getDay();
        let diff = (target - d.getDay() + 7) % 7;
        if (diff === 0) diff = 7;
        d.setDate(d.getDate() + diff);
      } else d.setDate(d.getDate() + 1);
      d.setHours(h, 0, 0, 0);
      return { fireAt: d.getTime(), certainty: 'medium', recurring: signal.rule };
    }

    // Deliberately dateless — the caller turns these into an anchor offset or into keywords.
    case 'offset_from_anchor':
      return { fireAt: null, certainty: 'medium', offsetDays: signal.offsetDays };
    case 'season':
      return { fireAt: null, certainty: 'low' };
    case 'contextual':
      return { fireAt: null, certainty: 'low' };
  }
}

/** Local ISO without a zone — the only datetime format the pipeline accepts. */
export function toLocalIso(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/** Human label for a signal, in the UI language. Used as the reminder's label. */
export function signalLabel(signal: TemporalSignal, lang: Language): string {
  const hr = lang === 'hr';
  switch (signal.type) {
    case 'deadline':
      return hr ? `rok · ${signalLabel(signal.signal, lang)}` : `due · ${signalLabel(signal.signal, lang)}`;
    case 'recurring':
      if (signal.rule === 'yearly') return hr ? 'svake godine' : 'yearly';
      if (signal.rule === 'monthly') return hr ? `svakih ${signal.months ?? 1} mj.` : `every ${signal.months ?? 1} mo.`;
      if (signal.rule === 'weekly') return hr ? 'svaki tjedan' : 'weekly';
      return hr ? 'svaki dan' : 'daily';
    case 'contextual':
      return signal.phrase;
    case 'season':
      return signal.text;
    default:
      return signal.text;
  }
}

void p2;
