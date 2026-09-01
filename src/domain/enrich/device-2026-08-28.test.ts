// Device session 2026-08-28 — a relative date IS a date written in the note.
//
// "Branki je rođendan u subotu" asked "Kad je rođendan?" and threw the Saturday away. The parser had
// resolved "u subotu" correctly; the occasion anchor only accepted an EXPLICIT day-month ("5.9."), so the
// anchor had no date, the question fired, and E19 stripped the "unstated" time. Hard rule 12: a date in the note
// itself always wins — "u subotu" and "sutra" are dates in the note, just relative ones.

import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import { ingest } from './ingest';
import { heuristicEnrich, statedOccasionDate } from './heuristic';
import { FakeClock } from '../clock';
import type { EnrichResult } from '../types';

const local = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const NOW = local(2026, 8, 28, 12, 0); // Friday
const rctx = () => ({ now: NOW, anchors: [] });
const ictx = () => ({ existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(NOW) });

const run = (text: string) => ingest(reconcile(heuristicEnrich(text, { now: NOW, anchors: [] }), text, rctx()), ictx());

describe('a birthday dated by a relative phrase is not a question', () => {
  it('"u subotu" dates the anchor to this Saturday and asks nothing (offline path)', () => {
    const out = run('Branki je rođendan u subotu');
    expect(out.questions, 'no date question').toHaveLength(0);
    expect(out.status).toBe('enriched');
    expect(out.needsAnchor).toBeNull();
    expect(out.inferredAnchor).toEqual({ person: 'Branki', kind: 'birthday', monthDay: '08-29' });
    // The day itself is a reminder too — but BOUND to the anchor ("na dan", offset 0), not a free time trigger.
    // A free one stayed at 29.8. when the user moved the birthday and the three chain reminders followed
    // (device, 2026-08-28). Bound, it moves with them.
    expect(out.drafts.some((d) => d.type === 'time')).toBe(false);
    const onTheDay = out.drafts.find((d) => d.type === 'anchor' && 'offsetDays' in d && d.offsetDays === 0);
    expect(onTheDay?.label).toBe('na dan');
    expect(out.drafts.filter((d) => d.type === 'anchor').map((d) => ('offsetDays' in d ? d.offsetDays : null)).sort((a, b) => a! - b!)).toEqual([-21, -7, -1, 0]);
  });

  it('"sutra" does the same', () => {
    const out = run('Branki je rođendan sutra');
    expect(out.questions).toHaveLength(0);
    expect(out.inferredAnchor?.monthDay).toBe('08-29');
  });

  it('"za 2 tjedna u subotu" is Saturday 12.9. — the two signals compose', () => {
    const out = run('Branki je rođendan za 2 tjedna u subotu');
    expect(out.questions).toHaveLength(0);
    expect(out.inferredAnchor?.monthDay).toBe('09-12');
  });

  it('an explicit "5.9." also binds the day itself to the anchor instead of a free time reminder', () => {
    const out = run('Branki je rođendan 5.9.');
    expect(out.drafts.some((d) => d.type === 'time')).toBe(false);
    expect(out.drafts.some((d) => d.type === 'anchor' && 'offsetDays' in d && d.offsetDays === 0)).toBe(true);
  });

  it('the model path agrees: a model anchor without a date takes ours and the question is dropped', () => {
    const TEXT = 'Branki je rođendan u subotu';
    const raw: EnrichResult = {
      summary: 'Rođendan · Branki',
      language: 'hr',
      intent: 'gift',
      confidence: 0.8,
      triggers: [{ type: 'anchor', certainty: 'high', label: '3 tjedna prije', anchor_person: 'Branki', anchor_kind: 'birthday', offset_days: -21 }],
      questions: [],
      needs_anchor: { person: 'Branki', kind: 'birthday' },
    };
    const rec = reconcile(raw, TEXT, rctx());
    expect(rec.needs_anchor).toBeNull();
    expect(rec.triggers.find((t) => t.type === 'anchor')?.anchor_month_day).toBe('08-29');
    expect(ingest(rec, ictx()).questions).toHaveLength(0);
  });

  it('a month-sized offset is not precise enough to date a birthday — still asks', () => {
    const out = run('Branki je rođendan za 3 mjeseca');
    expect(out.questions.map((q) => q.kind)).toEqual(['date']);
  });
});

