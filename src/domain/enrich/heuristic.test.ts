import { describe, it, expect } from 'vitest';
import { heuristicEnrich, extractTime, extractPeople, detectLanguage, extractExplicitDate, fold, isLikelyPlace } from './heuristic';
import { ingest, MARRIAGE_PERSON } from './ingest';
import { FakeClock } from '../clock';
import type { Anchor } from '../types';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = local(2026, 8, 25, 14, 32); // Tuesday
const ctx = { now: NOW, anchors: [] as Anchor[] };

describe('detectLanguage', () => {
  it('hr vs en', () => {
    expect(detectLanguage('Ana želi Dyson fen za rođendan')).toBe('hr');
    expect(detectLanguage('Remind me to call Mark at 3pm')).toBe('en');
  });
});

describe('extractTime', () => {
  it('"u 15h" today (before 15h) → today 15:00', () => {
    const t = extractTime('podsjeti me u 15h nazvati Marka', NOW, 'hr')!;
    expect(t.iso).toBe('2026-08-25T15:00:00');
    expect(t.certainty).toBe('high');
  });
  it('"u 9h" after 9h → tomorrow 09:00', () => {
    expect(extractTime('u 9h zovi', NOW, 'hr')!.iso).toBe('2026-08-26T09:00:00');
  });
  it('"sutra u 10:30"', () => {
    expect(extractTime('sutra u 10:30 zubar', NOW, 'hr')!.iso).toBe('2026-08-26T10:30:00');
  });
  it('"za 2 tjedna" → +14d 09:00, medium certainty', () => {
    const t = extractTime('za 2 tjedna produžiti registraciju', NOW, 'hr')!;
    expect(t.iso).toBe('2026-09-08T09:00:00');
    expect(t.certainty).toBe('medium');
  });
  it('"u petak" → next Friday', () => {
    expect(extractTime('u petak odnesi auto', NOW, 'hr')!.iso).toBe('2026-08-28T09:00:00');
  });
  it('"at 3pm tomorrow"', () => {
    expect(extractTime('call Mark at 3pm tomorrow', NOW, 'en')!.iso).toBe('2026-08-26T15:00:00');
  });
  it('explicit date 14.3. → next year when passed', () => {
    expect(extractTime('14.3. platiti', NOW, 'hr')!.iso).toBe('2027-03-14T09:00:00');
  });
  it('no time → null (never guesses)', () => {
    expect(extractTime('Ivan preporučio Auto X za servis', NOW, 'hr')).toBeNull();
  });
});

describe('extractPeople', () => {
  it('finds names, resolves possessives, skips sentence-initial non-names', () => {
    expect(extractPeople('Ana želi Dyson fen za rođendan')).toEqual(['Ana']);
    expect(extractPeople('Ivan preporučio Auto X za servis')).toEqual(['Ivan']);
    expect(extractPeople('podsjeti me u 15h nazvati Marka')).toEqual(['Marka']);
    expect(extractPeople('Za Anin rođendan kupiti knjigu')).toEqual(['Ana']);
    expect(extractPeople('Podsjeti me sutra')).toEqual([]);
  });
});

