// Temporal parsing is deterministic TypeScript, never the model's arithmetic. These are Marko's own
// hard cases (2026-08-25) plus the everyday colloquial forms people actually dictate.

import { describe, it, expect } from 'vitest';
import { parseTemporal, resolveSignal, DEFAULT_HOUR, type TemporalSignal } from './temporal';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
// Tuesday 25 Aug 2026, 14:32
const NOW = local(2026, 8, 25, 14, 32);

/** First signal of a text, or null. */
const sig = (text: string): TemporalSignal | null => parseTemporal(text, NOW)[0] ?? null;
/** Resolved local date-time of the first signal, as 'YYYY-MM-DD HH:mm'. */
const at = (text: string, intent = 'task'): string | null => {
  const s = sig(text);
  if (!s) return null;
  const r = resolveSignal(s, NOW, intent);
  if (r?.fireAt == null) return null;
  const d = new Date(r.fireAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

describe('absolute dates and times', () => {
  it('explicit date without a year takes the next occurrence', () => {
    expect(at('Podsjeti me 10.6. platiti ratu')).toBe('2027-06-10 09:00');
    expect(at('Registracija istječe 12.11.')).toBe('2026-11-12 09:00');
  });

  it('explicit date with a year is used verbatim', () => {
    expect(at('Podsjeti me 10.6.2027. platiti ratu')).toBe('2027-06-10 09:00');
  });

  it('bare hour: still today if the hour is ahead, tomorrow once it has passed', () => {
    // now = 14:32
    expect(at('podsjeti me u 15h nazvati Marka')).toBe('2026-08-25 15:00'); // 15h is still ahead today
    expect(at('podsjeti me u 18h nazvati Marka')).toBe('2026-08-25 18:00');
    expect(at('podsjeti me u 9h nazvati Marka')).toBe('2026-08-26 09:00'); // 9h has passed → tomorrow
  });

  it('date + time together', () => {
    expect(at('Sutra u 9 odnijeti paket')).toBe('2026-08-26 09:00');
    expect(at('U petak u 18h večera')).toBe('2026-08-28 18:00');
  });

  it('a month name alone is the first of that month', () => {
    expect(at('U listopadu servis')).toBe('2026-10-01 09:00');
  });
});

describe('relative expressions', () => {
  it('tomorrow / day after / today', () => {
    expect(at('Sutra nazvati Peru')).toBe('2026-08-26 09:00');
    expect(at('Prekosutra nazvati Peru')).toBe('2026-08-27 09:00');
    // colloquial spelling Marko listed
    expect(at('Preksutra nazvati Peru')).toBe('2026-08-27 09:00');
  });

  it('in N days / weeks / months', () => {
    expect(at('Za 2 dana platiti')).toBe('2026-08-27 09:00');
    expect(at('Za tjedan dana platiti')).toBe('2026-09-01 09:00');
    expect(at('Za 2 tjedna platiti komunalije')).toBe('2026-09-08 09:00');
    expect(at('Za 6 mjeseci servis')).toBe('2027-02-25 09:00');
  });

  it('next week is the Monday of next week', () => {
    expect(at('Sljedeći tjedan nazvati Peru')).toBe('2026-08-31 09:00');
    expect(at('Idući tjedan nazvati Peru')).toBe('2026-08-31 09:00');
  });

  it('next month is the 1st', () => {
    expect(at('Sljedeći mjesec platiti')).toBe('2026-09-01 09:00');
  });

  it('weekday: this coming one, and the one after', () => {
    expect(at('U petak nazvati Peru')).toBe('2026-08-28 09:00');
    expect(at('Sljedeći petak nazvati Peru')).toBe('2026-09-04 09:00');
    expect(at('Ove subote na more')).toBe('2026-08-29 09:00');
  });
});

describe('periods of the day are never a question', () => {
  it('morning / afternoon / evening / night map to fixed hours', () => {
    expect(at('Sutra ujutro nazvati Marka')).toBe('2026-08-26 09:00');
    expect(at('Sutra popodne nazvati Marka')).toBe('2026-08-26 15:00');
    expect(at('U petak navečer rezervirati stol')).toBe('2026-08-28 19:00');
    expect(at('Sutra noću')).toBe('2026-08-26 21:00');
  });

  it('a period alone still yields a time, at medium certainty', () => {
    const s = sig('Navečer nazvati mamu');
    expect(s).toBeTruthy();
    expect(resolveSignal(s!, NOW, 'task')?.certainty).toBe('medium');
  });
});

describe('week/month parts', () => {
  it('end of week is Friday 15:00', () => {
    expect(at('Krajem tjedna nazvati Peru')).toBe('2026-08-28 15:00');
    expect(at('Pred kraj tjedna nazvati Peru')).toBe('2026-08-28 15:00');
  });

  it('end of next week', () => {
    expect(at('Krajem sljedećeg tjedna')).toBe('2026-09-04 15:00');
  });

  it('start / middle / end of month', () => {
    expect(at('Početkom mjeseca platiti')).toBe('2026-09-01 09:00');
    expect(at('Sredinom mjeseca platiti')).toBe('2026-09-15 10:00');
    expect(at('Krajem mjeseca platiti')).toBe('2026-08-31 10:00');
  });

  it('end of year', () => {
    expect(at('Krajem godine napraviti obračun')).toBe('2026-12-31 10:00');
  });

  it('for the weekend', () => {
    expect(at('Za vikend na more')).toBe('2026-08-29 09:00'); // the coming Saturday
  });
});

describe('deadlines win over plain dates', () => {
  it('"do petka" is a deadline on Friday', () => {
    const s = sig('Moram predati dokument do petka');
    expect(s?.type).toBe('deadline');
    expect(at('Moram predati dokument do petka')).toBe('2026-08-28 09:00');
  });

  it('"do 15.9." is a dated deadline', () => {
    const s = sig('Moram predati dokument do 15.9.');
    expect(s?.type).toBe('deadline');
    expect(at('Moram predati dokument do 15.9.')).toBe('2026-09-15 09:00');
  });

  it('"najkasnije u petak" and "prije petka" are the same deadline', () => {
    expect(at('Najkasnije u petak poslati')).toBe('2026-08-28 09:00');
    expect(at('Prije petka poslati')).toBe('2026-08-28 09:00');
  });

  it('"nakon petka" is after, not a deadline', () => {
    const s = sig('Nakon petka nazvati');
    expect(s?.type).not.toBe('deadline');
    expect(at('Nakon petka nazvati')).toBe('2026-08-29 09:00');
  });

  it('a deadline outranks another date in the same note', () => {
    const signals = parseTemporal('U petak navečer podsjeti me da do 15.9. predam dokument', NOW);
    expect(signals[0]!.type).toBe('deadline');
  });
});

describe('offsets from an occasion — never invented, always an offset', () => {
  it('"2 dana prije" is an offset, not a date', () => {
    const s = sig('Podsjeti me 2 dana prije Aninog rođendana');
    expect(s?.type).toBe('offset_from_anchor');
    if (s?.type === 'offset_from_anchor') expect(s.offsetDays).toBe(-2);
  });

  it('"tjedan dana prije" → −7', () => {
    const s = sig('Tjedan dana prije godišnjice rezervirati restoran');
    expect(s?.type).toBe('offset_from_anchor');
    if (s?.type === 'offset_from_anchor') expect(s.offsetDays).toBe(-7);
  });

  it('"dan prije" → −1, "dan poslije" → +1', () => {
    const a = sig('Dan prije rođendana kupiti tortu');
    if (a?.type === 'offset_from_anchor') expect(a.offsetDays).toBe(-1);
    const b = sig('Dan poslije rođendana');
    if (b?.type === 'offset_from_anchor') expect(b.offsetDays).toBe(1);
  });

  it('"2 tjedna prije" → −14', () => {
    const s = sig('2 tjedna prije Aninog rođendana');
    if (s?.type === 'offset_from_anchor') expect(s.offsetDays).toBe(-14);
  });

  it('an offset with no resolvable occasion produces no date', () => {
    const s = sig('Podsjeti me 2 dana prije Aninog rođendana');
    expect(resolveSignal(s!, NOW, 'gift')?.fireAt ?? null).toBeNull();
  });
});

describe('recurring', () => {
  it('every 6 months', () => {
    const s = sig('Servis auta svakih 6 mjeseci');
    expect(s?.type).toBe('recurring');
    if (s?.type === 'recurring') {
      expect(s.months).toBe(6);
      expect(s.rule).toBe('monthly');
    }
  });

  it('yearly forms', () => {
    for (const text of ['Svake godine kupiti mami poklon', 'Jednom godišnje servis']) {
      const s = sig(text);
      expect(s?.type, text).toBe('recurring');
      if (s?.type === 'recurring') expect(s.rule).toBe('yearly');
    }
  });

  it('every Monday is weekly on a weekday', () => {
    const s = sig('Svaki ponedjeljak izvaditi smeće');
    expect(s?.type).toBe('recurring');
    if (s?.type === 'recurring') {
      expect(s.rule).toBe('weekly');
      expect(s.weekday).toBe(1);
    }
  });

  it('every 3 months', () => {
    const s = sig('Svaka 3 mjeseca zubar');
    if (s?.type === 'recurring') expect(s.months).toBe(3);
  });

  it('a recurring signal resolves to its first future occurrence', () => {
    const s = sig('Servis auta svakih 6 mjeseci')!;
    const r = resolveSignal(s, NOW, 'future_need');
    expect(r?.fireAt).toBe(local(2027, 2, 25, DEFAULT_HOUR.future_need, 0));
    expect(r?.recurring).toBe('monthly');
  });
});

describe('conditional / contextual — a phrase, never a fake date', () => {
  const cases = [
    'Kad završim s autom pogledati ovo',
    'Nakon što odem zubaru naručiti kontrolu',
    'Kad budem opet u Zagrebu otići u knjižaru',
    'Ovo mi treba kad budem mijenjao gume',
    'Kad budem kupovao novi auto pogledati Auto X',
    'Ako se opet pokvari klima zvati Darija',
    'Prije sljedećeg putovanja provjeriti putovnicu',
  ];
  for (const text of cases) {
    it(`"${text}" is contextual, with no invented date`, () => {
      const s = sig(text);
      expect(s?.type, text).toBe('contextual');
      expect(resolveSignal(s!, NOW, 'idea')?.fireAt ?? null).toBeNull();
    });
  }

  it('the phrase is kept so it can become search keywords', () => {
    const s = sig('Ovo mi treba kad budem mijenjao gume');
    if (s?.type === 'contextual') expect(s.phrase.length).toBeGreaterThan(3);
  });
});

describe('seasons stay vague on purpose', () => {
  it('"prije ljeta" is a low-certainty season, not a made-up day', () => {
    const s = sig('Prije ljeta servisirati klimu');
    expect(s?.type).toBe('season');
    expect(resolveSignal(s!, NOW, 'task')?.certainty).toBe('low');
  });

  it('"oko Božića" is low certainty', () => {
    const s = sig('Oko Božića kupiti poklone');
    expect(s).toBeTruthy();
    expect(resolveSignal(s!, NOW, 'gift')?.certainty).toBe('low');
  });
});

describe('past dates never come back as the past', () => {
  it('a past day-month rolls to next year', () => {
    // 10.2. already passed in 2026
    expect(at('Podsjeti me 10.2. na pregled')).toBe('2027-02-10 09:00');
  });

  it('an explicitly past year yields no trigger', () => {
    const s = sig('Bio sam kod mehaničara 10.2.2024.');
    const r = s ? resolveSignal(s, NOW, 'fact') : null;
    expect(r?.fireAt ?? null).toBeNull();
  });
});

describe('default hour per intent, never asked', () => {
  it('a date without an hour uses the intent default', () => {
    expect(at('Sutra kupiti poklon', 'gift')).toBe('2026-08-26 10:00');
    expect(at('Sutra nazvati', 'task')).toBe('2026-08-26 09:00');
    expect(at('Sutra pogledati', 'idea')).toBe('2026-08-26 10:00');
  });

  it('an explicit hour always wins over the default', () => {
    expect(at('Sutra u 17h kupiti poklon', 'gift')).toBe('2026-08-26 17:00');
  });
});

describe('certainty reflects how precise the text was', () => {
  it('explicit date/time is high', () => {
    expect(resolveSignal(sig('Sutra u 15h')!, NOW, 'task')?.certainty).toBe('high');
    expect(resolveSignal(sig('10.6.2027.')!, NOW, 'task')?.certainty).toBe('high');
  });

  it('approximate ranges are low', () => {
    const s = sig('Za 2-3 tjedna nazvati');
    expect(s).toBeTruthy();
    expect(resolveSignal(s!, NOW, 'task')?.certainty).toBe('low');
  });

  it('picking a concrete day out of a vague phrase does not raise certainty', () => {
    expect(resolveSignal(sig('Krajem mjeseca platiti')!, NOW, 'task')?.certainty).toBe('medium');
  });
});

describe('no temporal signal at all', () => {
  for (const text of ['Ana želi Dyson fen', 'Mehaničar Dario popravio klimu', 'WiFi lozinka kod bake: Slavonija1950']) {
    it(`"${text}" has no signal`, () => {
      expect(parseTemporal(text, NOW)).toEqual([]);
    });
  }
});

describe('multiple signals are ordered by usefulness', () => {
  it('the reminder time comes before a date mentioned in the content', () => {
    const signals = parseTemporal('U petak navečer podsjeti me da u subotu kupim poklon', NOW);
    expect(signals.length).toBeGreaterThan(1);
    // Friday evening is when to remind; Saturday is content.
    const first = resolveSignal(signals[0]!, NOW, 'task');
    const d = new Date(first!.fireAt!);
    expect(d.getDay()).toBe(5); // Friday
    expect(d.getHours()).toBe(19);
  });

  it('"sutra ujutro, a ako ne prekosutra" takes the first, nearest option', () => {
    expect(at('Nazovi Marka sutra ujutro, a ako ne, prekosutra')).toBe('2026-08-26 09:00');
  });
});

// People dictate in their own dialect, not in the standard. Ikavica ("srida", "u sridu", "ponediljak") is what
// half of Dalmatia says out loud, and Whisper transcribes it faithfully — so the parser has to read it.
// Reported from the device: "nazvati kuma u sridu" produced a good title and NO reminder at all.
describe('dialect: ikavica and colloquial weekday forms', () => {
  it('"u sridu" is Wednesday', () => {
    expect(at('Nazvati kuma u sridu')).toBe('2026-08-26 09:00');
  });

  it('the standard form still works', () => {
    expect(at('Nazvati kuma u srijedu')).toBe('2026-08-26 09:00');
  });

  const dialect: Array<[string, number]> = [
    ['Nazvati u ponediljak', 1],
    ['Nazvati u utorak', 2],
    ['Nazvati u sridu', 3],
    ['Nazvati u četvrtak', 4],
    ['Nazvati u petak', 5],
    ['Nazvati u subotu', 6],
    ['Nazvati u nediju', 0],
  ];
  for (const [text, weekday] of dialect) {
    it(`"${text}" → weekday ${weekday}`, () => {
      const s = sig(text);
      expect(s?.type, text).toBe('weekday');
      if (s?.type === 'weekday') expect(s.weekday, text).toBe(weekday);
    });
  }

  it('"sljedeću sridu" is the week after', () => {
    expect(at('Nazvati kuma sljedeću sridu')).toBe('2026-09-02 09:00');
  });

  it('recurring works in dialect too', () => {
    const s = sig('Svaku sridu trening');
    expect(s?.type).toBe('recurring');
    if (s?.type === 'recurring') expect(s.weekday).toBe(3);
  });
});

describe('dialect: the rest of the vocabulary, not just weekdays', () => {
  it('"prikosutra" is the day after tomorrow', () => {
    expect(at('Nazvati prikosutra')).toBe('2026-08-27 09:00');
  });

  it('"misec" is a month', () => {
    expect(at('Platiti za misec dana')).toBe('2026-09-25 09:00');
    expect(at('Platiti krajem miseca')).toBe('2026-08-31 10:00');
  });

  it('"nedilju" reads as Sunday, not as "week"', () => {
    const s = sig('Nazvati u nedilju');
    expect(s?.type).toBe('weekday');
    if (s?.type === 'weekday') expect(s.weekday).toBe(0);
  });
});

// ── Compound expressions: how people actually dictate a time. Each of these combines two or three signals
// ("next month" + "first Wednesday" + "at noon") that the parser previously handled only in isolation.
// NOW is Tuesday 25 Aug 2026, 14:32.
describe('compound: period + weekday + hour', () => {
  const cases: Array<[string, string]> = [
    // "next month" alone starts at the 1st
    ['Sljedeći misec nazvati majku', '2026-09-01 09:00'],
    ['Sljedeći mjesec u podne nazvati majku', '2026-09-01 12:00'],
    ['Sljedeći misec u podne nazvati majku', '2026-09-01 12:00'],
    // next week + weekday + hour
    ['Sljedeći tjedan u sridu u 14', '2026-09-02 14:00'],
    ['Sljedeći tjedan u srijedu u 14h', '2026-09-02 14:00'],
    ['Sljedeći tjedan u petak navečer', '2026-09-04 19:00'],
    // weekday + part of day
    ['U sridu ujutro', '2026-08-26 09:00'],
    ['U sridu predvečer', '2026-08-26 18:00'],
    ['U petak popodne', '2026-08-28 15:00'],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}" → ${expected}`, () => {
      expect(at(text)).toBe(expected);
    });
  }
});

