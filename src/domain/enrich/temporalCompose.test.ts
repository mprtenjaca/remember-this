// Composed temporal expressions — the ones people actually dictate, where two or three signals stack:
// a relative month, an occurrence inside it, and a time.
//
// THE RULE this file exists to protect:
//
//   "za N mjeseci + X-ti dan u tjednu"  =  move N calendar months FIRST, then find the Nth weekday inside
//   THAT month. Never "the next X from today, plus a month".
//
// The bug that prompted it: "za 2 mjeseca u prvu nedjelju" resolved to the coming September Sunday, because
// the weekday was found first and the month offset was dropped on the floor.

import { describe, it, expect } from 'vitest';
import { parseTemporal, resolveSignal } from './temporal';
import { reconcile } from './reconcile';
import { ingest } from './ingest';
import { FakeClock } from '../clock';
import type { EnrichResult } from '../types';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

/** Resolve a phrase at a given "now", as 'YYYY-MM-DD HH:mm'. */
function at(text: string, now: number, intent = 'task'): string | null {
  const s = parseTemporal(text, now)[0];
  if (!s) return null;
  const r = resolveSignal(s, now, intent);
  if (r?.fireAt == null) return null;
  const d = new Date(r.fireAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Friday 28 Aug 2026 — the date from the report.
const AUG28 = local(2026, 8, 28, 10, 0);

describe('resolves_weekday_occurrence_inside_relative_future_month (permanent regression)', () => {
  it('"Za 2 mjeseca u prvu nedjelju nazovi popa" → 04.10.2026 09:00', () => {
    expect(at('Za 2 mjeseca u prvu nedjelju nazovi popa', AUG28)).toBe('2026-10-04 09:00');
  });

  it('never the current or next month', () => {
    const got = at('Za 2 mjeseca u prvu nedjelju nazovi popa', AUG28);
    expect(got).not.toBe('2026-08-30 09:00');
    expect(got).not.toBe('2026-09-06 09:00');
  });

  it('with a stated time', () => {
    expect(at('Za 2 mjeseca u prvu nedjelju u podne nazovi popa', AUG28)).toBe('2026-10-04 12:00');
    expect(at('Za 2 mjeseca u prvu nedjelju u 2 popodne nazovi popa', AUG28)).toBe('2026-10-04 14:00');
    expect(at('Za 2 mjeseca u prvu nedjelju u 2 ujutro nazovi popa', AUG28)).toBe('2026-10-04 02:00');
  });

  it('the dialect spelling resolves identically', () => {
    expect(at('Za 2 miseca u prvu nedilju nazovi popa', AUG28)).toBe('2026-10-04 09:00');
  });
});

describe('next month + occurrence', () => {
  const cases: Array<[string, string]> = [
    ['Prva nedjelja sljedećeg mjeseca u podne', '2026-09-06 12:00'],
    ['Prva nedilja sljedeceg miseca u podne', '2026-09-06 12:00'],
    ['Sljedeći mjesec prva srijeda u podne', '2026-09-02 12:00'],
    ['Sljedeći misec prva srida u misecu u podne', '2026-09-02 12:00'],
    ['Druga nedjelja sljedećeg mjeseca', '2026-09-13 09:00'],
    ['Zadnji petak sljedećeg mjeseca', '2026-09-25 09:00'],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}" → ${expected}`, () => {
      expect(at(text, AUG28)).toBe(expected);
    });
  }
});

describe('word order does not change the meaning', () => {
  const equivalent = [
    'Prva nedjelja sljedećeg mjeseca u podne',
    'Sljedeći mjesec prva nedjelja u podne',
    'U podne prva nedjelja sljedećeg mjeseca',
  ];
  it('all three phrasings give the same instant', () => {
    const results = equivalent.map((t) => at(t, AUG28));
    expect(new Set(results).size, `got ${JSON.stringify(results)}`).toBe(1);
    expect(results[0]).toBe('2026-09-06 12:00');
  });
});

describe('next week + weekday + hour', () => {
  const cases: Array<[string, string]> = [
    ['Sljedeći tjedan u sridu u 14', '2026-09-02 14:00'],
    ['Sljedeći tjedan u sridu u 2 popodne', '2026-09-02 14:00'],
    ['Sljedeći tjedan u sridu u 2 ujutro', '2026-09-02 02:00'],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}" → ${expected}`, () => {
      expect(at(text, AUG28)).toBe(expected);
    });
  }
});

// Rolling over a year boundary is where naive month arithmetic breaks.
describe('year boundary', () => {
  const DEC20 = local(2026, 12, 20, 10, 0);

  it('"sljedeći mjesec" crosses into 2027', () => {
    expect(at('Sljedeći mjesec platiti', DEC20)?.slice(0, 7)).toBe('2027-01');
  });

  it('"za 2 mjeseca" is February 2027', () => {
    expect(at('Za 2 mjeseca platiti', DEC20)?.slice(0, 7)).toBe('2027-02');
  });

  it('"prva nedjelja sljedećeg mjeseca" is the first Sunday of January 2027', () => {
    expect(at('Prva nedjelja sljedećeg mjeseca', DEC20)).toBe('2027-01-03 09:00');
  });

  it('"prva srijeda za 2 mjeseca" is the first Wednesday of February 2027', () => {
    expect(at('Prva srijeda za 2 mjeseca', DEC20)).toBe('2027-02-03 09:00');
  });
});