describe('heuristicEnrich → ingest (the three canonical notes)', () => {
  const clock = new FakeClock(NOW);
  const ictx = { existingTriggers: [], anchors: [] as Anchor[], prefs: {}, clock };

  it('"Ana želi Dyson fen za rođendan" → gift, semantic + anchor chain, 1 date question', () => {
    const raw = heuristicEnrich('Ana želi Dyson fen za rođendan', ctx);
    expect(raw.intent).toBe('gift');
    expect(raw.needs_anchor).toEqual({ person: 'Ana', kind: 'birthday' });
    const out = ingest(raw, ictx);
    expect(out.status).toBe('needs_input');
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0]!.text).toBe('Kad je rođendan?');
    expect(out.drafts.map((d) => d.type).sort()).toEqual(['anchor', 'anchor', 'anchor', 'semantic']);
    expect(out.keywords).toEqual(expect.arrayContaining(['poklon', 'fen', 'dyson', 'rođendan']));
  });

  it('"Ivan preporučio Auto X za servis" → future_need, semantic + quiet time fallback, 0 questions', () => {
    const raw = heuristicEnrich('Ivan preporučio Auto X za servis', ctx);
    expect(raw.intent).toBe('future_need');
    expect(raw.category).toBe('auto_servis');
    const out = ingest(raw, ictx);
    expect(out.status).toBe('enriched');
    expect(out.questions).toEqual([]);
    expect(out.drafts.map((d) => d.type).sort()).toEqual(['semantic', 'time']);
    expect(out.keywords).toEqual(expect.arrayContaining(['mehaničar', 'servis', 'auto', 'kvar']));
  });

  it('"podsjeti me u 15h nazvati Marka" → task, time 15:00 today, 0 questions', () => {
    const raw = heuristicEnrich('podsjeti me u 15h nazvati Marka', ctx);
    expect(raw.intent).toBe('task');
    const out = ingest(raw, ictx);
    expect(out.status).toBe('enriched');
    const time = out.drafts.find((d) => d.type === 'time')!;
    expect(time.fireAt).toBe(local(2026, 8, 25, 15));
    expect(out.summary).toBe('Nazvati Marka');
  });

  it('titles differ from the raw text: what it is vs. what you said', () => {
    expect(heuristicEnrich('Ana želi Dyson fen za rođendan', ctx).summary).toBe('Ana: Dyson fen');
    expect(heuristicEnrich('Ivan preporučio Auto X za servis', ctx).summary).toBe('Auto X · servis auta');
    expect(heuristicEnrich('podsjeti me sutra u 10:30 nazvati zubara', ctx).summary).toBe('Nazvati zubara');
    const fact = heuristicEnrich('Restoran Foša u Zadru — odlična riba, rezervirati terasu', ctx).summary;
    expect(fact.startsWith('Restoran Foša')).toBe(true);
    expect(fact.split(' ').length).toBeLessThanOrEqual(6);
  });

  // A stored birthday is NOT reused for the same name (Marko, 2026-08-25): this Ana need not be that Ana, and
  // a confidently wrong reminder is worse than one tap. See askAlways.test.ts.
  it('a previously stored birthday for the same name is still asked again', () => {
    const ana: Anchor = { id: 'a', label: 'Rođendan · Ana', person: 'Ana', kind: 'birthday', monthDay: '03-14', year: null, contactId: null, source: 'user', createdAt: 0, updatedAt: 0 };
    const raw = heuristicEnrich('Ana želi Dyson fen za rođendan', { ...ctx, anchors: [ana] });
    expect(raw.needs_anchor).toEqual({ person: 'Ana', kind: 'birthday' });
    const out = ingest(raw, { ...ictx, anchors: [ana] });
    expect(out.status).toBe('needs_input');
    expect(out.questions.some((q) => q.kind === 'date')).toBe(true);
  });

  it('English task', () => {
    const raw = heuristicEnrich('Remind me to call Mark at 3pm tomorrow', ctx);
    expect(raw.language).toBe('en');
    expect(raw.intent).toBe('task');
    expect(raw.triggers.find((t) => t.type === 'time')!.iso_datetime).toBe('2026-08-26T15:00:00');
  });
});

