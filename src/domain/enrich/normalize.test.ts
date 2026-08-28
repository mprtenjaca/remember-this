import { describe, it, expect } from 'vitest';
import { normalizeEnrichResult } from './normalize';
import { ingest } from './ingest';
import { FakeClock } from '../clock';

describe('normalizeEnrichResult', () => {
  it('fills missing arrays and clamps enums (what Gemini-lite / Groq JSON mode actually return)', () => {
    const r = normalizeEnrichResult({ summary: 'Zubar dr. Kovač', language: 'HR', intent: 'FUTURE_NEED', confidence: '0.9' })!;
    expect(r.triggers).toEqual([]);
    expect(r.questions).toEqual([]);
    expect(r.language).toBe('hr');
    expect(r.intent).toBe('future_need');
    expect(r.confidence).toBe(0.9);
    expect(r.needs_anchor).toBeNull();
    expect(r.entities).toEqual({ people: [], orgs: [], places: [], keywords: [] });
  });

  it('drops junk triggers/questions instead of crashing, keeps valid ones', () => {
    const r = normalizeEnrichResult({
      summary: 'x',
      intent: 'gift',
      triggers: [
        { type: 'anchor', certainty: 'HIGH', label: '3 tjedna prije', anchor_person: 'Ana', anchor_kind: 'birthday', offset_days: '-21' },
        { type: 'teleport' },
        null,
        { type: 'semantic', keywords: ['poklon', 7, ''] },
      ],
      questions: [{ text: 'Kad je Anin rođendan?', kind: 'date' }, { text: 'Koja?', kind: 'options', options: ['a'] }, 'nope'],
    })!;
    expect(r.triggers).toHaveLength(2);
    expect(r.triggers[0]).toMatchObject({ type: 'anchor', certainty: 'high', offset_days: -21 });
    expect(r.triggers[1]).toMatchObject({ type: 'semantic', keywords: ['poklon'] });
    expect(r.questions).toEqual([{ id: 'q1', text: 'Kad je Anin rođendan?', kind: 'date' }]);
  });

  it('returns null for garbage, uses the raw text as a fallback summary', () => {
    expect(normalizeEnrichResult('lol')).toBeNull();
    expect(normalizeEnrichResult({})).toBeNull();
    expect(normalizeEnrichResult({ intent: 'task' }, 'podsjeti me u 15h nazvati Marka')!.summary).toBe('podsjeti me u 15h nazvati Marka');
  });

  it('a result without triggers still ingests (semantic fallback added, no crash)', () => {
    const r = normalizeEnrichResult({ summary: 'Zubar dr. Kovač', intent: 'future_need', category: 'zdravlje', entities: { keywords: ['zubar', 'pregled'] } })!;
    const out = ingest(r, { existingTriggers: [], anchors: [], prefs: {}, clock: new FakeClock(Date.parse('2026-08-25T14:00:00')) });
    expect(out.drafts.map((d) => d.type).sort()).toEqual(['semantic', 'time']);
    // The guessed ~6 months now comes with a one-tap correction offer, so the note waits on an answer. The
    // reminder is scheduled either way — that is what this test is really guarding.
    expect(out.status).toBe('needs_input');
    expect(out.questions.map((q) => q.kind)).toEqual(['interval']);
  });
});
