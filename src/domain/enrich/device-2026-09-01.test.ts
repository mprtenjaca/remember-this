// Third device session (2026-09-01), on the first iOS dev build. Same shape as the previous two: Marko wrote
// ordinary sentences, and what came back was a correct-looking title with a wrong or missing reminder.
//
// Three groups here:
//  1. Dictation shorthand — "vcrs" for večeras, and numbers glued to the preposition ("u8" for "u 8"). Both are
//     how a phone keyboard and a fast typist actually write, and both fell through every rule because the
//     rules read digits separated by a space.
//  2. A note that names NO occasion must not be asked about one. "Piće s Ivanom" was asked "Kad je rođendan?" —
//     there is no birthday anywhere in the text, and hard rule 5 says ask only what cannot be derived.
//
// NOW is Tuesday 1.9.2026, noon, matching the other device tests in this folder.

import { describe, it, expect } from 'vitest';
import { parseTemporal, spokenShorthand, numberWords } from './temporal';
import { fold, heuristicEnrich, extractExplicitDate } from './heuristic';
import { reconcile } from './reconcile';
import { ingest } from './ingest';
import { FakeClock } from '../clock';
import type { EnrichResult } from '../types';

const NOW = new Date(2026, 8, 1, 12, 0, 0, 0).getTime();
const rctx = () => ({ now: NOW, anchors: [] });
const ictx = () => ({ existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(NOW) });

describe('spokenShorthand — how dictation and fast typing actually write', () => {
  const norm = (s: string) => spokenShorthand(numberWords(fold(s)));

  it('"vcrs" is večeras', () => {
    expect(norm('vcrs pice s ivanom')).toContain('veceras');
  });

  it('expands the shorthand only as a whole word', () => {
    // "vcrs" inside a longer token is not the abbreviation — never rewrite mid-word.
    expect(norm('avcrsx')).toBe('avcrsx');
  });

  it('splits a number glued to its preposition: "u8" → "u 8"', () => {
    expect(norm('sastanak u8')).toContain('u 8');
  });

  it('does not split a word that merely ends in u before digits', () => {
    // "verzija 2.10" and friends must survive untouched — only the standalone preposition is split.
    expect(norm('verzija 2.10')).toBe('verzija 2.10');
  });
});

describe('shorthand produces a real reminder, not just a normalized string', () => {
  it('"vcrs u8 pice s Ivanom" is tonight at 20:00', () => {
    const sig = parseTemporal('vcrs u8 pice s Ivanom', NOW);
    const rel = sig.find((s) => s.type === 'relative');
    expect(rel, `signals: ${JSON.stringify(sig)}`).toBeDefined();
    expect(rel && 'days' in rel ? rel.days : null).toBe(0);
    // A bare 8 in the evening sense — "vcrs" says which 8 it is.
    expect(rel && 'hour' in rel ? rel.hour : null).toBe(20);
  });

  it('"vcrs" alone still lands today', () => {
    const sig = parseTemporal('vcrs nazvat mater', NOW);
    const rel = sig.find((s) => s.type === 'relative');
    expect(rel && 'days' in rel ? rel.days : null).toBe(0);
  });
});

