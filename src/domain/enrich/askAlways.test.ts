// A name is not an identity (Marko, 2026-08-25).
//
// The app used to remember "Marta's birthday" and reuse it for every later note mentioning a Marta. But a name
// is not a person: the Marta in one note need not be the Marta in the next, and silently binding the wrong date
// is worse than asking — a wrong reminder is a lie, a question is a second of work.
//
// So: PERSONAL dates are always asked, never recalled. Only OFFICIAL dates (Christmas, Easter, Valentine's) are
// remembered, because those genuinely are the same day for everyone.

import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import { ingest } from './ingest';
import { heuristicEnrich } from './heuristic';
import { FakeClock } from '../clock';
import type { Anchor, EnrichResult } from '../types';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = local(2026, 8, 25, 14, 32);

/** A birthday the app already stored for someone called Marta. */
const martaBirthday: Anchor = {
  id: 'a-marta',
  label: 'Rođendan · Marta',
  person: 'Marta',
  kind: 'birthday',
  monthDay: '03-01',
  year: null,
  contactId: null,
  source: 'user',
  createdAt: 0,
  updatedAt: 0,
};

const rctx = (anchors: Anchor[] = []) => ({ now: NOW, anchors, uiLang: 'hr' as const });
const ictx = (anchors: Anchor[] = []) => ({ existingTriggers: [], anchors, prefs: {}, clock: new FakeClock(NOW), uiLang: 'hr' as const });

const model = (over: Partial<EnrichResult> = {}): EnrichResult => ({
  summary: 'x',
  language: 'hr',
  intent: 'gift',
  confidence: 0.5,
  triggers: [],
  questions: [],
  ...over,
});

describe('a stored birthday is never reused for the same NAME', () => {
  it('"Marta poklon rođendan" asks again even though a Marta birthday exists', () => {
    const raw = model({ summary: 'Marta: poklon', entities: { people: ['Marta'] } });
    const out = ingest(reconcile(raw, 'Marta poklon rodendan', rctx([martaBirthday])), ictx([martaBirthday]));

    expect(out.status).toBe('needs_input');
    expect(out.needsAnchor).toEqual({ person: 'Marta', kind: 'birthday' });
    const q = out.questions.find((x) => x.kind === 'date');
    expect(q, 'a date question must be asked').toBeTruthy();
  });

  it('the pending reminders are NOT bound to the stored anchor', () => {
    const raw = model({ summary: 'Marta: poklon', entities: { people: ['Marta'] } });
    const out = ingest(reconcile(raw, 'Marta poklon rodendan', rctx([martaBirthday])), ictx([martaBirthday]));
    const anchors = out.drafts.filter((d) => d.type === 'anchor');
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.every((a) => a.anchorId === null), 'nothing may bind to the old Marta').toBe(true);
    expect(anchors.every((a) => a.fireAt === null), 'and nothing may get a date from her').toBe(true);
  });

  it('the offline heuristic behaves identically', () => {
    const raw = heuristicEnrich('Marta poklon rodendan', { now: NOW, anchors: [martaBirthday] });
    expect(raw.needs_anchor).toEqual({ person: 'Marta', kind: 'birthday' });
    const out = ingest(raw, ictx([martaBirthday]));
    expect(out.status).toBe('needs_input');
  });

  it('a relation is no different — "Mami poklon" still asks', () => {
    const mama: Anchor = { ...martaBirthday, id: 'a-mama', person: 'Mama', monthDay: '11-02' };
    const raw = heuristicEnrich('Mami poklon za rodendan', { now: NOW, anchors: [mama] });
    const out = ingest(raw, ictx([mama]));
    expect(out.status).toBe('needs_input');
    expect(out.needsAnchor?.person).toBe('Mama');
  });
});

