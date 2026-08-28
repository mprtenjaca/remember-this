// Regression tests for the issues Marko hit on the device on 2026-08-25.
// Each one is a rule, not a fixture: the class of input is what must stay fixed.

import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import { ingest } from './ingest';
import { heuristicEnrich } from './heuristic';
import { normalizeEnrichResult } from './normalize';
import { FakeClock } from '../clock';
import type { Anchor, EnrichResult } from '../types';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = local(2026, 8, 25, 14, 32); // Tuesday
const rctx = (anchors: Anchor[] = []) => ({ now: NOW, anchors });
const ictx = (anchors: Anchor[] = []) => ({ existingTriggers: [], anchors, prefs: {}, clock: new FakeClock(NOW) });

const bare = (over: Partial<EnrichResult> = {}): EnrichResult => ({
  summary: 'x',
  language: 'hr',
  intent: 'fact',
  confidence: 0.5,
  triggers: [],
  questions: [],
  ...over,
});

// #3 A bare "godisnjica" (no "braka", no spouse, no date) must ASK for the date
//    and must NOT invent a ~6-month fallback time.
describe('#3 bare godisnjica always asks for the date', () => {
  const TEXT = 'Godišnjica, trebam rezervirati restoran';

  it('reconcile places an anniversary anchor and drops the invented time', () => {
    const raw = bare({
      summary: 'Rezervirati restoran za godišnjicu',
      intent: 'task',
      category: 'restoran',
      triggers: [{ type: 'time', certainty: 'low', label: 'za ~6 mjeseci', iso_datetime: '2027-02-25T19:00:00' }],
    });
    const rec = reconcile(raw, TEXT, rctx());
    const anchor = rec.triggers.find((t) => t.type === 'anchor');
    expect(anchor, 'an anniversary anchor must exist').toBeTruthy();
    expect(anchor!.anchor_kind).toBe('anniversary');
    expect(rec.triggers.some((t) => t.type === 'time')).toBe(false);
  });

  it('ingest asks exactly one date question and adds no quiet 6-month fallback', () => {
    const raw = bare({ summary: 'Rezervirati restoran za godišnjicu', intent: 'task', category: 'restoran' });
    const out = ingest(reconcile(raw, TEXT, rctx()), ictx());
    expect(out.status).toBe('needs_input');
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0]!.kind).toBe('date');
    expect(out.questions[0]!.text).toBe('Kad je godišnjica braka?');
    expect(out.questions[0]!.person).toBe('Brak');
    expect(out.drafts.filter((d) => d.type === 'time')).toHaveLength(0);
  });

  it('the heuristic alone reaches the same answer (offline path)', () => {
    const out = ingest(heuristicEnrich(TEXT, { now: NOW, anchors: [] }), ictx());
    expect(out.questions.map((q) => q.text)).toEqual(['Kad je godišnjica braka?']);
    expect(out.drafts.filter((d) => d.type === 'time')).toHaveLength(0);
  });

  it('an anniversary WITH a date in the text still asks nothing', () => {
    const raw = bare({ summary: 'Godišnjica 14.9.', intent: 'task' });
    const out = ingest(reconcile(raw, 'Godišnjica 14.9., rezervirati restoran', rctx()), ictx());
    expect(out.questions).toEqual([]);
    expect(out.inferredAnchor).toEqual({ person: 'Brak', kind: 'anniversary', monthDay: '09-14' });
  });
});

// #2 Every surviving date question must carry a person, so the picker can bind the answer.
describe('#2 a date question always carries the person it binds to', () => {
  it('a bare date question with nobody to bind to is dropped, never left unbindable', () => {
    const raw = bare({ summary: 'Nešto', questions: [{ id: 'q1', text: 'Koji datum?', kind: 'date' }] });
    const out = ingest(raw, ictx());
    for (const q of out.questions) if (q.kind === 'date') expect(q.person, `question "${q.text}" has nobody to bind to`).toBeTruthy();
  });

  it('a date question on an occasion note carries person + anchorKind', () => {
    const raw = bare({
      summary: 'Godišnjica restoran',
      intent: 'task',
      questions: [{ id: 'q1', text: 'Kad je godišnjica?', kind: 'date' }],
    });
    const out = ingest(reconcile(raw, 'Godišnjica, rezervirati restoran', rctx()), ictx());
    const dateQs = out.questions.filter((q) => q.kind === 'date');
    expect(dateQs).toHaveLength(1);
    expect(dateQs[0]!.person).toBe('Brak');
    expect(dateQs[0]!.anchorKind).toBe('anniversary');
  });
});