// Month-end arithmetic: 31 Jan + 1 month has no 31st to land on.
describe('month-end does not overflow into the month after', () => {
  const cases: Array<[number, string]> = [
    [local(2026, 1, 31, 10, 0), '2026-02'],
    [local(2026, 3, 31, 10, 0), '2026-04'],
    [local(2026, 5, 31, 10, 0), '2026-06'],
    [local(2026, 12, 31, 10, 0), '2027-01'],
    [local(2028, 1, 31, 10, 0), '2028-02'], // leap year
  ];
  for (const [now, expectedMonth] of cases) {
    const label = new Date(now).toISOString().slice(0, 10);
    it(`"za mjesec dana" from ${label} stays in ${expectedMonth}`, () => {
      expect(at('Za mjesec dana platiti', now)?.slice(0, 7)).toBe(expectedMonth);
    });
  }
});

// Every occurrence/weekday pair, checked as a property rather than by listing 45 expected dates.
describe('property: "N-ti <dan> sljedećeg mjeseca" always lands correctly', () => {
  const weekdays: Array<[string, number]> = [
    ['ponedjeljak', 1],
    ['utorak', 2],
    ['srijedu', 3],
    ['četvrtak', 4],
    ['petak', 5],
    ['subotu', 6],
    ['nedjelju', 0],
  ];
  const ordinals: Array<[string, number]> = [
    ['prvi', 1],
    ['drugi', 2],
    ['treći', 3],
  ];

  for (const [dayWord, dayNum] of weekdays) {
    for (const [ordWord, nth] of ordinals) {
      const text = `${ordWord} ${dayWord} sljedećeg mjeseca`;
      it(`"${text}"`, () => {
        const got = at(text, AUG28);
        expect(got, text).toBeTruthy();
        const d = new Date(got!.replace(' ', 'T'));
        expect(d.getMonth(), `${text}: must be September`).toBe(8);
        expect(d.getDay(), `${text}: weekday`).toBe(dayNum);
        // The Nth occurrence sits in the Nth week of the month.
        expect(Math.ceil(d.getDate() / 7), `${text}: occurrence`).toBe(nth);
      });
    }
  }
});

describe('property: a bare hour with a stated part of day', () => {
  it('"u 2 popodne" is always 14, "u 2 ujutro" always 2, "u podne" always 12', () => {
    expect(at('Nazvati u 2 popodne', AUG28)?.slice(-5)).toBe('14:00');
    expect(at('Nazvati u 2 ujutro', AUG28)?.slice(-5)).toBe('02:00');
    expect(at('Nazvati u podne', AUG28)?.slice(-5)).toBe('12:00');
  });

  it('an explicit 24h hour is never rewritten by a part of day', () => {
    expect(at('Nazvati u 14h navečer', AUG28)?.slice(-5)).toBe('14:00');
  });
});

// The parser being right is not enough: reconcile() must not overwrite it, and ingest() must turn it into an
// actual reminder. This walks the real chain the app runs.
describe('the whole pipeline keeps the parsed instant', () => {
  const rctx = () => ({ now: AUG28, anchors: [], uiLang: 'hr' as const });
  const ictx = () => ({ existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(AUG28), uiLang: 'hr' as const });
  const model = (over: Partial<EnrichResult> = {}): EnrichResult => ({
    summary: 'Nazvati popa',
    language: 'hr',
    intent: 'task',
    confidence: 0.5,
    triggers: [],
    questions: [],
    ...over,
  });

  const fireOf = (text: string, raw = model()) => {
    const out = ingest(reconcile(raw, text, rctx()), ictx());
    const t = out.drafts.find((d) => d.type === 'time');
    if (!t?.fireAt) return null;
    const d = new Date(t.fireAt);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  it('"Za 2 mjeseca u prvu nedjelju nazovi popa" reaches the trigger as 04.10.', () => {
    expect(fireOf('Za 2 mjeseca u prvu nedjelju nazovi popa')).toBe('2026-10-04 09:00');
  });

  it('a model-invented date does not overwrite it', () => {
    const raw = model({ triggers: [{ type: 'time', certainty: 'high', label: 'x', iso_datetime: '2026-09-06T09:00:00' }] });
    expect(fireOf('Za 2 mjeseca u prvu nedjelju nazovi popa', raw)).toBe('2026-10-04 09:00');
  });

  it('"Prva nedjelja sljedećeg mjeseca u podne" reaches the trigger as 06.09. 12:00', () => {
    expect(fireOf('Prva nedjelja sljedećeg mjeseca u podne')).toBe('2026-09-06 12:00');
  });

  it('"Sljedeći tjedan u sridu u 14" reaches the trigger as 02.09. 14:00', () => {
    expect(fireOf('Sljedeći tjedan u sridu u 14 nazvati popa')).toBe('2026-09-02 14:00');
  });
});
