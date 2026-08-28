// "Done" has to mean the same thing at both levels, or the app nags about something you already finished.

import { describe, it, expect } from 'vitest';
import { actionableTriggers, afterTriggerDone, allRemindersDone, markNoteDone, reminderProgress, reopenNote } from './noteStatus';
import type { Trigger, TriggerState, TriggerType } from './types';

let seq = 0;
const trig = (over: Partial<Trigger> = {}): Trigger => ({
  id: `t${++seq}`,
  noteId: 'n1',
  type: 'anchor' as TriggerType,
  payload: { hour: 19, minute: 0 },
  label: null,
  certainty: 0.6,
  anchorId: 'a1',
  offsetDays: -7,
  fireAt: 1,
  nextEvalAt: null,
  osNotificationId: null,
  state: 'active' as TriggerState,
  fireCount: 0,
  lastFiredAt: null,
  userEdited: false,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const semantic = () => trig({ type: 'semantic', payload: { keywords: ['poklon'] }, anchorId: null, offsetDays: null, fireAt: null });

describe('the semantic trigger is not a reminder', () => {
  it('is excluded from what can be ticked off', () => {
    const list = [trig(), semantic()];
    expect(actionableTriggers(list)).toHaveLength(1);
  });

  it('a note whose only trigger is semantic is never "done"', () => {
    // "Konoba Mare ima odličan brudet" has nothing to finish — it is just worth remembering.
    expect(allRemindersDone([semantic()])).toBe(false);
    expect(reminderProgress([semantic()])).toBeNull();
  });

  it('survives the note being marked done, so search keeps working', () => {
    const sem = semantic();
    const decision = markNoteDone([trig(), sem]);
    expect(decision.cancelTriggerIds).not.toContain(sem.id);
  });
});

describe('ticking reminders one by one', () => {
  it('one of three done → the note stays open', () => {
    const list = [trig(), trig(), trig()];
    expect(afterTriggerDone(list, list[0]!.id).archive).toBe(false);
  });

  it('the LAST one done → the note is done too, with no extra tap', () => {
    const a = trig({ state: 'done' });
    const b = trig({ state: 'done' });
    const c = trig();
    expect(afterTriggerDone([a, b, c], c.id).archive).toBe(true);
  });

  it('a fired or dismissed reminder counts as dealt with', () => {
    const a = trig({ state: 'fired' });
    const b = trig({ state: 'dismissed' });
    expect(allRemindersDone([a, b])).toBe(true);
  });
});

describe('marking the whole note done', () => {
  it('switches off every remaining reminder', () => {
    const a = trig();
    const b = trig({ state: 'done' });
    const c = trig();
    const decision = markNoteDone([a, b, c, semantic()]);
    expect(decision.archive).toBe(true);
    expect(decision.cancelTriggerIds.sort()).toEqual([a.id, c.id].sort());
  });

  it('is idempotent — nothing left to cancel the second time', () => {
    const list = [trig({ state: 'done' }), trig({ state: 'done' })];
    expect(markNoteDone(list).cancelTriggerIds).toEqual([]);
  });
});

describe('reopening', () => {
  it('does not resurrect old reminders — their dates are in the past', () => {
    const decision = reopenNote();
    expect(decision.archive).toBe(false);
    expect(decision.cancelTriggerIds).toEqual([]);
  });
});

describe('progress for the UI', () => {
  it('counts only actionable reminders', () => {
    expect(reminderProgress([trig({ state: 'done' }), trig(), semantic()])).toEqual({ done: 1, total: 2 });
  });

  it('is complete when everything is ticked', () => {
    expect(reminderProgress([trig({ state: 'done' })])).toEqual({ done: 1, total: 1 });
  });
});