// ── "Piće s Ivanom" was asked "Kad je rođendan?" — there is no birthday anywhere in that text.
//
// Our heuristic never asks it (verified: the offline path produces only a semantic trigger). The question came
// from the MODEL, which saw a person's name and reached for the birthday it usually implies. reconcile() took
// `raw.needs_anchor` unconditionally, so the invented question survived.
//
// Hard rule 11 says the model proposes and reconcile decides; hard rule 5 says ask only what cannot be derived.
// A date question with no occasion in the text is not derivable from anything — it is a guess, and answering it
// would attach a birthday to a note about going for a drink.
describe('an occasion nobody mentioned is never asked about', () => {
  const ANCHOR_KINDS = ['birthday', 'anniversary', 'memorial'] as const;

  const modelSaid = (text: string, kind: (typeof ANCHOR_KINDS)[number] = 'birthday'): EnrichResult => ({
    summary: text,
    intent: 'fact',
    category: 'other',
    confidence: 0.8,
    entities: { people: ['Ivan'] },
    language: 'hr',
    triggers: [],
    needs_anchor: { person: 'Ivan', kind },
    questions: [],
  });

  for (const kind of ANCHOR_KINDS) {
    it(`drops an invented ${kind} question when the text names no occasion`, () => {
      const out = ingest(reconcile(modelSaid('Piće s Ivanom', kind), 'Piće s Ivanom', rctx()), ictx());
      expect(out.questions.map((q) => q.text), 'should ask nothing').toEqual([]);
      expect(out.needsAnchor).toBeNull();
    });
  }

  it('keeps the question when the text DOES name the occasion', () => {
    // The rule must not throw away a legitimate anchor: here "rođendan" is in the text and the date is not.
    const out = ingest(reconcile(modelSaid('Ivanu je rođendan'), 'Ivanu je rođendan', rctx()), ictx());
    expect(out.needsAnchor).not.toBeNull();
    expect(out.questions.length).toBeGreaterThan(0);
  });

  it('keeps it for a gift note, where the birthday is implied rather than written', () => {
    // "Ivan wants X" is the gift path (E1) — the occasion is genuinely implied, so asking is right.
    const out = ingest(reconcile({ ...modelSaid('Ivan želi bušilicu'), intent: 'gift' }, 'Ivan želi bušilicu', rctx()), ictx());
    expect(out.needsAnchor).not.toBeNull();
  });
});

// ── "iza 7" / "poslije 5" — an hour stated as a lower bound (Marko, 2026-09-01).
//
// Device, at 18:00: "nazovi tatu iza 7" produced NO reminder at all, and "nazovi tatu u 7" produced tomorrow
// 07:00. Both wrong, and both the silent kind: a correct title with a useless reminder.
//
// "iza N" and "poslije N" are how people say "sometime after N" — a real hour, not a day shift. The existing
// `afterWord` rule reads "poslije" as +1 DAY ("nakon petka" = the day after Friday), which is right for a
// weekday and wrong for a number.
//
// The bare-hour rule then applies as usual: 1–7 without a day-part means the afternoon one, so "iza 7" at
// 18:00 is 19:00, not tomorrow morning.
describe('an hour given as a lower bound: "iza 7", "poslije 5"', () => {
  const at = (h: number) => new Date(2026, 8, 1, h, 0, 0, 0).getTime();
  const hourOf = (text: string, now: number) => {
    const sig = parseTemporal(text, now);
    const withHour = sig.find((s) => 'hour' in s && s.hour != null);
    return withHour && 'hour' in withHour ? withHour.hour : null;
  };

  it('"iza 7" at 18:00 is 19:00, not tomorrow morning', () => {
    expect(hourOf('nazovi tatu iza 7', at(18))).toBe(19);
  });

  it('"poslije 5" is 17:00', () => {
    expect(hourOf('nazovi tatu poslije 5', at(12))).toBe(17);
  });

  it('"iza 8" reads as the evening eight when nothing says otherwise', () => {
    // 8 is in the 8-11 band that normally stays a morning hour, but "iza" is said about the coming evening far
    // more often than about tomorrow's breakfast. The day-part rules still win when one is present.
    expect(hourOf('pivo iza 8', at(18))).toBe(20);
  });

  it('an explicit day-part still decides: "iza 7 ujutro" is 07:00', () => {
    expect(hourOf('trening iza 7 ujutro', at(18))).toBe(7);
  });

  it('"poslije" before a WEEKDAY is still a day shift, not an hour', () => {
    // The pre-existing meaning must survive: "poslije petka" is the day after Friday.
    expect(hourOf('platit poslije petka', at(12))).not.toBe(5);
  });

  it('"iza" not followed by a number is not an hour ("iza kuće")', () => {
    expect(hourOf('parking iza kuce', at(12))).toBeNull();
  });
});