// Marko, 2026-08-28: "never ask whose birthday it is — we don't store it anywhere, and answering changes nothing."
// An 'options' answer is kept as a keyword and moves no reminder, so a WHO question is a tap with no effect.
// The model still produces them for a nameless note; ingest drops them.
describe('the app never asks who a person is', () => {
  const whose = (text: string, question: string) => {
    const raw: EnrichResult = {
      ...heuristicEnrich(text, { now: NOW, anchors: [] }),
      questions: [{ id: 'q1', kind: 'options', text: question, options: ['Mama', 'Ana', 'Nešto drugo…'] }],
    };
    return ingest(reconcile(raw, text, rctx()), ictx());
  };

  it('"Čiji je rođendan?" for a nameless birthday note is dropped; the day itself is still a reminder', () => {
    const out = whose('Rođendan u subotu, kupiti poklon', 'Čiji je rođendan?');
    expect(out.questions).toHaveLength(0);
    expect(out.status).toBe('enriched');
    expect(out.drafts.some((d) => d.type === 'time')).toBe(true);
  });

  it('other phrasings and English go the same way', () => {
    expect(whose('Kupiti poklon za rođendan', 'Za koga je poklon?').questions).toHaveLength(0);
    expect(whose('Kupiti poklon za rođendan', 'Kome kupuješ poklon?').questions).toHaveLength(0);
    expect(whose('Buy a birthday present', 'Whose birthday is it?').questions).toHaveLength(0);
  });

  it('a genuine options question that is not about a person survives', () => {
    const out = whose('Kupiti poklon za rođendan', 'Koji poklon?');
    expect(out.questions.map((q) => q.text)).toEqual(['Koji poklon?']);
  });

  it('(kept from above) a month-sized offset still asks for the date', () => {
    const out = run('Branki je rođendan za 3 mjeseca');
    expect(out.questions.map((q) => q.kind)).toEqual(['date']);
  });

  it('an explicit date keeps working exactly as before', () => {
    const out = run('Branki je rođendan 5.9.');
    expect(out.questions).toHaveLength(0);
    expect(out.inferredAnchor?.monthDay).toBe('09-05');
  });
});

// Marko, 2026-08-28: a birthday "literally tonight at 8" produced FOUR reminders (−21/−7/−1 rolled into next year,
// "na dan" at the default 09:00 which had passed). Rule: when the moment is TODAY, exactly two reminders — an hour
// before and at the moment — for occasions and tasks alike. The chain is for things ahead, not for tonight.
describe('same day → an hour before and at the moment, nothing else', () => {
  const H = 60 * 60 * 1000;
  const times = (text: string) =>
    run(text)
      .drafts.filter((d) => d.type === 'time')
      .map((d) => ('fireAt' in d && d.fireAt ? new Date(d.fireAt).getHours() + ':' + String(new Date(d.fireAt).getMinutes()).padStart(2, '0') : null));

  it('"Branki je rođendan večeras u 8" → 19:00 and 20:00 today, no chain, no question', () => {
    const out = run('Branki je rođendan večeras u 8');
    expect(out.questions).toHaveLength(0);
    expect(out.drafts.filter((d) => d.type === 'anchor')).toHaveLength(0);
    expect(times('Branki je rođendan večeras u 8')).toEqual(['19:00', '20:00']);
    const labels = out.drafts.filter((d) => d.type === 'time').map((d) => d.label);
    expect(labels).toContain('sat prije');
    for (const d of out.drafts) if (d.type === 'time' && 'fireAt' in d && d.fireAt) expect(new Date(d.fireAt).getDate()).toBe(28);
  });

  it('a plain task today gets the same pair: "Sastanak danas u 15h" → 14:00 and 15:00', () => {
    expect(times('Sastanak danas u 15h')).toEqual(['14:00', '15:00']);
  });

  it('the hour-before is skipped when it is already past: "danas u 12:30" at noon → 12:30 only', () => {
    expect(times('Sastanak danas u 12:30')).toEqual(['12:30']);
  });

  it('"rođendan danas" with no hour: the anchor date is TODAY (not tomorrow), one reminder at the next full hour', () => {
    expect(statedOccasionDate('Branki je rođendan danas', NOW)).toEqual({ month: 8, day: 28, year: null });
    const out = run('Branki je rođendan danas');
    const t = out.drafts.filter((d) => d.type === 'time');
    expect(t).toHaveLength(1);
    expect('fireAt' in t[0]! ? t[0]!.fireAt : null).toBe(NOW + H);
  });

  it('tomorrow is untouched: "Sastanak sutra u 15h" → 15:00 tomorrow only', () => {
    expect(times('Sastanak sutra u 15h')).toEqual(['15:00']);
  });
});