describe('official dates ARE remembered — those are the same day for everyone', () => {
  it('"Poklon za Valentinovo" needs no question', () => {
    const out = ingest(heuristicEnrich('Poklon za Valentinovo', { now: NOW, anchors: [] }), ictx());
    expect(out.inferredAnchor?.monthDay).toBe('02-14');
    expect(out.questions).toEqual([]);
    expect(out.status).toBe('enriched');
  });

  it('"Za Božić kupiti poklone" needs no question', () => {
    const out = ingest(heuristicEnrich('Za Božić kupiti poklone', { now: NOW, anchors: [] }), ictx());
    expect(out.inferredAnchor?.monthDay).toBe('12-25');
    expect(out.questions.filter((q) => q.kind === 'date')).toEqual([]);
  });

  it('a public holiday is not turned into a personal anchor question', () => {
    const out = ingest(heuristicEnrich('Za Dan žena kupiti cvijeće mami', { now: NOW, anchors: [] }), ictx());
    expect(out.inferredAnchor?.monthDay).toBe('03-08');
    expect(out.needsAnchor).toBeNull();
  });
});

describe('a date written in the note still wins — that is this note, not a memory', () => {
  it('"Marti poklon za rođendan 10.6." asks nothing', () => {
    const raw = heuristicEnrich('Marti poklon za rodendan 10.6.', { now: NOW, anchors: [martaBirthday] });
    const out = ingest(raw, ictx([martaBirthday]));
    expect(out.inferredAnchor?.monthDay).toBe('06-10');
    expect(out.questions.filter((q) => q.kind === 'date')).toEqual([]);
  });
});

// A relation word does not make a note a gift. "Podsjeti me da nazovem kuma sljedeću srijedu" is a task with
// a time; asking "when is Kum's birthday?" there is nonsense — there is no birthday in that sentence at all.
describe('a task about a person is not a gift', () => {
  const task = (text: string) => ingest(heuristicEnrich(text, { now: NOW, anchors: [] }), ictx());

  it('"Podsjeti me da nazovem kuma sljedeću srijedu" → task, no birthday question', () => {
    const out = task('Podsjeti me da nazovem kuma sljedeću srijedu');
    expect(out.intent).toBe('task');
    expect(out.needsAnchor, 'no anchor is needed for a phone call').toBeNull();
    expect(out.questions.filter((q) => q.kind === 'date')).toEqual([]);
    const t = out.drafts.find((d) => d.type === 'time');
    expect(t?.fireAt, 'next Wednesday must be resolved').toBeTruthy();
    expect(new Date(t!.fireAt!).getDay()).toBe(3);
  });

  it('other relations behave the same', () => {
    for (const text of ['Nazvati brata sutra', 'Javiti se sestri u petak', 'Nazvati mamu u 18h']) {
      const out = task(text);
      expect(out.intent, text).toBe('task');
      expect(out.questions.filter((q) => q.kind === 'date'), text).toEqual([]);
    }
  });

  it('but a gift for the same person still asks', () => {
    const out = task('Kupiti kumu poklon za rođendan');
    expect(out.needsAnchor?.person).toBe('Kum');
    expect(out.questions.some((q) => q.kind === 'date')).toBe(true);
  });
});

// The exact sentence Marko dictated on device, through the whole chain (model → reconcile → ingest).
describe('device 2026-08-25: "nazvati kuma u sridu"', () => {
  it('makes a Wednesday reminder, asks nothing, and is a task', () => {
    // The model returns a good title but no time — it is not asked for one any more.
    const raw = model({ summary: 'Nazvati kuma', intent: 'task', category: 'ostalo', entities: { keywords: ['kum', 'poziv'] } });
    const out = ingest(reconcile(raw, 'Nazvati kuma u sridu', rctx()), ictx());

    expect(out.intent).toBe('task');
    expect(out.questions, 'nothing to ask — the day is in the sentence').toEqual([]);
    expect(out.status).toBe('enriched');

    const t = out.drafts.find((d) => d.type === 'time');
    expect(t?.fireAt, 'a reminder must exist').toBeTruthy();
    expect(new Date(t!.fireAt!).getDay(), 'Wednesday').toBe(3);
  });

  it('the same in standard Croatian', () => {
    const raw = model({ summary: 'Nazvati kuma', intent: 'task' });
    const out = ingest(reconcile(raw, 'Nazvati kuma u srijedu', rctx()), ictx());
    const t = out.drafts.find((d) => d.type === 'time');
    expect(new Date(t!.fireAt!).getDay()).toBe(3);
  });
});
