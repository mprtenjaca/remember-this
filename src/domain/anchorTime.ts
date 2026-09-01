// A time chosen together with an occasion's date.
//
// Marko, 2026-08-28: "zapravo samo je bitan onaj podsjetnik u tom trenu na taj dan" — the hour belongs to the
// day-of reminder ("na dan"), not to the lead reminders three weeks out. So a chosen time re-times ONLY the
// offset-0 reminder bound to the anchor in this note, creating it when the chain had none. As mutations, so it
// travels in the same undo as the date change it came with.

import type { Anchor, AnchorPayload, Mutation, Trigger } from './types';
import type { Clock } from './clock';
import { offsetLabel, resolveAnchorTrigger } from './triggers/resolve';

/**
 * @param triggers this note's triggers
 * @param anchor   the anchor WITH the date it will have after this batch (fireAt is computed from it)
 * @param at       the chosen hour/minute
 */
export function dayOfTimeMutations(triggers: readonly Trigger[], anchor: Anchor, at: AnchorPayload, clock: Clock, lang: 'hr' | 'en' = 'hr'): Mutation[] {
  const dayOf = triggers.find((t) => t.type === 'anchor' && t.anchorId === anchor.id && t.offsetDays === 0 && t.state === 'active');
  const payload: AnchorPayload = { hour: at.hour, minute: at.minute };
  const fireAt = resolveAnchorTrigger(anchor, 0, payload, clock);
  const add: Mutation = {
    op: 'add_trigger',
    trigger: { type: 'anchor', payload, label: dayOf?.label ?? offsetLabel(0, lang), certainty: dayOf?.certainty ?? 0.8, anchorId: anchor.id, offsetDays: 0, fireAt },
  };
  // Replace rather than mutate in place: add_trigger/remove_trigger carry their own full inverses, so undo puts
  // the old hour back exactly (see describesTiming / set_time for why partial inverses bit us).
  return dayOf ? [{ op: 'remove_trigger', triggerId: dayOf.id }, add] : [add];
}