describe('a bare hour is read the way a person means it', () => {
  // "u 2" almost never means 02:00. Without an am/pm marker, a small hour is the afternoon one.
  it('"u 2 popodne" is 14:00', () => {
    expect(at('Nazvati u 2 popodne')).toBe('2026-08-26 14:00'); // 14:00 already passed at 14:32 → tomorrow
  });

  it('"u 2" alone is 14:00, not 02:00', () => {
    expect(at('Nazvati u 2')).toBe('2026-08-26 14:00');
  });

  it('"u 7 ujutro" stays 07:00', () => {
    expect(at('Nazvati u 7 ujutro')).toBe('2026-08-26 07:00');
  });

  it('"u 7 navečer" is 19:00', () => {
    expect(at('Nazvati u 7 navečer')).toBe('2026-08-25 19:00');
  });

  it('"u 8" is 08:00 tomorrow — a plausible morning hour, already passed today', () => {
    expect(at('Nazvati u 8')).toBe('2026-08-26 08:00');
  });

  it('an explicit 24h hour is never shifted', () => {
    expect(at('Nazvati u 14h')).toBe('2026-08-26 14:00');
    expect(at('Nazvati u 20:30')).toBe('2026-08-25 20:30');
  });
});

describe('nth weekday of a month', () => {
  const cases: Array<[string, string]> = [
    ['Prva srida u misecu u podne', '2026-09-02 12:00'],
    ['Sljedeći misec prva srida u podne', '2026-09-02 12:00'],
    ['Prvi ponedjeljak u mjesecu', '2026-09-07 09:00'],
    ['Zadnji petak u mjesecu', '2026-08-28 09:00'],
    ['Druga subota u mjesecu', '2026-09-12 09:00'],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}" → ${expected}`, () => {
      expect(at(text)).toBe(expected);
    });
  }
});

