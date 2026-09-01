// Moving an occasion onto TODAY by hand.
//
// A birthday dated 30.11 carries the chain (−21/−7/−1/0). When the user corrects the date to today, the three
// lead reminders have nowhere to go but NEXT year — the picker said "today" and the list answered "2027". The
// rule for a same-day occasion is already decided at capture (reconcile E23): exactly two reminders, an hour
// before and at the moment. This applies the same rule to a hand-made date change, as mutations, so one undo
// restores the whole chain.

import type { Mutation, Trigger } from './types';
import { startOfDay, toLocalIso as localIso } from './dates';

export interface SameDayCollapse {
  /** Mutations to apply together with the date change. Empty when the date is not today. */
  mutations: Mutation[];
  /** The moment the reminders now point at, or null when the hour has passed and nothing could be set. */
  moment: number | null;
}

/**
 * Collapse this note's reminders bound to `anchorId` into the same-day pair.
 *
 * - The moment is the chain's own hour (the anchor triggers' payload) today; if that has passed, the next full
 *   hour, never after 21:00 (hard rule 6); if even that is gone, no time reminder at all — nothing invented.
 * - "sat prije" only when it is still ahead.
 * - Every anchor-bound trigger of this note is removed: it would otherwise resolve to next year.
 */
export function collapseAnchorToSameDay(
  triggers: readonly Trigger[],
  anchorId: string,
  newDate: number,
  now: number,
  lang: 'hr' | 'en' = 'hr',
): SameDayCollapse {
  if (startOfDay(newDate) !== startOfDay(now)) return { mutations: [], moment: null };
  const bound = triggers.filter((t) => t.type === 'anchor' && t.anchorId === anchorId && t.state === 'active');
  if (bound.length === 0) return { mutations: [], moment: null };

  const onTheDay = bound.find((t) => t.offsetDays === 0) ?? bound[0]!;
  const at = onTheDay.payload as { hour?: number; minute?: number };
  const d = new Date(now);
  d.setHours(at.hour ?? 9, at.minute ?? 0, 0, 0);
  let moment: number | null = d.getTime();
  if (moment <= now) {
    const n = new Date(now);
    n.setMinutes(0, 0, 0);
    n.setHours(n.getHours() + 1);
    moment = n.getHours() <= 21 ? n.getTime() : null;
  }

  const mutations: Mutation[] = bound.map((t) => ({ op: 'remove_trigger' as const, triggerId: t.id }));
  if (moment != null) {
    const hourBefore = moment - 60 * 60 * 1000;
    if (hourBefore > now) {
      mutations.push({
        op: 'add_trigger',
        trigger: { type: 'time', payload: { iso: localIso(hourBefore) }, label: lang === 'hr' ? 'sat prije' : 'an hour before', certainty: 1, fireAt: hourBefore },
      });
    }
    mutations.push({
      op: 'add_trigger',
      trigger: { type: 'time', payload: { iso: localIso(moment) }, label: lang === 'hr' ? 'u to vrijeme' : 'at the time', certainty: 1, fireAt: moment },
    });
  }
  return { mutations, moment };
}
