import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import { ingest } from './ingest';
import { FakeClock } from '../clock';
import type { Anchor, EnrichResult } from '../types';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = local(2026, 8, 25, 14, 32); // Tuesday
const rctx = (anchors: Anchor[] = []) => ({ now: NOW, anchors });
const ictx = (anchors: Anchor[] = []) => ({ existingTriggers: [], anchors, prefs: {}, clock: new FakeClock(NOW) });

const mama: Anchor = { id: 'a1', label: 'Mamin rođendan', person: 'Mama', kind: 'birthday', monthDay: '11-02', year: null, contactId: null, source: 'user', createdAt: 0, updatedAt: 0 };

/** Minimal EnrichResult a weak/confused model might return for a given text. */
const bare = (over: Partial<EnrichResult> = {}): EnrichResult => ({
  summary: 'x',
  language: 'hr',
  intent: 'fact',
  confidence: 0.5,
  triggers: [],
  questions: [],
  ...over,
});

describe('E1 — gift + person + no occasion word + no date → birthday question (the reported bug)', () => {
  it('"Uzeti majci poklon" — model returns almost nothing usable → reconcile still asks the date', () => {
    const raw = bare({ summary: 'Poklon za majku', intent: 'fact' }); // model didn't even see it's a gift
    const rec = reconcile(raw, 'Uzeti majci poklon', rctx());
    expect(rec.intent).toBe('gift');
    expect(rec.entities?.people).toEqual(['Mama']);
    const out = ingest(rec, ictx());
    expect(out.status).toBe('needs_input');
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0]!.text).toMatch(/rođendan/i);
    expect(out.drafts.filter((d) => d.type === 'anchor').map((d) => d.offsetDays).sort((a, b) => a! - b!)).toEqual([-21, -7, -1]);
  });

  it('model DID classify gift and named the person, but forgot the anchor trigger entirely', () => {
    const raw = bare({ summary: 'Poklon za majku', intent: 'gift', entities: { people: ['Mama'] } });
    const rec = reconcile(raw, 'Uzeti majci poklon', rctx());
    const out = ingest(rec, ictx());
    expect(out.status).toBe('needs_input');
    expect(out.questions[0]!.text).toBe('Kad je rođendan — Mama?');
  });
});

// E2 was "a known anchor means zero questions". That rule is gone (Marko, 2026-08-25): a name is not an
// identity, so a personal date stored under "Mama" is never silently reused — asking costs a tap, a wrong
// reminder costs trust. Only official occasions are recalled. See askAlways.test.ts.
describe('E2 — a stored PERSONAL anchor is not reused; the date is asked again', () => {
  it('does not bind to the old anchor and asks for the date', () => {
    const raw = bare({ summary: 'Poklon za majku', intent: 'gift', entities: { people: ['Mama'] } });
    const rec = reconcile(raw, 'Uzeti majci poklon', rctx([mama]));
    const out = ingest(rec, ictx([mama]));
    expect(out.status).toBe('needs_input');
    expect(out.questions.some((q) => q.kind === 'date')).toBe(true);
    const anchors = out.drafts.filter((d) => d.type === 'anchor');
    expect(anchors.every((a) => a.anchorId === null && a.fireAt === null)).toBe(true);
  });
});

describe('E3 — gift + person + date stated in the text → anchor inferred, zero questions', () => {
  it('"Bratu poklon puzle za rodendan 10.6" (no diacritics)', () => {
    const raw = bare({ summary: 'x', intent: 'fact' }); // a weak model again
    const rec = reconcile(raw, 'Bratu poklon puzle za rodendan 10.6', rctx());
    expect(rec.intent).toBe('gift');
    expect(rec.entities?.people).toEqual(['Brat']);
    const anchor = rec.triggers.find((t) => t.type === 'anchor')!;
    expect(anchor.anchor_month_day).toBe('06-10');
    const out = ingest(rec, ictx());
    expect(out.status).toBe('enriched');
    expect(out.questions).toEqual([]);
  });

  it('model found the person and the date but as separate weak signals', () => {
    const raw = bare({
      summary: 'x',
      intent: 'gift',
      entities: { people: ['Brat'] },
      triggers: [{ type: 'anchor', certainty: 'low', label: '', anchor_person: 'Brat', offset_days: -21 }],
    });
    const rec = reconcile(raw, 'Bratu poklon puzle za rodendan 10.6', rctx());
    const anchor = rec.triggers.find((t) => t.type === 'anchor')!;
    expect(anchor.anchor_month_day).toBe('06-10');
    const out = ingest(rec, ictx());
    expect(out.status).toBe('enriched');
  });
});