// #4 A hallucinated category must never reach the UI ("future_need_mechanic").
describe('#4 category is clamped so intent names never leak into the UI', () => {
  it('normalize drops an invented category like future_need_mechanic', () => {
    const n = normalizeEnrichResult({
      summary: 'Mehaničar u Zadru',
      language: 'hr',
      intent: 'future_need',
      category: 'future_need_mechanic',
      confidence: 0.6,
      triggers: [],
      questions: [],
    });
    expect(n).toBeTruthy();
    expect(n!.category).not.toBe('future_need_mechanic');
  });

  it('a category that is just an intent name is not a category', () => {
    for (const bad of ['future_need', 'task', 'gift', 'fact', 'idea', 'contact']) {
      const n = normalizeEnrichResult({ summary: 's', language: 'hr', intent: 'fact', category: bad, confidence: 0.5, triggers: [], questions: [] });
      expect(n!.category, `"${bad}" is an intent, not a category`).toBeNull();
    }
  });

  it('known categories survive untouched', () => {
    for (const ok of ['auto_servis', 'zdravlje', 'dom', 'poklon', 'restoran', 'putovanje', 'posao', 'financije', 'preporuka', 'ostalo']) {
      const n = normalizeEnrichResult({ summary: 's', language: 'hr', intent: 'fact', category: ok, confidence: 0.5, triggers: [], questions: [] });
      expect(n!.category).toBe(ok);
    }
  });

  it('an unknown but harmless category word is kept', () => {
    const n = normalizeEnrichResult({ summary: 's', language: 'hr', intent: 'fact', category: 'glazba', confidence: 0.5, triggers: [], questions: [] });
    expect(n!.category).toBe('glazba');
  });
});

// #5 Croatian text must get Croatian labels even when the model claims language 'en'.
describe('#5 labels follow the text, not the language the model claimed', () => {
  it('reconcile overrides a wrong language claim on obviously Croatian text', () => {
    const raw = bare({ summary: 'Nazvati Peru', language: 'en', intent: 'task' });
    const rec = reconcile(raw, 'Sljedeći tjedan nazvati Peru zbog grijanja', rctx());
    expect(rec.language).toBe('hr');
  });

  it('default-chain labels are Croatian for Croatian text the model called English', () => {
    const raw = bare({ summary: 'Poklon za Anu', language: 'en', intent: 'gift', entities: { people: ['Ana'] } });
    const out = ingest(reconcile(raw, 'Ana želi Dyson fen za rođendan', rctx()), ictx());
    expect(out.language).toBe('hr');
    const labels = out.drafts.filter((d) => d.type === 'anchor').map((d) => d.label);
    expect(labels.some((l) => /week|before/i.test(l ?? '')), `English labels leaked: ${labels.join(', ')}`).toBe(false);
    expect(labels.some((l) => /prije/.test(l ?? ''))).toBe(true);
  });

  it('a relative-time label is Croatian for Croatian text', () => {
    const out = ingest(reconcile(bare({ summary: 'x', language: 'en', intent: 'task' }), 'Sljedeći tjedan platiti komunalije', rctx()), ictx());
    const time = out.drafts.find((d) => d.type === 'time');
    expect(time).toBeTruthy();
    expect(time!.label).not.toMatch(/next week/i);
  });

  it('genuinely English text keeps English labels and an English question', () => {
    const raw = bare({ summary: 'Gift for Sarah', language: 'en', intent: 'gift', entities: { people: ['Sarah'] } });
    const out = ingest(reconcile(raw, 'Sarah wants a Kindle for her birthday', rctx()), ictx());
    expect(out.language).toBe('en');
    expect(out.questions[0]!.text).toBe("When is Sarah's birthday?");
    const labels = out.drafts.filter((d) => d.type === 'anchor').map((d) => d.label);
    expect(labels.some((l) => /prije/.test(l ?? ''))).toBe(false);
  });
});