describe('real-world misses from device testing', () => {
  const clock = new FakeClock(NOW);
  const ictx = { existingTriggers: [], anchors: [] as Anchor[], prefs: {}, clock };

  it('"Bratu poklon puzle za rodendan 10.6" — no diacritics, relation, date in text → anchor inferred, 0 questions', () => {
    const raw = heuristicEnrich('Bratu poklon puzle za rodendan 10.6', ctx);
    expect(raw.intent).toBe('gift');
    expect(raw.category).toBe('poklon');
    expect(raw.entities?.people).toEqual(['Brat']);
    expect(raw.needs_anchor).toBeNull();
    const anchor = raw.triggers.find((t) => t.type === 'anchor')!;
    expect(anchor.anchor_person).toBe('Brat');
    expect(anchor.anchor_month_day).toBe('06-10');
    expect(raw.triggers.some((t) => t.type === 'time')).toBe(false); // the date is the anchor, not a task time
    expect(raw.summary).toBe('Brat: Puzle');

    const out = ingest(raw, ictx);
    expect(out.status).toBe('enriched');
    expect(out.questions).toEqual([]);
    expect(out.inferredAnchor).toEqual({ person: 'Brat', kind: 'birthday', monthDay: '06-10' });
    expect(out.drafts.filter((d) => d.type === 'anchor').map((d) => d.offsetDays).sort((a, b) => a! - b!)).toEqual([-21, -7, -1]);
  });

  it('"Marta želi fotoaparat za rođendan neki Nikon ili Canon" — brands are not people, asks the date', () => {
    const raw = heuristicEnrich('Marta želi fotoaparat za rođendan neki Nikon ili Canon', ctx);
    expect(raw.entities?.people).toEqual(['Marta']);
    expect(raw.needs_anchor).toEqual({ person: 'Marta', kind: 'birthday' });
    expect(raw.summary).toBe('Marta: Fotoaparat');
    const out = ingest(raw, ictx);
    expect(out.questions.map((q) => q.text)).toEqual(['Kad je rođendan?']);
  });

  it('extractExplicitDate handles 10.6 / 10.6. / 10.06.2027 / 6/10 and skips "u 10.30"', () => {
    expect(extractExplicitDate('rodendan 10.6')).toEqual({ month: 6, day: 10, year: null });
    expect(extractExplicitDate('rodendan 10.6.')).toEqual({ month: 6, day: 10, year: null });
    expect(extractExplicitDate('rodendan 10.06.2027')).toEqual({ month: 6, day: 10, year: 2027 });
    expect(extractExplicitDate('rodendan 10/6')).toEqual({ month: 6, day: 10, year: null });
    expect(extractExplicitDate('sastanak u 10.30')).toBeNull();
    expect(extractExplicitDate('cijena 199.99')).toBeNull();
  });

  it('fold() makes rođendan / rodjendan / rodendan equal', () => {
    expect(fold('rođendan')).toBe('rodendan');
    expect(fold('rodjendan')).toBe('rodendan');
    expect(fold('Želi šešir')).toBe('zeli sesir');
  });

  it('spoken dates from dictation: "treći petog", "trećeg svibnja", "dvadeset trećeg drugog", "3. svibnja 2027"', () => {
    expect(extractExplicitDate('Godišnjica braka je treći petog sljedeće godine')).toEqual({ month: 5, day: 3, year: null });
    expect(extractExplicitDate('rođendan mu je trećeg svibnja')).toEqual({ month: 5, day: 3, year: null });
    expect(extractExplicitDate('dvadeset trećeg drugog ima rođendan')).toEqual({ month: 2, day: 23, year: null });
    expect(extractExplicitDate('vjenčanje 3. svibnja 2027.')).toEqual({ month: 5, day: 3, year: 2027 });
    expect(extractExplicitDate('petnaestog siječnja')).toEqual({ month: 1, day: 15, year: null });
    expect(extractExplicitDate('nazvati u pet popodne')).toBeNull(); // "pet" alone is not a date
    expect(extractExplicitDate('kupiti pet jabuka i tri kruške')).toBeNull();
  });

  it('places are never people: "u Zadru", "na Krku", "iz Splita", but "kod Pere" still is', () => {
    expect(extractPeople('rezervirati restoran negdje u Zadru')).toEqual([]);
    expect(extractPeople('konoba na Krku, gazda Ive')).toEqual(['Ive']);
    expect(extractPeople('Rekla je Ana da se preselila iz Splita')).toEqual(['Ana']);
    expect(extractPeople('knjiga koju je vidio kod Pere')).toEqual(['Pere']);
    expect(isLikelyPlace('Zadru', 'u')).toBe(true);
    expect(isLikelyPlace('Zagreb')).toBe(true);
    expect(isLikelyPlace('Marta', 'za')).toBe(false);
  });

  it('"Godišnjica braka je treći petog sljedeće godine…" → marriage anchor with the stated date, no question, no fake person', () => {
    const raw = heuristicEnrich('Godišnjica braka je treći petog sljedeće godine i treba rezervirati na vrijeme restoran negdje u Zadru', ctx);
    expect(raw.entities?.people).toEqual([]);
    const anchor = raw.triggers.find((t) => t.type === 'anchor')!;
    expect(anchor.anchor_person).toBe(MARRIAGE_PERSON);
    expect(anchor.anchor_kind).toBe('anniversary');
    expect(anchor.anchor_month_day).toBe('05-03');
    expect(raw.needs_anchor).toBeNull();
    const out = ingest(raw, { existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(NOW) });
    expect(out.status).toBe('enriched');
    expect(out.questions).toEqual([]);
    expect(out.inferredAnchor).toEqual({ person: MARRIAGE_PERSON, kind: 'anniversary', monthDay: '05-03' });
  });

  it('marriage anniversary WITHOUT a date asks "Kad je godišnjica braka?" — never a spouse or a place', () => {
    const raw = heuristicEnrich('Za godišnjicu braka rezervirati restoran u Zadru', ctx);
    const out = ingest(raw, { existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(NOW) });
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0]!.text).toBe('Kad je godišnjica braka?');
    expect(out.questions[0]!.person).toBe(MARRIAGE_PERSON);
  });

  it('lowercase relation without a proper name → person', () => {
    expect(extractPeople('mami za rođendan kupiti šal')).toEqual(['Mama']);
    expect(extractPeople('poklon za sestru')).toEqual(['Sestra']);
    expect(extractPeople('Bratu poklon puzle')).toEqual(['Brat']);
  });
});
