// reconcile() is the final authority. The model proposes meaning; TIME is ours.
//
// These tests exist because the failure they describe actually shipped: a model returned a confident date
// months away and the app scheduled it. The rule now is absolute — whatever the model says about time is
// discarded and replaced by parseTemporal()'s answer, or by nothing at all.

import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import { ingest } from './ingest';
import { FakeClock } from '../clock';
import type { EnrichResult } from '../types';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = local(2026, 8, 25, 14, 32); // Tuesday
const rctx = () => ({ now: NOW, anchors: [], uiLang: 'hr' as const });
const ictx = () => ({ existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(NOW), uiLang: 'hr' as const });

const model = (over: Partial<EnrichResult> = {}): EnrichResult => ({
  summary: 'x',
  language: 'hr',
  intent: 'task',
  confidence: 0.5,
  triggers: [],
  questions: [],
  ...over,
});

/** The single time draft ingest produced, as 'YYYY-MM-DD HH:mm', or null. */
const timeOf = (raw: EnrichResult, text: string): string | null => {
  const out = ingest(reconcile(raw, text, rctx()), ictx());
  const t = out.drafts.find((d) => d.type === 'time');
  if (!t?.fireAt) return null;
  const d = new Date(t.fireAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

describe('a date invented by the model never survives', () => {
  it('model dates a note with no time at all → no time trigger', () => {
    const raw = model({
      summary: 'Mehaničar Dario',
      intent: 'fact',
      triggers: [{ type: 'time', certainty: 'high', label: 'servis', iso_datetime: '2027-03-15T10:00:00' }],
    });
    // "Mehaničar Dario popravio klimu" carries no time. future_need gets a quiet fallback, but never
    // the model's invented March date.
    const at = timeOf(raw, 'Mehaničar Dario mi je popravio klimu');
    expect(at).not.toBe('2027-03-15 10:00');
  });

  it('model disagrees with the text → the text wins', () => {
    const raw = model({
      summary: 'Nazvati Peru',
      triggers: [{ type: 'time', certainty: 'high', label: 'poziv', iso_datetime: '2026-12-01T08:00:00' }],
    });
    // "sutra u 9" is unambiguous.
    expect(timeOf(raw, 'Sutra u 9 nazvati Peru')).toBe('2026-08-26 09:00');
  });

  it('model omits the time entirely → we still find it', () => {
    const raw = model({ summary: 'Platiti komunalije' });
    expect(timeOf(raw, 'Za 2 tjedna platiti komunalije')).toBe('2026-09-08 09:00');
  });

  it('a deadline in the text beats a model date', () => {
    const raw = model({
      summary: 'Predati dokument',
      triggers: [{ type: 'time', certainty: 'high', label: 'x', iso_datetime: '2026-10-20T09:00:00' }],
    });
    expect(timeOf(raw, 'Moram predati dokument do 15.9.')).toBe('2026-09-15 09:00');
  });
});

describe('conditional notes get no date, whatever the model says', () => {
  const conditionals = [
    'Kad budem opet u Zagrebu otići u knjižaru Fraktura',
    'Ovo mi treba kad budem mijenjao gume',
    'Kad završim s autom pogledati ovo',
  ];
  for (const text of conditionals) {
    it(`"${text}" → no invented time`, () => {
      const raw = model({
        summary: 'x',
        intent: 'idea',
        triggers: [{ type: 'time', certainty: 'medium', label: 'x', iso_datetime: '2026-09-30T09:00:00' }],
      });
      expect(timeOf(raw, text)).not.toBe('2026-09-30 09:00');
    });
  }

  it('the conditional phrase still yields searchable keywords', () => {
    const raw = model({ summary: 'Knjižara Fraktura', intent: 'idea', entities: { keywords: ['knjižara'] } });
    const out = ingest(reconcile(raw, 'Kad budem opet u Zagrebu otići u knjižaru Fraktura', rctx()), ictx());
    const sem = out.drafts.find((d) => d.type === 'semantic');
    expect(sem).toBeTruthy();
    expect((sem!.payload as { keywords: string[] }).keywords.length).toBeGreaterThan(0);
  });
});

describe('recurring notes keep their rhythm', () => {
  it('"svakih 6 mjeseci" produces a recurring time trigger', () => {
    const raw = model({ summary: 'Servis auta', intent: 'future_need', category: 'auto_servis' });
    const out = ingest(reconcile(raw, 'Servis auta svakih 6 mjeseci', rctx()), ictx());
    const t = out.drafts.find((d) => d.type === 'time');
    expect(t).toBeTruthy();
    expect(new Date(t!.fireAt!).getMonth()).toBe(1); // Feb 2027
  });
});

describe('the model still owns meaning', () => {
  it('intent and category from the model are respected when the text does not contradict them', () => {
    const raw = model({ summary: 'Ana: Dyson fen', intent: 'gift', category: 'poklon', entities: { people: ['Ana'] } });
    const out = ingest(reconcile(raw, 'Ana želi Dyson fen za rođendan', rctx()), ictx());
    expect(out.intent).toBe('gift');
    expect(out.category).toBe('poklon');
  });

  it('model keywords survive into the semantic trigger', () => {
    const raw = model({
      summary: 'Mehaničar Dario',
      intent: 'future_need',
      category: 'auto_servis',
      entities: { keywords: ['mehaničar', 'servis auta', 'klima'] },
    });
    const out = ingest(reconcile(raw, 'Mehaničar Dario popravio klimu za 80€', rctx()), ictx());
    const sem = out.drafts.find((d) => d.type === 'semantic');
    const kw = (sem!.payload as { keywords: string[] }).keywords;
    expect(kw).toContain('mehaničar');
    expect(kw).toContain('servis auta');
  });

  it('the anchor person comes from the model, the date never does', () => {
    const raw = model({
      summary: 'Poklon za Anu',
      intent: 'gift',
      entities: { people: ['Ana'] },
      needs_anchor: { person: 'Ana', kind: 'birthday' },
    });
    const out = ingest(reconcile(raw, 'Ana želi Dyson fen za rođendan', rctx()), ictx());
    expect(out.needsAnchor).toEqual({ person: 'Ana', kind: 'birthday' });
    expect(out.drafts.filter((d) => d.type === 'anchor').every((d) => d.fireAt == null)).toBe(true);
  });
});
