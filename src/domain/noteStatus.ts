// When is a note "done"?
//
// A note can carry several reminders — buy the present, wrap it, turn up to the party. Marking one of them off
// is not the same as being finished with the note, so "done" exists at two levels and they have to agree:
//
//   • tick every reminder  → the note is done, automatically. Nobody wants to say it twice.
//   • mark the note done   → the remaining reminders stop firing. Otherwise a "finished" note keeps nagging.
//
// The semantic trigger is not a reminder in this sense: it is what makes the note findable in six months, and
// it must survive being done. That is the whole promise of the app — a finished errand still answers "which
// mechanic did I use?" later.
//
// Pure domain: no DB, no React. The service layer applies these decisions.

import type { Trigger } from './types';

/** Reminders the user can tick off. Semantic triggers are excluded — see the note above. */
export function actionableTriggers(triggers: Trigger[]): Trigger[] {
  return triggers.filter((t) => t.type !== 'semantic');
}

/** True when every actionable reminder has been dealt with (done, dismissed or fired-and-gone). */
export function allRemindersDone(triggers: Trigger[]): boolean {
  const actionable = actionableTriggers(triggers);
  if (actionable.length === 0) return false; // a note with nothing to do is not "done", it is just a note
  return actionable.every((t) => t.state !== 'active');
}

export interface DoneDecision {
  /** Should the note be archived now? */
  archive: boolean;
  /** Reminders to switch off, because the note as a whole is finished. */
  cancelTriggerIds: string[];
}

/**
 * What should happen when a single reminder is ticked off.
 * The note follows only when that was the last one outstanding.
 */
export function afterTriggerDone(triggers: Trigger[], doneId: string): DoneDecision {
  const next = triggers.map((t) => (t.id === doneId ? { ...t, state: 'done' as const } : t));
  return { archive: allRemindersDone(next), cancelTriggerIds: [] };
}

/**
 * What should happen when the whole note is marked done.
 * Every still-active reminder is switched off; the semantic trigger stays so search keeps working.
 */
export function markNoteDone(triggers: Trigger[]): DoneDecision {
  return {
    archive: true,
    cancelTriggerIds: actionableTriggers(triggers)
      .filter((t) => t.state === 'active')
      .map((t) => t.id),
  };
}

/**
 * Reopening a done note. Reminders are NOT resurrected: their dates are in the past by now, and re-firing
 * yesterday's reminder is worse than silence. The note simply becomes active again.
 */
export function reopenNote(): DoneDecision {
  return { archive: false, cancelTriggerIds: [] };
}

/** Progress for the UI: "2 od 3". Returns null when there is nothing tickable. */
export function reminderProgress(triggers: Trigger[]): { done: number; total: number } | null {
  const actionable = actionableTriggers(triggers);
  if (actionable.length === 0) return null;
  return { done: actionable.filter((t) => t.state !== 'active').length, total: actionable.length };
}