// ── An identifier is not a date, on BOTH parsers (Marko, 2026-09-01).
//
// "Verzija 2.10 ima bug" scheduled a reminder for 2 October. "Polica osiguranja 12.5 mil" scheduled 12 May.
// `temporal.ts` has refused these since August — a word like "verzija"/"polica" before the number means the
// number is an identifier — but `extractExplicitDate()` in heuristic.ts has its own copy of the date regex
// WITHOUT that guard, and it is the one that wins here. Two copies of a rule, one of them fixed.
//
// The silent-failure signature again: a correct title, and a reminder nobody asked for on a random future day.
describe('an identifier is never a date', () => {
  const NOON = new Date(2026, 8, 1, 12, 0).getTime();
  const dated = (text: string) => {
    const out = ingest(reconcile(heuristicEnrich(text, { now: NOON, anchors: [] }), text, { now: NOON, anchors: [] }), {
      existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(NOON),
    });
    return out.drafts.filter((d) => d.type === 'time' && 'fireAt' in d && d.fireAt).length;
  };

  for (const text of [
    'Verzija 2.10 ima bug',
    'Polica osiguranja 12.5 mil',
    'Model 3.5 je bolji',
    'Broj police 12.09 istice',
    'Soba 2.4 je slobodna',
    'Sifra 10.12 za sef',
  ]) {
    it(`"${text}" schedules nothing`, () => {
      expect(dated(text), 'should invent no reminder').toBe(0);
    });
  }

  it('a REAL date in the same shape still works', () => {
    // The guard must not swallow ordinary dates — this is the regression that matters.
    expect(dated('Sastanak 12.9.')).toBeGreaterThan(0);
  });

  it('extractExplicitDate itself refuses an identifier', () => {
    expect(extractExplicitDate('Verzija 2.10 ima bug')).toBeNull();
    expect(extractExplicitDate('Polica osiguranja 12.5 mil')).toBeNull();
    // …and still reads a plain one.
    expect(extractExplicitDate('Sastanak 12.9.')).toEqual({ month: 9, day: 12, year: null });
  });
});

// ── The sweep's remaining silent failures (Marko, 2026-09-01). Each produces a correct title and either no
// reminder at all or an invented one. All deterministic, all ours.
describe('deadlines, recurrence and the hours that were missing', () => {
  const NOON = new Date(2026, 8, 1, 12, 0).getTime(); // Tuesday 1.9.2026
  const first = (text: string, now = NOON) => {
    const o = ingest(reconcile(heuristicEnrich(text, { now, anchors: [] }), text, { now, anchors: [] }), {
      existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(now),
    });
    const t = o.drafts.find((d) => d.type === 'time' && 'fireAt' in d && d.fireAt);
    const w = t && 'fireAt' in t && t.fireAt ? new Date(t.fireAt) : null;
    return { day: w ? `${w.getDate()}.${w.getMonth() + 1}.` : null, hour: w ? w.getHours() : null, min: w ? w.getMinutes() : null, count: o.drafts.length };
  };

  // "u roku N dana" — a deadline stated as a span. Produced nothing at all.
  it('"u roku 8 dana" is 8 days out', () => {
    expect(first('Platit kaznu u roku 8 dana').day).toBe('9.9.');
  });
  it('"u roku od 15 dana" reads the same with the preposition', () => {
    expect(first('Platit u roku od 15 dana').day).toBe('16.9.');
  });
  it('"u roku 2 tjedna" counts weeks', () => {
    expect(first('Odgovorit u roku 2 tjedna').day).toBe('15.9.');
  });

  // Midnight is an hour. "u ponoć" produced nothing, so a New Year note had no reminder.
  it('"u ponoc" is 00:00', () => {
    const r = first('U ponoc cestitat Ani');
    expect(r.hour, `got ${r.day} ${r.hour}:${r.min}`).toBe(0);
  });

  // "za N minuta" — the shortest reminder there is, and it was dropped.
  it('"za 2 minute" is 2 minutes from now', () => {
    const r = first('sastanak za 2 minute');
    expect(r.hour).toBe(12);
    expect(r.min).toBe(2);
  });

  // A stated rhythm must not be replaced by the invented ~6 month fallback.
  it('"svaka 3 miseca" uses THREE months, not the ~6 month guess', () => {
    expect(first('Filter mijenjat svaka 3 miseca').day).toBe('1.12.');
  });
  it('"svakih godinu dana" is a year out', () => {
    expect(first('Cijepiti psa svakih godinu dana').day).toBe('1.9.');
  });

  // A recurring weekday keeps its stated hour — it was landing on the 09:00 default.
  it('"svaki ponedjeljak trening u 7" keeps 19:00', () => {
    const r = first('Svaki ponedjeljak trening u 7');
    expect(r.hour, `got ${r.day} ${r.hour}:00`).toBe(19);
  });

  // Regression from the "iza" rule: a stated DAY must not be flipped to the evening.
  it('"sutra iza 9" is 09:00 tomorrow, not 21:00', () => {
    const r = first('sutra iza 9 kava s Markom');
    expect(r.day).toBe('2.9.');
    expect(r.hour, `got ${r.hour}:00`).toBe(9);
  });
});

