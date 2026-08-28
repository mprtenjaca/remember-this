// "God" — the Dalmatian word for the anniversary of someone's death.
//
// "Babi je god" does not mean a birthday, does not mean a year, and above all does not mean a present. Getting
// this wrong is not a small miss: the app would cheerfully suggest buying a gift for a dead grandmother. So it
// gets its own anchor kind, its own quiet chain, and copy that never mentions shopping.

import { describe, it, expect } from 'vitest';
import { heuristicEnrich, extractPeople } from './heuristic';
import { reconcile } from './reconcile';
import { ingest, anchorQuestion } from './ingest';
import { FakeClock } from '../clock';
import type { EnrichResult } from '../types';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = local(2026, 8, 25, 14, 32);
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

const offline = (text: string) => ingest(heuristicEnrich(text, hctx), ictx());
const full = (text: string, raw = model()) => ingest(reconcile(raw, text, rctx()), ictx());

describe('"god" is the anniversary of a death, not a birthday', () => {
  it('"Babi je god" asks for the date, as a memorial', () => {
    const out = offline('Babi je god');
    expect(out.needsAnchor).toEqual({ person: 'Baka', kind: 'memorial' });
    expect(out.questions.some((q) => q.kind === 'date')).toBe(true);
  });

  it('the question never says "rođendan"', () => {
    const out = offline('Babi je god');
    const q = out.questions.find((x) => x.kind === 'date')!;
    expect(q.text).not.toMatch(/rođendan/i);
    expect(q.text).toMatch(/god/i);
  });

  it('it is never classified as a gift', () => {
    const out = offline('Babi je god');
    expect(out.intent).not.toBe('gift');
  });

  it('a stated date needs no question', () => {
    const out = offline('Didi je god 12.5.');
    expect(out.inferredAnchor).toEqual({ person: 'Djed', kind: 'memorial', monthDay: '05-12' });
    expect(out.questions.filter((q) => q.kind === 'date')).toEqual([]);
  });

  it('works through the full chain, whatever the model said', () => {
    const out = full('Babi je god', model({ intent: 'gift', summary: 'Poklon za baku' }));
    expect(out.intent).not.toBe('gift');
    expect(out.needsAnchor?.kind).toBe('memorial');
  });

  it('the reminder chain is short and quiet — no three-week shopping run-up', () => {
    const out = offline('Didi je god 12.5.');
    const offsets = out.drafts.filter((d) => d.type === 'anchor').map((d) => d.offsetDays);
    expect(offsets).not.toContain(-21);
    expect(offsets.every((o) => o! >= -7)).toBe(true);
  });

  it('other phrasings of the same thing', () => {
    for (const text of ['God je materi u svibnju', 'Godišnjica smrti od dide', 'Obljetnica smrti bake']) {
      const out = offline(text);
      expect(out.intent, text).not.toBe('gift');
    }
  });
});

describe('"god" does not swallow ordinary words', () => {
  it('"godina" is still a year, not a memorial', () => {
    const out = offline('Za godinu dana produžiti ugovor');
    expect(out.needsAnchor).toBeNull();
    const t = out.drafts.find((d) => d.type === 'time');
    expect(new Date(t!.fireAt!).getFullYear()).toBe(2027);
  });

  it('"godišnjica braka" is still the marriage, not a death', () => {
    const out = offline('Godišnjica braka je 14.9.');
    expect(out.inferredAnchor?.person).toBe('Brak');
    expect(out.inferredAnchor?.kind).toBe('anniversary');
  });

  it('a birthday is still a birthday', () => {
    const out = offline('Babi je rođendan');
    expect(out.needsAnchor).toEqual({ person: 'Baka', kind: 'birthday' });
  });

  it('"Dobar god" style false positives do not create an anchor', () => {
    // "god" as part of another word must not trigger it
    expect(offline('Naručiti godišnji pregled auta').needsAnchor).toBeNull();
    expect(offline('Ove godine idemo na more').needsAnchor).toBeNull();
  });
});

describe('memorial copy', () => {
  it('the question is worded for a memorial in both languages', () => {
    expect(anchorQuestion('Baka', 'memorial', 'hr')).toMatch(/god/i);
    expect(anchorQuestion('Baka', 'memorial', 'en')).toMatch(/memorial|anniversary/i);
  });

  it('the person still comes through', () => {
    expect(extractPeople('Babi je god')).toContain('Baka');
  });
});