// Marko, 2026-08-28 (evening): "danas je rođendan u 10" produced a reminder at 18:00. The morning 10 had passed, the
// resolver rolled it to TOMORROW 10:00, and E23 then invented "the next full hour". Two rules instead:
//   - a bare hour ≤ 11 whose morning reading is already past means the evening one ("u 10" at 17:00 = 22:00);
//   - a stated hour that has genuinely passed today is an event that is over — no reminder, nothing invented.
describe('same day, hour already passed', () => {
  const at = (h: number, mi = 0) => local(2026, 8, 28, h, mi);
  const runAt = (text: string, now: number) =>
    ingest(reconcile(heuristicEnrich(text, { now, anchors: [] }), text, { now, anchors: [] }), { existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(now) });
  const hours = (text: string, now: number) =>
    runAt(text, now)
      .drafts.filter((d) => d.type === 'time')
      .map((d) => ('fireAt' in d && d.fireAt ? `${new Date(d.fireAt).getDate()}. ${new Date(d.fireAt).getHours()}:00` : null));

  it('"danas je rođendan u 10" at 17:00 → 21:00 and 22:00 today (the evening ten)', () => {
    expect(hours('Branki je rođendan danas u 10', at(17))).toEqual(['28. 21:00', '28. 22:00']);
  });

  it('the same note at 08:00 → 9:00 and 10:00 (the morning ten is still ahead)', () => {
    expect(hours('Branki je rođendan danas u 10', at(8))).toEqual(['28. 9:00', '28. 10:00']);
  });

  it('"sastanak danas u 15" at 17:00: the meeting is over — no time reminder, nothing invented', () => {
    const out = runAt('Sastanak danas u 15h', at(17));
    expect(out.drafts.filter((d) => d.type === 'time')).toHaveLength(0);
    expect(out.drafts.some((d) => d.type === 'semantic')).toBe(true);
  });

  it('"danas" with NO hour still gets the next full hour (that rule is for the hourless case only)', () => {
    expect(hours('Branki je rođendan danas', at(17, 20))).toEqual(['28. 18:00']);
  });
});

// Marko, 2026-08-28: after deleting every reminder and re-reading "rođendan u 8 u petak" the app asked for the date.
// The heuristic builds an anchor only when a PERSON is named, so nothing carried the Friday to reconcile, and the
// model's nameless anchor asked. The text dates the occasion whether or not anyone is named.
describe('a nameless occasion still takes its date from the text', () => {
  it('model path: "rođendan u 8 u petak" (said on a Friday) → next Friday, no question', () => {
    const TEXT = 'rođendan u 8 u petak';
    const raw: EnrichResult = {
      ...heuristicEnrich(TEXT, { now: NOW, anchors: [] }),
      intent: 'gift',
      triggers: [{ type: 'anchor', certainty: 'medium', label: '3 tjedna prije', anchor_person: 'Netko', anchor_kind: 'birthday', offset_days: -21 }],
      needs_anchor: { person: 'Netko', kind: 'birthday' },
      questions: [],
    };
    const rec = reconcile(raw, TEXT, rctx());
    expect(rec.needs_anchor).toBeNull();
    expect(rec.triggers.find((t) => t.type === 'anchor')?.anchor_month_day).toBe('09-04');
    const out = ingest(rec, ictx());
    expect(out.questions).toHaveLength(0);
    expect(out.inferredAnchor?.monthDay).toBe('09-04');
  });
});

// Marko, 2026-08-28: "add more odd sentences — English will be fine, Croatian is what matters." Everyday dictation
// through the whole chain (heuristic → reconcile → ingest). Each line: what people say → the day the app must land on.
describe('odd Croatian sentences land on the right day and ask nothing', () => {
  /** Every MM-DD the note ended up pointing at: time drafts, plus the inferred anchor's day. */
  const days = (text: string) => {
    const out = run(text);
    const md = (t: number) => `${String(new Date(t).getMonth() + 1).padStart(2, '0')}-${String(new Date(t).getDate()).padStart(2, '0')}`;
    const set = new Set<string>();
    for (const d of out.drafts) if (d.type === 'time' && 'fireAt' in d && d.fireAt) set.add(md(d.fireAt));
    if (out.inferredAnchor) set.add(out.inferredAnchor.monthDay);
    return { days: [...set], questions: out.questions.map((q) => q.text), out };
  };
  const hm = (text: string) => {
    const t = run(text).drafts.find((d) => d.type === 'time');
    return t && 'fireAt' in t && t.fireAt ? `${new Date(t.fireAt).getHours()}:${String(new Date(t.fireAt).getMinutes()).padStart(2, '0')}` : null;
  };

  // NOW is Friday 28.8.2026, noon.
  const cases: Array<[string, string]> = [
    ['Mami je rođendan prekosutra', '08-30'],
    ['Kumu je rođendan iduću subotu', '09-05'],
    ['Babi je god u nedilju', '08-30'],
    ['Godišnjica braka nam je 12.9.', '09-12'],
    ['Frendu je rođendan za dva tjedna', '09-11'],
    ['Sastanak u ponediljak u pola 9', '08-31'],
    ['Zubar za tri tjedna u utorak', '09-15'],
    ['Platit režije do petka', '09-04'],
    ['U 10 misecu prva srida imam sastanak', '10-07'],
    ['rođendan u 8 u petak', '09-04'],
  ];
  for (const [text, day] of cases) {
    it(`"${text}" → ${day}, no question`, () => {
      const r = days(text);
      expect(r.questions, `asked: ${r.questions.join(' | ')}`).toEqual([]);
      expect(r.days, `days: ${r.days.join(', ')}`).toContain(day);
    });
  }

  it('hours the way they are said', () => {
    expect(hm('Sastanak u ponediljak u pola 9')).toBe('8:30');
    expect(hm('Nazvat Marka sutra u 7')).toBe('19:00');
    expect(hm('Sutra u 9 i po sastanak')).toBe('9:30');
    expect(hm('Servis auta za šest miseci')).not.toBeNull();
  });
});
