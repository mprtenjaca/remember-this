// Croatia does not speak the standard, and Whisper transcribes what was actually said. A note dictated in
// Dalmatian, Zagorje or Purger slang has to reach the same reminder as the textbook version — otherwise the
// app quietly works worse for the people most likely to dictate rather than type.
//
// Rule for this file: dialect widens RECOGNITION, never meaning. Nothing here may change what a standard
// sentence does (the rest of the suite is the guard for that).

import { describe, it, expect } from 'vitest';
import { heuristicEnrich, extractPeople } from './heuristic';
import { reconcile } from './reconcile';
import { ingest } from './ingest';
import { parseTemporal, resolveSignal } from './temporal';
import { FakeClock } from '../clock';
import type { EnrichResult } from '../types';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = local(2026, 8, 25, 14, 32); // Tuesday
const hctx = { now: NOW, anchors: [] };
const rctx = () => ({ now: NOW, anchors: [], uiLang: 'hr' as const });
const ictx = () => ({ existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(NOW), uiLang: 'hr' as const });

const model = (over: Partial<EnrichResult> = {}): EnrichResult => ({
  summary: 'x',
  language: 'hr',
  intent: 'fact',
  confidence: 0.5,
  triggers: [],
  questions: [],
  ...over,
});

/** Full chain, the way the app runs it. */
const run = (text: string, raw = model()) => ingest(reconcile(raw, text, rctx()), ictx());
/** Offline chain. */
const offline = (text: string) => ingest(heuristicEnrich(text, hctx), ictx());

const when = (text: string): string | null => {
  const s = parseTemporal(text, NOW)[0];
  const r = s ? resolveSignal(s, NOW, 'task') : null;
  if (r?.fireAt == null) return null;
  const d = new Date(r.fireAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

describe('Dalmatian time words', () => {
  const cases: Array<[string, string]> = [
    ['Nazvati kuma u sridu', '2026-08-26 09:00'],
    ['Doći u ponediljak', '2026-08-31 09:00'],
    ['Vidimo se u nedilju', '2026-08-30 09:00'],
    ['Nazvati prikosutra', '2026-08-27 09:00'],
    ['Platiti za misec dana', '2026-09-25 09:00'],
    ['Platiti krajem miseca', '2026-08-31 10:00'],
    ['Doći priko podne', '2026-08-26 12:00'],
    ['Nazvati navečer', '2026-08-25 19:00'],
    ['Nazvati u jutro', '2026-08-26 09:00'],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}" → ${expected}`, () => {
      expect(when(text)).toBe(expected);
    });
  }
});

describe('Zagorje / Purger time words', () => {
  const cases: Array<[string, string]> = [
    ['Nazvati v sredu', '2026-08-26 09:00'],
    ['Dojti v petek', '2026-08-28 09:00'],
    ['Nazvati denes navečer', '2026-08-25 19:00'],
    ['Platiti prekjutro', '2026-08-27 09:00'],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}" → ${expected}`, () => {
      expect(when(text)).toBe(expected);
    });
  }
});

describe('dialect relations become the same person label', () => {
  const cases: Array<[string, string]> = [
    ['Kupiti didu poklon', 'Djed'],
    ['Kupiti dida poklon', 'Djed'],
    ['Kupiti baba poklon', 'Baka'],
    ['Kupiti materi poklon', 'Mama'],
    ['Kupiti ćaći poklon', 'Tata'],
    ['Kupiti caci poklon', 'Tata'],
    ['Kupiti sinovcu poklon', 'Nećak'],
    ['Kupiti bratiću poklon', 'Bratić'],
    ['Kupiti šogoru poklon', 'Šogor'],
    ['Kupiti svekrvi poklon', 'Svekrva'],
    ['Kupiti punici poklon', 'Punica'],
    ['Kupiti stricu poklon', 'Stric'],
  ];
  for (const [text, person] of cases) {
    it(`"${text}" → ${person}`, () => {
      expect(extractPeople(text)).toContain(person);
    });
  }
});

describe('car service in dialect still classifies as future_need', () => {
  const cases = [
    'Mali servis kod Ive, 80 eura',
    'Veliki servis auta kod majstora',
    'Mijenjati gume kod vulkanizera',
    'Pregled auta prije registracije',
    'Mehaničar mi je štimao motor',
  ];
  for (const text of cases) {
    it(`"${text}" → auto_servis`, () => {
      const out = run(text, model({ category: 'auto_servis', intent: 'future_need' }));
      expect(out.category).toBe('auto_servis');
      expect(out.intent).toBe('future_need');
    });
  }
});

// The reported worry: "mali servis za polo" must not read "polo" as half of something, and a car model must
// never become a person to buy a present for.
describe('car models are not people and not fractions', () => {
  const models = ['Polo', 'Golf', 'Passat', 'Astra', 'Corsa', 'Punto', 'Clio', 'Megane', 'Yaris', 'Octavia', 'Fabia'];
  for (const car of models) {
    it(`"${car}" is not a person`, () => {
      expect(extractPeople(`Mali servis za ${car}`)).not.toContain(car);
    });
  }

  it('"Mali servis za polo" produces no birthday question', () => {
    const out = offline('Mali servis za polo');
    expect(out.questions.filter((q) => q.kind === 'date')).toEqual([]);
    expect(out.needsAnchor).toBeNull();
  });

  it('"pola" (half) is not turned into a date either', () => {
    expect(when('Napravljeno pola posla')).toBeNull();
  });

  it('a real person in a car note is still found', () => {
    expect(extractPeople('Mali servis kod Ive za Golf')).toContain('Ive');
  });
});

describe('dialect never changes what the standard already did', () => {
  it('standard weekday still resolves the same', () => {
    expect(when('Nazvati u srijedu')).toBe('2026-08-26 09:00');
    expect(when('Nazvati u ponedjeljak')).toBe('2026-08-31 09:00');
  });

  it('standard relations still resolve the same', () => {
    expect(extractPeople('Kupiti djedu poklon')).toContain('Djed');
    expect(extractPeople('Kupiti baki poklon')).toContain('Baka');
    expect(extractPeople('Kupiti mami poklon')).toContain('Mama');
  });

  it('a gift in dialect still asks for the date', () => {
    const out = offline('Kupiti didu poklon za rodendan');
    expect(out.needsAnchor?.person).toBe('Djed');
    expect(out.questions.some((q) => q.kind === 'date')).toBe(true);
  });
});

// Everyday trade/service vocabulary, including the German-derived words people actually use in a garage or
// around the house. These decide the CATEGORY, which decides the fallback interval — so getting them wrong
// means a car service note comes back at the wrong time, or not at all.
describe('trade vocabulary picks the right category', () => {
  const car = ['Promijeniti auspuh', 'Pukla mi šoferšajba', 'Kvačilo klizi', 'Baterija za auto', 'Farbanje branika', 'Zamjena ulja i filtera', 'Balansiranje guma', 'Tehnički pregled'];
  for (const text of car) {
    it(`"${text}" → auto_servis`, () => {
      expect(heuristicEnrich(text, hctx).category).toBe('auto_servis');
    });
  }

  const home = ['Puknuta cijev u kupaoni', 'Šterika ne radi', 'Bojler curi', 'Zidar za teracu', 'Roleta se zaglavila'];
  for (const text of home) {
    it(`"${text}" → dom`, () => {
      expect(heuristicEnrich(text, hctx).category).toBe('dom');
    });
  }

  it('health words still win over the rest', () => {
    expect(heuristicEnrich('Naručiti se kod zubara', hctx).category).toBe('zdravlje');
  });
});
