import { describe, it, expect } from 'vitest';
import { reduce, reduceAll, targetOf, type NoteState } from './mutations';
import type { Anchor, Trigger } from './types';

let counter = 0;
const newId = () => `id_${++counter}`;
const NOW = 1_000_000;

const trig = (over: Partial<Trigger>): Trigger => ({
  id: 't1',
  noteId: 'n1',
  type: 'anchor',
  payload: { hour: 19, minute: 0 },
  label: '3 tjedna prije',
  certainty: 0.9,
  anchorId: 'a1',
  offsetDays: -21,
  fireAt: 5000,
  nextEvalAt: null,
  osNotificationId: 'os_1',
  state: 'active',
  fireCount: 0,
  lastFiredAt: null,
  userEdited: false,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const anchor: Anchor = {
  id: 'a1',
  label: 'Anin rođendan',
  person: 'Ana',
  kind: 'birthday',
  monthDay: '03-14',
  year: null,
  contactId: null,
  source: 'user',
  createdAt: 0,
  updatedAt: 0,
};

const base = (): NoteState => ({
  noteId: 'n1',
  summary: 'Ana želi Dyson fen',
  triggers: [trig({}), trig({ id: 't2', offsetDays: -7, label: 'tjedan prije' }), trig({ id: 's1', type: 'semantic', payload: { keywords: ['poklon', 'fen'] }, anchorId: null, offsetDays: null, fireAt: null })],
  anchors: [anchor],
});

describe('reduce', () => {
  it('shift_offset on anchor trigger changes offsetDays and inverse restores', () => {
    const r = reduce(base(), { op: 'shift_offset', triggerId: 't1', days: -7 }, NOW, newId);
    expect(r.state.triggers[0]!.offsetDays).toBe(-28);
    expect(r.touchedTriggerIds).toEqual(['t1']);
    // The inverse can be two steps (remove + re-add) when the shift also dropped a stale timing label, so
    // apply all of them rather than just the first.
    let back = r.state;
    for (const inv of r.inverse) back = reduce(back, inv, NOW, newId).state;
    // By id, not by position: a remove+re-add inverse puts the trigger back at the end of the list.
    const restored = back.triggers.find((x) => x.id === 't1')!;
    expect(restored.offsetDays).toBe(-21);
    expect(restored.label).toBe('3 tjedna prije');
  });

  it('set_time converts an anchor trigger into an absolute one; inverse re-adds original', () => {
    const r = reduce(base(), { op: 'set_time', triggerId: 't1', iso: '2026-02-20T09:00:00' }, NOW, newId);
    const t = r.state.triggers[0]!;
    expect(t.type).toBe('time');
    expect(t.anchorId).toBeNull();
    expect(t.fireAt).toBe(Date.parse('2026-02-20T09:00:00'));
    expect(r.inverse.map((m) => m.op)).toEqual(['remove_trigger', 'add_trigger']);
    const undone = reduceAll(r.state, r.inverse, NOW, newId).state;
    const restored = undone.triggers.find((x) => x.id === 't1')!;
    expect(restored.type).toBe('anchor');
    expect(restored.offsetDays).toBe(-21);
  });

  it('remove_trigger → inverse add_trigger keeps the same id', () => {
    const r = reduce(base(), { op: 'remove_trigger', triggerId: 't2' }, NOW, newId);
    expect(r.state.triggers.map((t) => t.id)).toEqual(['t1', 's1']);
    const back = reduce(r.state, r.inverse[0]!, NOW, newId);
    expect(back.state.triggers.map((t) => t.id).sort()).toEqual(['s1', 't1', 't2']);
  });

  it('add_trigger without id generates one', () => {
    const r = reduce(
      base(),
      { op: 'add_trigger', trigger: { type: 'time', payload: { iso: '2026-09-01T10:00:00' }, label: null, certainty: 1, fireAt: 1 } },
      NOW,
      newId,
    );
    expect(r.state.triggers).toHaveLength(4);
    expect(r.state.triggers[3]!.id).toMatch(/^id_/);
    expect(r.state.triggers[3]!.userEdited).toBe(false);
  });

  it('set_anchor touches every trigger bound to the anchor', () => {
    const r = reduce(base(), { op: 'set_anchor', anchorId: 'a1', monthDay: '04-01' }, NOW, newId);
    expect(r.state.anchors[0]!.monthDay).toBe('04-01');
    expect(r.touchedTriggerIds.sort()).toEqual(['t1', 't2']);
    expect(r.touchedAnchorId).toBe('a1');
    expect(r.inverse[0]).toEqual({ op: 'set_anchor', anchorId: 'a1', monthDay: '03-14' });
  });

  it('edit_summary and inverse', () => {
    const r = reduce(base(), { op: 'edit_summary', text: 'Ana: Dyson fen' }, NOW, newId);
    expect(r.state.summary).toBe('Ana: Dyson fen');
    expect(r.inverse[0]).toEqual({ op: 'edit_summary', text: 'Ana želi Dyson fen' });
  });

  it('set_keywords only on semantic triggers', () => {
    const r = reduce(base(), { op: 'set_keywords', triggerId: 's1', keywords: ['a'] }, NOW, newId);
    expect(r.state.triggers[2]!.payload).toEqual({ keywords: ['a'] });
    expect(() => reduce(base(), { op: 'set_keywords', triggerId: 't1', keywords: [] }, NOW, newId)).toThrow();
  });

  it('unknown trigger throws', () => {
    expect(() => reduce(base(), { op: 'set_state', triggerId: 'nope', state: 'done' }, NOW, newId)).toThrow(/not found/);
  });
});

describe('reduceAll', () => {
  it('undo of a sequence returns exactly the previous state', () => {
    const start = base();
    const fwd = reduceAll(
      start,
      [
        { op: 'shift_offset', triggerId: 't1', days: -7 },
        { op: 'shift_offset', triggerId: 't2', days: -7 },
        { op: 'remove_trigger', triggerId: 's1' },
        { op: 'edit_summary', text: 'x' },
      ],
      NOW,
      newId,
    );
    const back = reduceAll(fwd.state, fwd.inverse, NOW, newId).state;
    const norm = (s: NoteState) => ({
      summary: s.summary,
      triggers: s.triggers
        .map(({ updatedAt: _u, createdAt: _c, osNotificationId: _o, ...t }) => t)
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
    expect(norm(back)).toEqual(norm(start));
  });
});

describe('targetOf', () => {
  it('names the audit target', () => {
    expect(targetOf({ op: 'edit_summary', text: '' })).toBe('note.summary');
    expect(targetOf({ op: 'set_anchor', anchorId: 'a' })).toBe('anchor:a');
    expect(targetOf({ op: 'remove_trigger', triggerId: 't' })).toBe('trigger:t');
  });
});

// A label that states WHEN ("30 dana prije", "za ~6 mjeseci") stops being true the moment the user moves the
// date. It used to stay on screen next to the new date, contradicting it.
describe('a timing label does not survive a date change', () => {
  const state = (over: Partial<Trigger> = {}): NoteState => ({
    noteId: 'n1',
    summary: 's',
    triggers: [trig(over)],
    anchors: [] as Anchor[],
  });

  it('drops "30 dana prije" when the date is set by hand', () => {
    const out = reduce(state({ label: '30 dana prije' }), { op: 'set_time', triggerId: 't1', iso: '2026-12-01T10:00:00' }, NOW, newId);
    expect(out.state.triggers[0]!.label).toBeNull();
  });

  it('drops the guessed "za ~6 mjeseci" too', () => {
    const out = reduce(state({ label: 'za ~6 mjeseci' }), { op: 'set_time', triggerId: 't1', iso: '2026-12-01T10:00:00' }, NOW, newId);
    expect(out.state.triggers[0]!.label).toBeNull();
  });

  it('drops it on a shift as well', () => {
    const out = reduce(state({ label: '3 tjedna prije' }), { op: 'shift_offset', triggerId: 't1', days: -7 }, NOW, newId);
    expect(out.state.triggers[0]!.label).toBeNull();
    expect(out.state.triggers[0]!.offsetDays).toBe(-28);
  });

  // What the reminder is ABOUT is still true whatever the date, so it stays.
  it('keeps a label that describes the errand', () => {
    const out = reduce(state({ label: 'Kupiti poklon' }), { op: 'set_time', triggerId: 't1', iso: '2026-12-01T10:00:00' }, NOW, newId);
    expect(out.state.triggers[0]!.label).toBe('Kupiti poklon');
  });

  it('keeps an English errand label and drops an English timing one', () => {
    const keep = reduce(state({ label: 'Buy a gift' }), { op: 'set_time', triggerId: 't1', iso: '2026-12-01T10:00:00' }, NOW, newId);
    expect(keep.state.triggers[0]!.label).toBe('Buy a gift');
    const drop = reduce(state({ label: '2 weeks before' }), { op: 'set_time', triggerId: 't1', iso: '2026-12-01T10:00:00' }, NOW, newId);
    expect(drop.state.triggers[0]!.label).toBeNull();
  });
});