describe('E4 — gift without any identifiable person → no anchor, no question', () => {
  it('"kupiti poklon" with nobody named stays semantic-only', () => {
    const raw = bare({ summary: 'Kupiti poklon', intent: 'gift' });
    const rec = reconcile(raw, 'kupiti neki poklon', rctx());
    const out = ingest(rec, ictx());
    expect(out.drafts.some((d) => d.type === 'anchor')).toBe(false);
    expect(out.questions).toEqual([]);
  });
});

describe('E5 — lowercase relation resolves to a person even when the model sees nobody', () => {
  it.each([
    ['majci', 'Mama'],
    ['bratu', 'Brat'],
    ['sestri', 'Sestra'],
    ['tati', 'Tata'],
    ['ženi', 'Žena'],
    ['baki', 'Baka'],
  ])('"%s" → %s', (word, person) => {
    const rec = reconcile(bare({ intent: 'gift' }), `Uzeti ${word} poklon`, rctx());
    expect(rec.entities?.people).toContain(person);
  });
});

describe('E6 — relative time in the text always becomes a time trigger, never a question', () => {
  it('model asks "when" while the text says "sljedeći tjedan" → question is dropped, time trigger added', () => {
    const raw = bare({
      summary: 'Nazvati Hep',
      intent: 'task',
      questions: [{ id: 'q1', text: 'Kad želiš nazvati?', kind: 'options', options: ['Ponedjeljak', 'Utorak'] }],
    });
    const rec = reconcile(raw, 'Kraj sljedećeg tjedna me sjeti da nazovem Hep', rctx());
    expect(rec.triggers.some((t) => t.type === 'time')).toBe(true);
    const out = ingest(rec, ictx());
    expect(out.questions).toEqual([]);
    expect(out.status).toBe('enriched');
  });
});

describe('E8 — tradesman/service written as a plain fact is still future_need, never asks anything', () => {
  it('"Mehaničar Dario popravio klimu za 80€" — model said fact', () => {
    const raw = bare({ summary: 'Mehaničar Dario', intent: 'fact', category: 'auto_servis' });
    const rec = reconcile(raw, 'Mehaničar Dario u Sesvetama popravio klimu u autu za 80€, brz i pošten', rctx());
    expect(rec.intent).toBe('future_need');
    const out = ingest(rec, ictx());
    expect(out.status).toBe('enriched');
    expect(out.questions).toEqual([]);
  });

  it('a tradesman recommendation with a phone number is future_need, not contact', () => {
    const raw = bare({ summary: 'Vodoinstalater Mile', intent: 'contact', category: 'dom' });
    const rec = reconcile(raw, 'Vodoinstalater Mile 091 555 1234, došao isti dan i nije derao', rctx());
    expect(rec.intent).toBe('future_need');
  });
});

describe('E9 — places (restaurants/cafés) are fact, not task/future_need, when there is no task verb', () => {
  it('"Restoran Foša u Zadru" mis-tagged as task by the model → corrected to fact', () => {
    const raw = bare({ summary: 'Restoran Foša', intent: 'task', category: 'restoran' });
    const rec = reconcile(raw, 'Restoran Foša u Zadru — odlična riba, rezervirati terasu', rctx());
    expect(rec.intent).toBe('fact');
  });
});

describe('E11 — a date question with no anchor and no person anywhere is unanswerable and gets dropped', () => {
  it('generic "Kad je rođendan?" with nobody named in the note', () => {
    const raw = bare({ summary: 'Poklon', intent: 'gift', questions: [{ id: 'q1', text: 'Kad je rođendan?', kind: 'date' }] });
    const rec = reconcile(raw, 'kupiti neki poklon', rctx());
    const out = ingest(rec, ictx());
    expect(out.questions).toEqual([]);
  });
});

describe('E13 — brands mentioned alongside a person are not mistaken for the person', () => {
  it('"Marta želi fotoaparat, neki Nikon ili Canon" → person is Marta, question still fires', () => {
    const raw = bare({ summary: 'x', intent: 'gift', entities: { people: ['Marta'] } });
    const rec = reconcile(raw, 'Marta želi fotoaparat za rođendan, neki Nikon ili Canon', rctx());
    expect(rec.entities?.people).toEqual(['Marta']);
    const out = ingest(rec, ictx());
    expect(out.questions[0]!.text).toBe('Kad je rođendan — Marta?');
  });
});