// ── "Rok od 10 dana za platit kaznu" — the deadline said as a NOUN (Marko, 2026-09-01).
//
// "u roku 8 dana" worked (the `within` rule reads the preposition form), but the same fact with "rok" as the
// subject produced nothing: "Rok od 10 dana...", "Rok za prijavu je 15 dana", "Imam rok 8 dana". Same
// semantics, different word order — and dictation produces both freely.
describe('a deadline said as a noun: "rok od N dana"', () => {
  const NOON = new Date(2026, 8, 1, 12, 0).getTime();
  const day = (text: string) => {
    const o = ingest(reconcile(heuristicEnrich(text, { now: NOON, anchors: [] }), text, { now: NOON, anchors: [] }), {
      existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(NOON),
    });
    const t = o.drafts.find((d) => d.type === 'time' && 'fireAt' in d && d.fireAt);
    const w = t && 'fireAt' in t && t.fireAt ? new Date(t.fireAt) : null;
    return w ? `${w.getDate()}.${w.getMonth() + 1}.` : null;
  };

  it('"Rok od 10 dana za platit kaznu" is 10 days out', () => {
    expect(day('Rok od 10 dana za platit kaznu')).toBe('11.9.');
  });
  it('"Rok za prijavu je 15 dana" reads through the words in between', () => {
    expect(day('Rok za prijavu je 15 dana')).toBe('16.9.');
  });
  it('"Imam rok 8 dana za zalbu" works bare', () => {
    expect(day('Imam rok 8 dana za zalbu')).toBe('9.9.');
  });
  it('"rok" with a WEEK unit counts weeks', () => {
    expect(day('Rok od 2 tjedna za odgovor')).toBe('15.9.');
  });
  it('a number after a clause break does not belong to the rok', () => {
    // The gap must stop at punctuation: here "3 dana" is when he pays, not the length of the rok.
    expect(day('Produzili su rok, platit cu za 3 dana')).toBe('4.9.');
  });
});

// ── E25: a deadline 3+ days out gets a "dan prije" companion (Marko's call, 2026-09-01).
//
// One reminder on the last day at 09:00 is often too late to act on — the bank and the post office keep their
// own hours. So a deadline ("u roku 8 dana", "Rok od 10 dana", "do petka") whose last day is 3+ calendar days
// away gets a pair: the day before, and the day itself. A mirror of E23's same-day pair. Shorter deadlines and
// plain non-deadline dates ("za 8 dana kontrola", "sastanak 12.9.") keep the single default — the pair is for
// dates with a PENALTY behind them.
describe('E25 — a deadline gets a day-before companion', () => {
  const NOON = new Date(2026, 8, 1, 12, 0).getTime(); // Tuesday 1.9.
  const times = (text: string) => {
    const o = ingest(reconcile(heuristicEnrich(text, { now: NOON, anchors: [] }), text, { now: NOON, anchors: [] }), {
      existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(NOON),
    });
    return o.drafts
      .filter((d) => d.type === 'time' && 'fireAt' in d && d.fireAt)
      .map((d) => {
        const w = new Date(('fireAt' in d && d.fireAt) as number);
        return `${w.getDate()}.${w.getMonth() + 1}.${d.label ? ` (${d.label})` : ''}`;
      })
      .sort();
  };

  it('"u roku 8 dana" → dan prije + na dan', () => {
    expect(times('Platit kaznu u roku 8 dana')).toEqual(['8.9. (dan prije)', '9.9. (u roku 8 dana)']);
  });
  it('"Rok od 10 dana" → the same pair', () => {
    const r = times('Rok od 10 dana za platit kaznu');
    expect(r).toHaveLength(2);
    expect(r[0]).toContain('10.9. (dan prije)');
  });
  it('"do petka" (3 days out) → pair', () => {
    const r = times('Platit rezije do petka');
    expect(r).toHaveLength(2);
    expect(r[0]).toContain('3.9. (dan prije)');
  });
  it('a SHORT deadline stays single: "u roku 2 dana"', () => {
    expect(times('Platit u roku 2 dana')).toEqual(['3.9. (u roku 2 dana)']);
  });
  it('a plain relative date is NOT a deadline: "za 8 dana kontrola" stays single', () => {
    expect(times('za 8 dana kontrola')).toHaveLength(1);
  });
  it('a plain absolute date stays single too', () => {
    expect(times('Sastanak 12.9.')).toHaveLength(1);
  });
});

