// How people actually write notes — as opposed to the grammatical sentences in temporal.test.ts.
//
// Everything here came from one question: what does a real user type at 23:40 with one thumb? Fragments with
// no verb, no diacritics, dialect, typos, emoji, several dates in one note, and — the class this app gets
// wrong most expensively — notes that contain a date but must NOT produce a reminder.
//
// The invariant that matters more than any single expectation: never invent a date, and never silently
// produce a reminder in the past.

import { describe, it, expect } from 'vitest';
import { parseTemporal, resolveSignal, type TemporalSignal } from './temporal';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
// Friday 28 Aug 2026, 12:00 — the date Marko reported the year bug on.
const NOW = local(2026, 8, 28, 12, 0);

const sigs = (text: string): TemporalSignal[] => parseTemporal(text, NOW);
const sig = (text: string): TemporalSignal | null => sigs(text)[0] ?? null;
const at = (text: string, intent = 'task'): string | null => {
  const s = sig(text);
  if (!s) return null;
  const r = resolveSignal(s, NOW, intent);
  if (r?.fireAt == null) return null;
  const d = new Date(r.fireAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** The date part only, for cases where the hour is a default nobody typed. */
const day = (text: string, intent = 'task'): string | null => at(text, intent)?.slice(0, 10) ?? null;
const types = (text: string): string[] => sigs(text).map((s) => s.type);

// ─────────────────────────────────────────────────────────────────────────────
// The reported bug: a year qualifier attached to a named month.

describe('next year + a named month', () => {
  it('"sljedece godine u rujnu" is next September, not next month', () => {
    expect(day('sljedeće godine u rujnu imam tehnički pregled auta')).toBe('2027-09-01');
  });

  it('accepts the colloquial one-word forms', () => {
    expect(day('dogodine u rujnu tehnički')).toBe('2027-09-01');
    expect(day('nagodinu u lipnju vjenčanje')).toBe('2027-06-01');
  });

  it('works with a numeric month and without diacritics', () => {
    expect(day('iduce godine u 9. mjesecu tehnicki')).toBe('2027-09-01');
    expect(day('sljedece godine u 6. misecu vjencanje')).toBe('2027-06-01');
  });

  it('leaves a bare month in the nearest occurrence', () => {
    expect(day('u rujnu tehnički')).toBe('2026-09-01');
  });

  it('still treats a lone "sljedece godine" as the start of that year', () => {
    expect(day('sljedeće godine tehnički')).toBe('2027-01-01');
  });

  it('does not confuse "sljedeci mjesec" with a year', () => {
    expect(day('sljedeći mjesec tehnički')).toBe('2026-09-01');
  });

  it('handles multi-year offsets', () => {
    expect(day('za 2 godine registracija')).toBe('2028-08-28');
    expect(day('za 3 godine putovnica ističe')).toBe('2029-08-28');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fragments: no verb, no sentence, often no diacritics.

describe('fragments people actually type', () => {
  it('reads a bare noun + date', () => {
    expect(day('zubaru 12.9.')).toBe('2026-09-12');
    expect(day('10.9. — zubar')).toBe('2026-09-10');
    expect(day('15.9. / servis')).toBe('2026-09-15');
  });

  it('reads a bare noun + weekday', () => {
    expect(day('račun do petka')).toBe('2026-09-04');
  });

  it('reads a bare relative offset', () => {
    expect(day('uplatit struju sutra')).toBe('2026-08-29');
  });

  it('leaves an open-ended fragment without a date', () => {
    expect(at('projekt jednog dana')).toBeNull();
    expect(at('hotel za Split')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Numbers that only look like dates. Every false positive here is a wrong reminder.

describe('numbers that are not dates', () => {
  it('ignores versions and identifiers', () => {
    expect(at('verzija 2.10')).toBeNull();
    expect(at('Broj police je 1234')).toBeNull();
  });

  it('ignores counts and plain numbers', () => {
    expect(at('stan 14')).toBeNull();
    expect(at('broj 15')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "kad ..." — a condition, never a calendar date.

describe('contextual triggers stay dateless', () => {
  const cases = [
    'kad budem opet u Zagrebu nazvati Ivana',
    'kad budem mijenjao gume pogledati ovaj servis',
    'kad budem u Splitu probati ovu konobu',
    'konoba Mare kad budemo u Zadru',
    'ako se opet pokvari nazvati Darija',
  ];
  for (const c of cases) {
    it(`"${c}" produces no date`, () => {
      expect(at(c)).toBeNull();
      expect(types(c)).toContain('contextual');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Deadline vs. planned day — "do petka" is not "u petak".

describe('deadline vs planned day', () => {
  it('marks "do" as a deadline and "u" as a plain day', () => {
    expect(sig('platiti račun do petka')?.type).toBe('deadline');
    expect(sig('platiti račun u petak')?.type).toBe('weekday');
  });

  it('resolves both to the same Friday', () => {
    expect(day('platiti račun do petka')).toBe('2026-09-04');
    expect(day('platiti račun u petak')).toBe('2026-09-04');
  });

  it('treats "najkasnije" and "rok" as deadlines', () => {
    expect(sig('najkasnije do petka')?.type).toBe('deadline');
    expect(sig('predati do 15.9.')?.type).toBe('deadline');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Approximation must lower certainty rather than invent precision.

describe('approximate wording lowers certainty', () => {
  const certainty = (text: string) => {
    const s = sig(text);
    return s ? resolveSignal(s, NOW, 'task')?.certainty ?? null : null;
  };

  it('an exact offset stays high', () => {
    expect(certainty('za 2 tjedna')).toBe('high');
  });

  it('a vague offset is not high', () => {
    expect(certainty('za koji dan')).not.toBe('high');
  });

  it('a bare season produces no date at all', () => {
    expect(at('prije ljeta srediti klimu')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Noise around the signal: emoji, punctuation, case, filler words.

describe('decoration does not change the result', () => {
  it('ignores emoji and exclamation marks', () => {
    const base = day('sutra u 18 kupiti vino');
    expect(day('🔥 sutra u 18 kupiti vino')).toBe(base);
    expect(day('!!! sutra u 18 kupiti vino')).toBe(base);
  });

  it('ignores case', () => {
    const base = at('sutra u 18 kupiti vino');
    expect(at('SUTRA U 18 KUPITI VINO')).toBe(base);
    expect(at('Sutra U 18 Kupiti Vino')).toBe(base);
  });

  it('ignores polite prefixes', () => {
    const base = at('sutra u 18 kupiti vino');
    expect(at('molim te podsjeti me sutra u 18 kupiti vino')).toBe(base);
    expect(at('nemoj zaboraviti sutra u 18 kupiti vino')).toBe(base);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dialect and typos — Whisper transcribes speech faithfully, so this is the normal case, not an edge one.

describe('dialect and common typos', () => {
  it('reads ikavica weekdays', () => {
    expect(day('nazvati kuma u sridu')).toBe(day('nazvati kuma u srijedu'));
    expect(day('u nedilju nazvati baku')).toBe(day('u nedjelju nazvati baku'));
  });

  it('reads ikavica months and "prikosutra"', () => {
    expect(day('za 2 miseca servis')).toBe(day('za 2 mjeseca servis'));
    expect(day('prikosutra u 8')).toBe(day('prekosutra u 8'));
  });

  it('reads text with no diacritics identically', () => {
    expect(day('sljedeci mjesec tehnicki')).toBe(day('sljedeći mjesec tehnički'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Word order must not change the meaning.

describe('order does not change the result', () => {
  it('agrees across two phrasings of the same instruction', () => {
    const a = at('sljedeći mjesec prva nedjelja u podne');
    const b = at('prva nedjelja sljedećeg mjeseca u podne');
    expect(a).toBe(b);
    expect(a).toBe('2026-09-06 12:00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The invariants that outrank every individual expectation.

describe('invariants', () => {
  const corpus = [
    'zubaru 12.9.', 'Marko petak', 'sutra ujutro', 'za 2 mjeseca u prvu nedjelju', 'do petka',
    'sljedeće godine u rujnu', 'dogodine za Božić', 'krajem mjeseca', 'u 14 nazovi Marka',
    'večeras u 8', 'prekosutra u 8', 'za koji dan', 'oko podne', 'prva nedjelja u listopadu u podne',
    'nagodinu u lipnju', 'za 3 godine', 'u sridu u 14', 'sredinom sljedećeg tjedna',
  ];

  it('never schedules anything in the past', () => {
    for (const text of corpus) {
      for (const s of sigs(text)) {
        const r = resolveSignal(s, NOW, 'task');
        if (r?.fireAt != null) expect(r.fireAt, `"${text}" resolved into the past`).toBeGreaterThan(NOW);
      }
    }
  });

  it('never throws, whatever the input', () => {
    const junk = ['', '   ', '...', '???', '12', '12.', '.12', '99.99.', '🎄🎄🎄', 'aaaaaaa', '2026', '/////'];
    for (const text of [...corpus, ...junk]) {
      expect(() => parseTemporal(text, NOW), `threw on "${text}"`).not.toThrow();
    }
  });
});
