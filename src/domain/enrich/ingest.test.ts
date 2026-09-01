import { describe, it, expect } from 'vitest';
import { FakeClock } from '../clock';
import { anchorQuestion, ingest, clampSummary } from './ingest';
import type { Anchor, EnrichResult, Trigger } from '../types';

const local = (y: number, m: number, d: number, h = 0) => new Date(y, m - 1, d, h).getTime();
const clock = new FakeClock(local(2026, 8, 25, 14));

// Personal dates are never recalled by name (see askAlways.test.ts); OFFICIAL ones are, because those really
// are the same day for everyone. So the "known anchor" cases below use an official occasion.
const bozic: Anchor = {
  id: 'a_ana',
  label: 'Božić',
  person: 'Božić',
  kind: 'annual',
  monthDay: '12-25',
  year: null,
  contactId: null,
  source: 'user',
  createdAt: 0,
  updatedAt: 0,
};

const giftResult: EnrichResult = {
  summary: 'Ana želi Dyson fen',
  language: 'hr',
  category: 'poklon',
  intent: 'gift',
  confidence: 0.55,
  entities: { people: ['Ana'], orgs: ['Dyson'], places: [], keywords: ['poklon', 'fen', 'rođendan'] },
  needs_anchor: { person: 'Ana', kind: 'birthday' },
  triggers: [
    { type: 'semantic', certainty: 'high', label: 'kad tražiš poklon', keywords: ['poklon', 'rođendan', 'Ana', 'fen', 'Dyson'] },
    { type: 'anchor', certainty: 'high', label: '3 tjedna prije', anchor_person: 'Ana', anchor_kind: 'birthday', offset_days: -21 },
  ],
  questions: [{ id: 'anchor_date', text: 'Kad je Anin rođendan?', kind: 'date' }],
};

/** The same note shape, but hung off an OFFICIAL occasion — the one kind of anchor that IS recalled. */
const officialGift: EnrichResult = {
  ...giftResult,
  summary: 'Poklon za Božić',
  entities: { people: [], orgs: [], places: [], keywords: ['poklon', 'božić'] },
  needs_anchor: null,
  triggers: [
    { type: 'semantic', certainty: 'high', label: 'kad tražiš poklon', keywords: ['poklon', 'božić'] },
    { type: 'anchor', certainty: 'high', label: '3 tjedna prije', anchor_person: 'Božić', anchor_kind: 'annual', offset_days: -21 },
  ],
  questions: [],
};

const ctx = (over: Partial<Parameters<typeof ingest>[1]> = {}) => ({
  existingTriggers: [] as Trigger[],
  anchors: [] as Anchor[],
  prefs: {} as Record<string, string>,
  clock,
  ...over,
});

describe('ingest — gift with unknown anchor', () => {
  const out = ingest(giftResult, ctx());
  it('needs input and asks exactly one date question', () => {
    expect(out.status).toBe('needs_input');
    expect(out.needsAnchor).toEqual({ person: 'Ana', kind: 'birthday' });
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0]!.kind).toBe('date');
  });
  it('fills the default gift chain (−21, −7, −1) as pending anchor triggers', () => {
    const anchors = out.drafts.filter((d) => d.type === 'anchor');
    expect(anchors.map((a) => a.offsetDays).sort((a, b) => a! - b!)).toEqual([-21, -7, -1]);
    expect(anchors.every((a) => a.anchorId === null && a.fireAt === null)).toBe(true);
    expect((anchors[0]!.payload as { person?: string }).person).toBe('Ana');
  });
  it('keeps the semantic trigger with normalised keywords', () => {
    const sem = out.drafts.find((d) => d.type === 'semantic')!;
    expect((sem.payload as { keywords: string[] }).keywords).toContain('dyson');
  });
});

