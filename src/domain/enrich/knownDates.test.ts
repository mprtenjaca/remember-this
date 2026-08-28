// The app knows public/church/world dates and must never ask for them; a birthday it must ALWAYS ask for.

import { describe, it, expect } from 'vitest';
import { easterSunday, easterBasedMonthDay, findKnownDate } from './knownDates';
import { reconcile } from './reconcile';
import { ingest } from './ingest';
import { heuristicEnrich } from './heuristic';
import { FakeClock } from '../clock';
import type { EnrichResult } from '../types';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = local(2026, 8, 25, 14, 32);
const rctx = () => ({ now: NOW, anchors: [] });
const ictx = () => ({ existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(NOW) });

const bare = (over: Partial<EnrichResult> = {}): EnrichResult => ({
  summary: 'x',
  language: 'hr',
  intent: 'fact',
  confidence: 0.5,
  triggers: [],
  questions: [],
  ...over,
});

describe('Easter is computed, not guessed', () => {
  // Known Western Easter dates.
  const cases: Array<[number, number, number]> = [
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2028, 4, 16],
    [2030, 4, 21],
  ];
  for (const [year, month, day] of cases) {
    it(`Easter ${year} is ${day}.${month}.`, () => {
      const e = easterSunday(year);
      expect(e.getMonth() + 1).toBe(month);
      expect(e.getDate()).toBe(day);
    });
  }

  it('feasts hanging off Easter land on the right day', () => {
    expect(easterBasedMonthDay(2026, -2)).toBe('04-03'); // Good Friday 2026
    expect(easterBasedMonthDay(2026, 1)).toBe('04-06'); // Easter Monday 2026
    expect(easterBasedMonthDay(2026, 49)).toBe('05-24'); // Pentecost 2026
  });
});

describe('fixed dates are recognised in any case form', () => {
  const hit = (text: string) => findKnownDate(text, 2026, 'hr');

  it('Valentinovo', () => {
    expect(hit('Za Valentinovo rezervirati restoran')?.monthDay).toBe('02-14');
    expect(hit('valentinovu kupiti cvijece')?.monthDay).toBe('02-14');
  });

  it('Dan žena', () => {
    expect(hit('Za Dan žena kupiti cvijeće mami')?.monthDay).toBe('03-08');
    expect(hit('dan zena')?.label).toBe('Dan žena');
  });

  it('Božić and Badnjak are different days', () => {
    expect(hit('Za Božić kupiti poklone')?.monthDay).toBe('12-25');
    expect(hit('Badnjak — rezervirati stol')?.monthDay).toBe('12-24');
  });

  it('Uskrs resolves for the asked year', () => {
    expect(findKnownDate('Za Uskrs ideme baki', 2026, 'hr')?.monthDay).toBe('04-05');
    expect(findKnownDate('Za Uskrs ideme baki', 2027, 'hr')?.monthDay).toBe('03-28');
  });

  it('an unrelated note matches nothing', () => {
    expect(hit('Nazvati Marka u 15h')).toBeNull();
    expect(hit('Mehaničar Dario popravio klimu')).toBeNull();
  });

  it('a birthday is NOT a known date — it must be asked', () => {
    expect(hit('Ana želi Dyson fen za rođendan')).toBeNull();
    expect(hit('Rođendan mi je u petak')).toBeNull();
  });
});

describe('a known date becomes an anchor with no question', () => {
  it('"Za Valentinovo rezervirati restoran" anchors to 14.02. and asks nothing', () => {
    const raw = bare({ summary: 'Rezervirati restoran za Valentinovo', intent: 'task' });
    const out = ingest(reconcile(raw, 'Za Valentinovo rezervirati restoran', rctx()), ictx());
    expect(out.questions).toEqual([]);
    expect(out.inferredAnchor?.monthDay).toBe('02-14');
    expect(out.status).toBe('enriched');
  });

  it('"Za Dan žena kupiti cvijeće mami" anchors to 08.03. without asking for a birthday', () => {
    const raw = bare({ summary: 'Cvijeće za Dan žena', intent: 'gift', entities: { people: ['Mama'] } });
    const out = ingest(reconcile(raw, 'Za Dan žena kupiti cvijeće mami', rctx()), ictx());
    expect(out.inferredAnchor?.monthDay).toBe('03-08');
    expect(out.questions.filter((q) => q.kind === 'date')).toEqual([]);
  });

  it('a birthday still asks, even next to a known date word', () => {
    const raw = bare({ summary: 'Poklon za Anu', intent: 'gift', entities: { people: ['Ana'] } });
    const out = ingest(reconcile(raw, 'Ana želi fen za rođendan', rctx()), ictx());
    expect(out.questions.map((q) => q.kind)).toContain('date');
  });

  it('a date stated in the text still wins over the calendar', () => {
    const raw = bare({ summary: 'Godišnjica 14.9.', intent: 'task' });
    const out = ingest(reconcile(raw, 'Godišnjica 14.9., rezervirati restoran', rctx()), ictx());
    expect(out.inferredAnchor?.monthDay).toBe('09-14');
  });
});