describe('E16/E17 — the wedding-anniversary dictation that went wrong on device', () => {
  const text = 'Godišnjica braka je treći petog sljedeće godine i treba rezervirati na vrijeme restoran negdje u Zadru.';
  // What Groq actually produced: spouse guessed as the person, "Zadru" listed as a person, a hallucinated
  // 15.01.2027 time trigger, and a date question — even though the date is right there in the words.
  const groqLike = (): EnrichResult => ({
    summary: 'Godišnjica braka · restoran u Zadru',
    language: 'hr',
    category: 'restoran',
    intent: 'gift',
    confidence: 0.7,
    entities: { people: ['Zadru'], places: ['Zadar'], keywords: ['godišnjica', 'restoran'] },
    needs_anchor: { person: 'Žena', kind: 'anniversary' },
    triggers: [
      { type: 'anchor', certainty: 'high', label: 'Godišnjica braka', anchor_person: 'Žena', anchor_kind: 'anniversary', offset_days: -21 },
      { type: 'time', certainty: 'medium', label: 'rezervacija', iso_datetime: '2027-01-15T10:00:00' },
      { type: 'semantic', certainty: 'high', label: 'kad tražiš', keywords: ['restoran', 'zadar', 'godišnjica'] },
    ],
    questions: [{ id: 'q1', text: 'Kad je Zadruov godišnjica?', kind: 'date' }],
  });

  it('the stated date wins: anchor is the marriage on 03.05., no question, the 15.01. hallucination is gone', () => {
    const rec = reconcile(groqLike(), text, rctx());
    expect(rec.entities?.people).toEqual([]); // Zadru is a place
    const anchors = rec.triggers.filter((t) => t.type === 'anchor');
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.every((a) => a.anchor_person === 'Brak' && a.anchor_month_day === '05-03')).toBe(true);
    expect(rec.triggers.some((t) => t.type === 'time' && t.iso_datetime?.startsWith('2027-01-15'))).toBe(false);

    const out = ingest(rec, ictx());
    expect(out.status).toBe('enriched');
    expect(out.questions).toEqual([]);
    expect(out.inferredAnchor).toEqual({ person: 'Brak', kind: 'anniversary', monthDay: '05-03' });
    expect(out.drafts.filter((d) => d.type === 'anchor').map((d) => d.offsetDays).sort((a, b) => a! - b!)).toEqual([-21, -14, -3]);
  });

  it('without a date in the text the question is "Kad je godišnjica braka?" — not "Zadruov", not "Ženin"', () => {
    const raw = groqLike();
    raw.triggers = raw.triggers.filter((t) => t.type !== 'time');
    const rec = reconcile(raw, 'Za godišnjicu braka rezervirati restoran negdje u Zadru', rctx());
    const out = ingest(rec, ictx());
    expect(out.status).toBe('needs_input');
    expect(out.questions.map((q) => q.text)).toEqual(['Kad je godišnjica braka?']);
    expect(out.questions[0]!.person).toBe('Brak');
  });
});

describe('reconcile never breaks a model that already got it right', () => {
  it('passes through a correct, complete gift result unchanged in substance', () => {
    const raw: EnrichResult = {
      summary: 'Ana: Dyson fen',
      language: 'hr',
      category: 'poklon',
      intent: 'gift',
      confidence: 0.9,
      entities: { people: ['Ana'], keywords: ['poklon', 'fen'] },
      needs_anchor: { person: 'Ana', kind: 'birthday' },
      triggers: [
        { type: 'semantic', certainty: 'high', label: 'kad tražiš', keywords: ['poklon', 'fen', 'dyson'] },
        { type: 'anchor', certainty: 'high', label: '3 tjedna prije', anchor_person: 'Ana', anchor_kind: 'birthday', offset_days: -21 },
      ],
      questions: [{ id: 'q1', text: 'Kad je Anin rođendan?', kind: 'date' }],
    };
    const rec = reconcile(raw, 'Ana želi Dyson fen za rođendan', rctx());
    const out = ingest(rec, ictx());
    expect(out.status).toBe('needs_input');
    expect(out.questions).toHaveLength(1);
  });
});