describe('ingest — gift with a known OFFICIAL anchor', () => {
  const out = ingest(officialGift, ctx({ anchors: [bozic] }));
  it('asks nothing and resolves fire_at for every chain step', () => {
    expect(out.status).toBe('enriched');
    expect(out.questions).toEqual([]);
    const anchors = out.drafts.filter((d) => d.type === 'anchor');
    expect(anchors).toHaveLength(3);
    for (const a of anchors) {
      expect(a.anchorId).toBe('a_ana');
      expect(a.fireAt).toBeGreaterThan(clock.now());
      expect(new Date(a.fireAt!).getHours()).toBe(19);
    }
    const first = anchors.find((a) => a.offsetDays === -21)!;
    const d = new Date(first.fireAt!);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 12, 4]);
  });
  it('honours learned lead time and default hour from prefs', () => {
    const noPinnedOffset = { ...officialGift, triggers: officialGift.triggers.filter((t) => t.type !== 'anchor') };
    const o = ingest({ ...noPinnedOffset, needs_anchor: { person: 'Božić', kind: 'annual' } }, ctx({ anchors: [bozic], prefs: { 'lead_time.gift': '-30', 'hour.default': '9' } }));
    const offs = o.drafts.filter((d) => d.type === 'anchor').map((d) => d.offsetDays);
    expect(offs).toContain(-30);
    expect(offs).not.toContain(-21);
    expect(new Date(o.drafts.find((d) => d.type === 'anchor')!.fireAt!).getHours()).toBe(9);
  });
});

describe('ingest — hard rules', () => {
  it('never touches user_edited triggers and never adds a trigger of a locked type', () => {
    const locked: Trigger = {
      id: 'locked',
      noteId: 'n',
      type: 'anchor',
      payload: { hour: 9, minute: 0 },
      label: null,
      certainty: 1,
      anchorId: 'a_ana',
      offsetDays: -10,
      fireAt: 1,
      nextEvalAt: null,
      osNotificationId: null,
      state: 'active',
      fireCount: 0,
      lastFiredAt: null,
      userEdited: true,
      createdAt: 0,
      updatedAt: 0,
    };
    const old: Trigger = { ...locked, id: 'old', userEdited: false, type: 'semantic', payload: { keywords: ['x'] } };
    const out = ingest(giftResult, ctx({ anchors: [bozic], existingTriggers: [locked, old] }));
    expect(out.drafts.some((d) => d.type === 'anchor')).toBe(false);
    expect(out.removeTriggerIds).toEqual(['old']);
  });

  it('caps low-certainty triggers at 2 and questions at 2, drops lead-time questions', () => {
    const r: EnrichResult = {
      summary: 'x',
      language: 'hr',
      intent: 'fact',
      confidence: 0.5,
      triggers: [1, 2, 3, 4].map((i) => ({ type: 'time' as const, certainty: 'low' as const, label: `t${i}`, iso_datetime: `2026-09-0${i}T10:00:00` })),
      questions: [
        { id: 'q1', text: 'Koliko dana prije?', kind: 'options', options: ['7', '14'] },
        { id: 'q2', text: 'Koja trgovina?', kind: 'options', options: ['A', 'B'] },
        { id: 'q3', text: 'Kome?', kind: 'options', options: ['A', 'B'] },
        { id: 'q4', text: 'Zašto?', kind: 'options', options: ['A', 'B'] },
      ],
    };
    const out = ingest(r, ctx());
    expect(out.drafts.filter((d) => d.type === 'time')).toHaveLength(2);
    // 'q3' ("Kome?") is a WHO question — never asked since 2026-08-28, so the cap keeps q2 and q4.
    expect(out.questions.map((q) => q.id)).toEqual(['q2', 'q4']);
  });

  it('past one-off date moves to next year; always has a semantic trigger', () => {
    const r: EnrichResult = {
      summary: 'Godišnji pregled auta',
      language: 'hr',
      intent: 'task',
      confidence: 0.7,
      entities: { keywords: ['auto', 'pregled'] },
      triggers: [{ type: 'time', certainty: 'high', label: 'pregled', iso_datetime: '2026-05-10T09:00:00' }],
      questions: [],
    };
    const out = ingest(r, ctx());
    const t = out.drafts.find((d) => d.type === 'time')!;
    expect(new Date(t.fireAt!).getFullYear()).toBe(2027);
    expect(out.drafts.some((d) => d.type === 'semantic')).toBe(true);
    expect(out.status).toBe('enriched');
  });

  it('future_need without a date gets a quiet ~6 month fallback', () => {
    const r: EnrichResult = {
      summary: 'Ivan preporučio Auto X za servis',
      language: 'hr',
      category: 'auto_servis',
      intent: 'future_need',
      confidence: 0.8,
      entities: { people: ['Ivan'], orgs: ['Auto X'], keywords: ['servis', 'mehaničar', 'auto'] },
      triggers: [{ type: 'semantic', certainty: 'high', label: 'kad tražiš servis', keywords: ['servis', 'mehaničar', 'auto', 'kvar'] }],
      questions: [],
    };
    const out = ingest(r, ctx());
    const fb = out.drafts.find((d) => d.type === 'time')!;
    expect(fb.certainty).toBeLessThan(0.5);
    const months = (fb.fireAt! - clock.now()) / (30 * 86_400_000);
    expect(months).toBeGreaterThan(5.5);
    expect(months).toBeLessThan(6.5);
    expect(out.status).toBe('enriched');
  });
});