// The heuristic runs alone whenever the proxy is unreachable or out of quota — and on the device that is the
// common case. It must know the calendar too, otherwise "Poklon za Valentinovo" needs repeated
// "Pročitaj ponovno" taps before a date appears (which is exactly what happened).
describe('the offline heuristic knows the calendar as well', () => {
  const offline = (text: string) => ingest(heuristicEnrich(text, { now: NOW, anchors: [] }), ictx());

  it('"Poklon za Valentinovo" anchors to 14.02. on the FIRST pass, no question', () => {
    const out = offline('Poklon za Valentinovo');
    expect(out.inferredAnchor?.monthDay).toBe('02-14');
    expect(out.questions).toEqual([]);
    expect(out.status).toBe('enriched');
  });

  it('"Za Dan žena kupiti cvijeće mami" does not ask for a birthday', () => {
    const out = offline('Za Dan žena kupiti cvijeće mami');
    expect(out.inferredAnchor?.monthDay).toBe('03-08');
    expect(out.questions.filter((q) => q.kind === 'date')).toEqual([]);
  });

  it('"Za Božić kupiti poklone" anchors to 25.12.', () => {
    expect(offline('Za Božić kupiti poklone').inferredAnchor?.monthDay).toBe('12-25');
  });

  it('a birthday still asks, offline too', () => {
    const out = offline('Ana želi Dyson fen za rođendan');
    expect(out.questions.map((q) => q.kind)).toContain('date');
  });
});

// Croatian inflects, and a holiday is almost always written in a case other than the nominative: you go
// somewhere "na VelikU GospU", not "na velika gospa". Matching exact strings meant every case had to be
// listed by hand, and the ones nobody thought of silently produced no date at all — a note that reasons
// perfectly and then sets no reminder.
describe('holidays are recognised in the case people actually write', () => {
  const cases: Array<[string, string]> = [
    ['Na Veliku Gospu ići u Međugorje', '08-15'],
    ['Za Veliku Gospu u Sinj', '08-15'],
    ['Na Malu Gospu kod bake', '09-08'],
    ['Za Božić kupiti poklone', '12-25'],
    ['Na Badnjak pripremiti ribu', '12-24'],
    ['Za Uskrs ideme baki', '04-05'],
    ['Na Svete tri kralja', '01-06'],
    ['Za Svih svetih na groblje', '11-01'],
    ['Na Sveti Nikola djeci poklone', '12-06'],
    ['Za Novu godinu rezervirati stol', '01-01'],
    ['Na Silvestrovo van', '12-31'],
    ['Za Valentinovo večera', '02-14'],
    ['Na Dan žena cvijeće', '03-08'],
    ['Za Praznik rada roštilj', '05-01'],
    ['Na Tijelovo procesija', '06-04'],
    ['Za Cvjetnicu u crkvu', '03-29'],
  ];
  for (const [text, monthDay] of cases) {
    it(`"${text}" → ${monthDay}`, () => {
      expect(findKnownDate(text, 2026, 'hr')?.monthDay, text).toBe(monthDay);
    });
  }

  it('the whole chain sets the anchor, not just the lookup', () => {
    const out = ingest(heuristicEnrich('Na Veliku Gospu ići u Međugorje', { now: NOW, anchors: [] }), ictx());
    expect(out.inferredAnchor?.monthDay).toBe('08-15');
    expect(out.questions.filter((q) => q.kind === 'date')).toEqual([]);
    expect(out.drafts.some((d) => d.type === 'anchor')).toBe(true);
  });

  it('an unrelated note still matches nothing', () => {
    expect(findKnownDate('Nazvati Marka u 15h', 2026, 'hr')).toBeNull();
    expect(findKnownDate('Kupiti kruh i mlijeko', 2026, 'hr')).toBeNull();
  });
});

// Offsets around a known event. "Tjedan prije Božića" must land a week BEFORE 25.12., not on it — the whole
// point of naming the offset is that the reminder is useless on the day itself.
describe('offsets measured from a known event', () => {
  const anchorOf = (text: string) => ingest(heuristicEnrich(text, { now: NOW, anchors: [] }), ictx());

  it('"tjedan prije Božića" fires on 18.12., not 25.12.', () => {
    const out = anchorOf('Tjedan prije Božića kupiti vino');
    const offsets = out.drafts.filter((d) => d.type === 'anchor').map((d) => d.offsetDays);
    expect(out.inferredAnchor?.monthDay).toBe('12-25');
    expect(offsets).toContain(-7);
  });

  it('"2 dana prije Uskrsa" carries a −2 offset', () => {
    const out = anchorOf('2 dana prije Uskrsa nazvati baku');
    expect(out.inferredAnchor?.monthDay).toBe('04-05');
    expect(out.drafts.filter((d) => d.type === 'anchor').map((d) => d.offsetDays)).toContain(-2);
  });

  it('"na Božić" itself is offset 0 — the day, not before it', () => {
    const out = anchorOf('Na Božić nazvati sve');
    expect(out.drafts.filter((d) => d.type === 'anchor').map((d) => d.offsetDays)).toContain(0);
  });
});

// A holiday mentioned in passing is not a reminder (prompt point 17). "Božić je moj najdraži blagdan" states
// a preference; scheduling anything for it would be the app inventing an intention the user never had.
describe('a holiday named in passing does not become a reminder', () => {
  const statements = ['Božić je moj najdraži blagdan', 'Uskrs je uvijek u nedjelju', 'Za Valentinovo je gužva svugdje'];
  for (const text of statements) {
    it(`"${text}" sets no anchor`, () => {
      const out = ingest(heuristicEnrich(text, { now: NOW, anchors: [] }), ictx());
      expect(out.inferredAnchor, text).toBeNull();
      expect(out.drafts.filter((d) => d.type === 'anchor'), text).toEqual([]);
    });
  }

  it('but an actual intention still does', () => {
    const out = ingest(heuristicEnrich('Za Božić kupiti poklone', { now: NOW, anchors: [] }), ictx());
    expect(out.inferredAnchor?.monthDay).toBe('12-25');
  });
});