describe('a month named by number or name, with a weekend or a day', () => {
  it('"prvi vikend u 7. misecu" is the first Saturday of July', () => {
    expect(at('Prvi vikend u 7. misecu')).toBe('2027-07-03 09:00');
  });

  it('"u 9. misecu" is the 1st of September', () => {
    expect(at('Platiti u 9. misecu')).toBe('2026-09-01 09:00');
  });

  it('"prvi vikend u srpnju" is the same as the numeric form', () => {
    expect(at('Prvi vikend u srpnju')).toBe('2027-07-03 09:00');
  });
});

describe('parts of the day people actually say', () => {
  const cases: Array<[string, number]> = [
    ['Nazvati sutra ujutro', 9],
    ['Nazvati sutra prijepodne', 9],
    ['Nazvati sutra u podne', 12],
    ['Nazvati sutra popodne', 15],
    ['Nazvati sutra predvečer', 18],
    ['Nazvati sutra navečer', 19],
    ['Nazvati sutra kasno navečer', 21],
  ];
  for (const [text, hour] of cases) {
    it(`"${text}" → ${String(hour).padStart(2, '0')}:00`, () => {
      expect(at(text)?.slice(-5)).toBe(`${String(hour).padStart(2, '0')}:00`);
    });
  }
});

// "Prva nedjelja" needs to know WHICH month. The nth-weekday parser found the day but ignored the month the
// sentence named, so every one of these landed on the coming September regardless of what was said.
// NOW is Tuesday 25 Aug 2026.
describe('nth weekday: the month comes from the sentence', () => {
  const cases: Array<[string, string]> = [
    // "in 2 months" → October, not the next occurrence
    ['Za 2 miseca u prvu nedilju nazovi popa', '2026-10-04 09:00'],
    ['Za 2 mjeseca u prvu nedjelju nazovi popa', '2026-10-04 09:00'],
    ['Za 3 mjeseca prvi ponedjeljak', '2026-11-02 09:00'],
    // "next month" → September (August's first Sunday is long past)
    ['Prva nedilja sljedeceg miseca u podne', '2026-09-06 12:00'],
    ['Prva nedjelja sljedećeg mjeseca u podne', '2026-09-06 12:00'],
    ['Zadnji petak sljedećeg mjeseca', '2026-09-25 09:00'],
    // no month named → the next one that has not passed
    ['Prva nedilja u misecu', '2026-09-06 09:00'],
    // a named month still wins
    ['Prva nedjelja u 12. mjesecu', '2026-12-06 09:00'],
  ];
  for (const [text, expected] of cases) {
    it(`"${text}" → ${expected}`, () => {
      expect(at(text)).toBe(expected);
    });
  }

  it('"za 2 miseca" alone is still a plain relative date', () => {
    expect(at('Za 2 miseca platiti')).toBe('2026-10-25 09:00');
  });
});