describe('ingest — questions the model asks without giving us anything to bind (Groq style)', () => {
  it('date question with no anchor trigger and no needs_anchor → person from entities, chain created, question carries the person', () => {
    const r: EnrichResult = {
      summary: 'Marta: fotoaparat',
      language: 'hr',
      intent: 'gift',
      confidence: 0.7,
      entities: { people: ['Marta'], keywords: ['fotoaparat', 'poklon'] },
      triggers: [{ type: 'semantic', certainty: 'high', label: 'kad tražiš', keywords: ['fotoaparat', 'poklon'] }],
      questions: [{ id: 'q1', text: 'Kad je Martin rođendan?', kind: 'date' }],
    };
    const out = ingest(r, ctx());
    expect(out.needsAnchor).toEqual({ person: 'Marta', kind: 'birthday' });
    expect(out.drafts.filter((d) => d.type === 'anchor').map((d) => d.offsetDays).sort((a, b) => a! - b!)).toEqual([-21, -7, -1]);
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0]).toMatchObject({ kind: 'date', person: 'Marta', anchorKind: 'birthday' });
    expect(out.status).toBe('needs_input');
  });

  it('date question with nobody to attach it to is dropped (unanswerable)', () => {
    const r: EnrichResult = {
      summary: 'Poklon',
      language: 'hr',
      intent: 'gift',
      confidence: 0.5,
      triggers: [{ type: 'semantic', certainty: 'high', label: 'x', keywords: ['poklon'] }],
      questions: [{ id: 'q1', text: 'Kad je rođendan?', kind: 'date' }],
    };
    const out = ingest(r, ctx());
    expect(out.questions).toEqual([]);
    expect(out.status).toBe('enriched');
  });

  it('"when?" options question is dropped once a real time trigger exists', () => {
    const r: EnrichResult = {
      summary: 'Nazvati automehaničara',
      language: 'hr',
      intent: 'task',
      confidence: 0.8,
      triggers: [
        { type: 'time', certainty: 'high', label: 'kraj sljedećeg tjedna', iso_datetime: '2026-09-04T15:00:00' },
        { type: 'semantic', certainty: 'high', label: 'x', keywords: ['mehaničar'] },
      ],
      questions: [{ id: 'q1', text: 'Kada točno želiš nazvati?', kind: 'options', options: ['Ponedjeljak', 'Petak'] }],
    };
    const out = ingest(r, ctx());
    expect(out.questions).toEqual([]);
    expect(out.status).toBe('enriched');
  });
});

describe('helpers', () => {
  it('the date question never inflects the name', () => {
    expect(anchorQuestion('Ana', 'birthday', 'hr')).toBe('Kad je rođendan?');
    expect(anchorQuestion('Marti', 'birthday', 'hr')).toBe('Kad je rođendan?');
    expect(anchorQuestion('Sarah', 'birthday', 'en')).toBe("When is Sarah's birthday?");
  });
  it('clampSummary to 8 words', () => {
    expect(clampSummary('a b c d e f g h i j').split(' ')).toHaveLength(8);
  });
});