// ── "Marko rockas" — dialect slang for a birthday (Marko, 2026-09-01).
//
// "Roćkas" (and "rođus") is how a birthday is actually said in casual Dalmatian speech, and dialect is a
// first-class input (2026-08-25). The model on the device UNDERSTOOD it — its summary said "rođendan" and it
// proposed the anchor — but E24 then stripped the question because the RAW TEXT carried no occasion word our
// rules knew. The heuristic never knew the word at all, so the offline path was just as silent.
//
// Fixed in fold(): "rockas"/"roćkas"/"rođus" normalize to "rodendan" the same way "rodjendan" already does,
// so every folded pattern — BIRTHDAY, GIFT_MARKERS, occasionWord, E24's occasionImplied — learns the word in
// one place instead of eight regex copies drifting apart.
describe('dialect slang for a birthday: roćkas / rođus', () => {
  it('"Marko rockas" asks for the birthday (offline path)', () => {
    const out = ingest(reconcile(heuristicEnrich('Marko rockas', { now: NOW, anchors: [] }), 'Marko rockas', rctx()), ictx());
    expect(out.needsAnchor, 'should want the date').toEqual({ person: 'Marko', kind: 'birthday' });
    expect(out.questions.length).toBeGreaterThan(0);
  });

  it('E24 keeps the MODEL question too — the text now implies the occasion', () => {
    const model: EnrichResult = {
      summary: 'Marku je rođendan', intent: 'fact', category: 'other', confidence: 0.8,
      entities: { people: ['Marko'] }, language: 'hr', triggers: [],
      needs_anchor: { person: 'Marko', kind: 'birthday' }, questions: [],
    };
    const out = ingest(reconcile(model, 'Marko rockas', rctx()), ictx());
    expect(out.needsAnchor).not.toBeNull();
  });

  it('"Ani je roćkas u subotu" dates the anchor, asks nothing', () => {
    const out = ingest(reconcile(heuristicEnrich('Ani je roćkas u subotu', { now: NOW, anchors: [] }), 'Ani je roćkas u subotu', rctx()), ictx());
    expect(out.questions).toHaveLength(0);
    expect(out.inferredAnchor?.monthDay).toBe('09-05');
  });

  it('"rođus" works the same', () => {
    const out = ingest(reconcile(heuristicEnrich('Luki je rođus', { now: NOW, anchors: [] }), 'Luki je rođus', rctx()), ictx());
    expect(out.needsAnchor?.kind).toBe('birthday');
  });

  it('an unrelated word containing the letters is left alone', () => {
    // "rock" the music must not become a birthday.
    const out = ingest(reconcile(heuristicEnrich('Kupit ulaznice za rock koncert', { now: NOW, anchors: [] }), 'Kupit ulaznice za rock koncert', rctx()), ictx());
    expect(out.needsAnchor).toBeNull();
  });
});

// Diacritic-free typing covers đ→"dj" too: "rodjus" is how "rođus" lands from a bare keyboard, the same way
// "rodjendan" already folds. "rockas"/"rodus" without diacritics worked from day one (fold strips ć/č/đ before
// the slang mapping); this pins all the spellings so none regresses.
describe('birthday slang, every diacritic-free spelling', () => {
  const asks = (text: string) => {
    const out = ingest(reconcile(heuristicEnrich(text, { now: NOW, anchors: [] }), text, rctx()), ictx());
    return out.needsAnchor?.kind === 'birthday';
  };
  for (const text of ['Marko rockas', 'Marko roćkas', 'Marko ročkas', 'Luki je rođus', 'Luki je rodus', 'Luki je rodjus']) {
    it(`"${text}" is a birthday`, () => {
      expect(asks(text)).toBe(true);
    });
  }
});
