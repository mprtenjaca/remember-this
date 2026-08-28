// Pure mutation reducer. Manual edits, AI chat and enrich ALL go through here so
// reschedule logic can never diverge. Persistence lives in src/db/applyMutations.ts.

import type { Anchor, Mutation, Trigger, TriggerDraft } from './types';

export interface NoteState {
  noteId: string;
  summary: string | null;
  triggers: Trigger[];
  anchors: Anchor[]; // anchors referenced by this note's triggers
}

export interface ReduceResult {
  state: NoteState;
  /** Snapshot needed to undo this mutation (stored in edits.before). */
  before: unknown;
  /** Mutation(s) that revert this one. */
  inverse: Mutation[];
  /** Trigger ids whose fire_at may have changed → OS notification must be re-scheduled. */
  touchedTriggerIds: string[];
  /** Anchor id whose date changed → every trigger bound to it must re-resolve. */
  touchedAnchorId: string | null;
}

export class MutationError extends Error {}

/**
 * Does this label state WHEN the reminder fires, rather than what it is about?
 *
 * "30 dana prije", "za ~6 mjeseci", "tjedan prije" describe timing the app worked out. Once the user moves
 * the date by hand that arithmetic no longer holds, so the label has to go — it sat next to the new date
 * contradicting it. "Kupiti poklon" or "Rođendan" describe the errand and survive any date change.
 */
export function describesTiming(label: string | null | undefined): boolean {
  if (!label) return false;
  return /\b(prije|poslije|nakon|kasnije|ranije|na\s+dan|za\s*~?\s*\d|before|after|later|earlier|on\s+the\s+day|in\s*~?\s*\d)\b/i.test(label);
}

export function targetOf(m: Mutation): string {
  switch (m.op) {
    case 'edit_summary':
      return 'note.summary';
    case 'set_anchor':
      return `anchor:${m.anchorId}`;
    case 'add_trigger':
      return `trigger:${m.trigger.id ?? 'new'}`;
    default:
      return `trigger:${m.triggerId}`;
  }
}

function findTrigger(state: NoteState, id: string): Trigger {
  const t = state.triggers.find((x) => x.id === id);
  if (!t) throw new MutationError(`trigger ${id} not found`);
  return t;
}

function replaceTrigger(state: NoteState, next: Trigger): NoteState {
  return { ...state, triggers: state.triggers.map((t) => (t.id === next.id ? next : t)) };
}

export function draftToTrigger(d: TriggerDraft & { id?: string }, noteId: string, id: string, now: number): Trigger {
  return {
    id,
    noteId,
    type: d.type,
    payload: d.payload,
    label: d.label ?? null,
    certainty: d.certainty,
    anchorId: d.anchorId ?? null,
    offsetDays: d.offsetDays ?? null,
    fireAt: d.fireAt ?? null,
    nextEvalAt: d.nextEvalAt ?? null,
    osNotificationId: null,
    state: 'active',
    fireCount: 0,
    lastFiredAt: null,
    userEdited: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function triggerToDraft(t: Trigger): TriggerDraft & { id: string } {
  return {
    id: t.id,
    type: t.type,
    payload: t.payload,
    label: t.label,
    certainty: t.certainty,
    anchorId: t.anchorId,
    offsetDays: t.offsetDays,
    fireAt: t.fireAt,
    nextEvalAt: t.nextEvalAt,
  };
}

/**
 * Apply one mutation. `newId` is injected so the reducer stays pure.
 * fire_at for anchor triggers is NOT recomputed here — the caller resolves it
 * (needs the clock + anchor) and we only flag touched ids.
 */
export function reduce(state: NoteState, m: Mutation, now: number, newId: () => string): ReduceResult {
  switch (m.op) {
    case 'set_time': {
      const t = findTrigger(state, m.triggerId);
      const parsed = Date.parse(m.iso);
      if (Number.isNaN(parsed)) throw new MutationError(`bad iso ${m.iso}`);
      const before = { fireAt: t.fireAt, payload: t.payload, type: t.type, anchorId: t.anchorId, offsetDays: t.offsetDays, label: t.label };
      const next: Trigger = {
        ...t,
        type: 'time',
        payload: { iso: m.iso },
        anchorId: null,
        offsetDays: null,
        fireAt: parsed,
        // A label that describes the old arithmetic ("30 dana prije", "za ~6 mjeseci") becomes a lie the
        // moment the date is set by hand — and it stayed on screen, contradicting the date beside it.
        // Dropping it lets the row fall back to the date, which is always true.
        label: describesTiming(t.label) ? null : t.label,
        updatedAt: now,
      };
      // The short inverse only restores the time, so it is valid only when nothing else changed. Dropping a
      // stale timing label is "something else" — without this, undo silently kept the label deleted.
      const inverse: Mutation[] = t.type === 'time' && t.fireAt != null && next.label === t.label
        ? [{ op: 'set_time', triggerId: t.id, iso: (t.payload as { iso: string }).iso }]
        : [{ op: 'remove_trigger', triggerId: t.id }, { op: 'add_trigger', trigger: triggerToDraft(t) }];
      return { state: replaceTrigger(state, next), before, inverse, touchedTriggerIds: [t.id], touchedAnchorId: null };
    }

    case 'shift_offset': {
      const t = findTrigger(state, m.triggerId);
      const before = { offsetDays: t.offsetDays, fireAt: t.fireAt, label: t.label };
      let next: Trigger;
      if (t.type === 'anchor' && t.offsetDays != null) {
        // Dropped rather than restated: rebuilding "23 dana prije" would need the UI language down here, and
        // the domain has no locale. TriggerRow already falls back to the anchor name plus the real date.
        next = { ...t, offsetDays: t.offsetDays + m.days, label: describesTiming(t.label) ? null : t.label, updatedAt: now };
      } else if (t.fireAt != null) {
        const fireAt = t.fireAt + m.days * 86_400_000;
        const iso = t.type === 'time' ? new Date(fireAt).toISOString() : undefined;
        // Same reason as set_time: a timing label no longer describes the new date.
        next = {
          ...t,
          fireAt,
          payload: iso ? { ...(t.payload as object), iso } : t.payload,
          label: describesTiming(t.label) ? null : t.label,
          updatedAt: now,
        };
      } else {
        throw new MutationError(`trigger ${t.id} has no time to shift`);
      }
      return {
        state: replaceTrigger(state, next),
        before,
        // Shifting back restores the date but not a label this drop removed, so that case needs the full
        // restore instead (undo has to return EXACTLY the previous state).
        inverse:
          next.label === t.label
            ? [{ op: 'shift_offset', triggerId: t.id, days: -m.days }]
            : [{ op: 'remove_trigger', triggerId: t.id }, { op: 'add_trigger', trigger: triggerToDraft(t) }],
        touchedTriggerIds: [t.id],
        touchedAnchorId: null,
      };
    }

    case 'add_trigger': {
      const id = m.trigger.id ?? newId();
      if (state.triggers.some((t) => t.id === id)) throw new MutationError(`trigger ${id} exists`);
      const t = draftToTrigger(m.trigger, state.noteId, id, now);
      return {
        state: { ...state, triggers: [...state.triggers, t] },
        before: null,
        inverse: [{ op: 'remove_trigger', triggerId: id }],
        touchedTriggerIds: [id],
        touchedAnchorId: null,
      };
    }

    case 'remove_trigger': {
      const t = findTrigger(state, m.triggerId);
      return {
        state: { ...state, triggers: state.triggers.filter((x) => x.id !== t.id) },
        before: t,
        inverse: [{ op: 'add_trigger', trigger: triggerToDraft(t) }],
        touchedTriggerIds: [t.id],
        touchedAnchorId: null,
      };
    }

    case 'set_state': {
      const t = findTrigger(state, m.triggerId);
      const next: Trigger = { ...t, state: m.state, updatedAt: now };
      return {
        state: replaceTrigger(state, next),
        before: { state: t.state },
        inverse: [{ op: 'set_state', triggerId: t.id, state: t.state }],
        touchedTriggerIds: [t.id],
        touchedAnchorId: null,
      };
    }

    case 'set_anchor': {
      const a = state.anchors.find((x) => x.id === m.anchorId);
      if (!a) throw new MutationError(`anchor ${m.anchorId} not found`);
      const next: Anchor = {
        ...a,
        monthDay: m.monthDay ?? a.monthDay,
        year: m.year ?? a.year,
        updatedAt: now,
      };
      const inverse: Mutation = { op: 'set_anchor', anchorId: a.id };
      if (a.monthDay != null) inverse.monthDay = a.monthDay;
      if (a.year != null) inverse.year = a.year;
      return {
        state: { ...state, anchors: state.anchors.map((x) => (x.id === a.id ? next : x)) },
        before: { monthDay: a.monthDay, year: a.year },
        inverse: [inverse],
        touchedTriggerIds: state.triggers.filter((t) => t.anchorId === a.id).map((t) => t.id),
        touchedAnchorId: a.id,
      };
    }

    case 'edit_summary': {
      return {
        state: { ...state, summary: m.text },
        before: { summary: state.summary },
        inverse: [{ op: 'edit_summary', text: state.summary ?? '' }],
        touchedTriggerIds: [],
        touchedAnchorId: null,
      };
    }

    case 'set_keywords': {
      const t = findTrigger(state, m.triggerId);
      if (t.type !== 'semantic') throw new MutationError(`trigger ${t.id} is not semantic`);
      const prev = (t.payload as { keywords: string[] }).keywords;
      const next: Trigger = { ...t, payload: { keywords: m.keywords }, updatedAt: now };
      return {
        state: replaceTrigger(state, next),
        before: { keywords: prev },
        inverse: [{ op: 'set_keywords', triggerId: t.id, keywords: prev }],
        touchedTriggerIds: [],
        touchedAnchorId: null,
      };
    }
  }
}

/** Apply a list in order, collecting undo info. Throws on the first invalid mutation. */
export function reduceAll(state: NoteState, muts: Mutation[], now: number, newId: () => string) {
  const results: ReduceResult[] = [];
  let s = state;
  for (const m of muts) {
    const r = reduce(s, m, now, newId);
    results.push(r);
    s = r.state;
  }
  // Inverse of a sequence = inverses in reverse order.
  const inverse = results
    .slice()
    .reverse()
    .flatMap((r) => r.inverse);
  return { state: s, results, inverse };
}

/** Human-readable diff line per mutation (for AI-edit preview and Undo snackbar). */
export function describeMutation(m: Mutation, lang: 'hr' | 'en' = 'hr'): string {
  const hr = lang === 'hr';
  switch (m.op) {
    case 'set_time':
      return hr ? `Vrijeme → ${m.iso}` : `Time → ${m.iso}`;
    case 'shift_offset':
      return hr
        ? `${m.days < 0 ? 'Ranije' : 'Kasnije'} ${Math.abs(m.days)} d`
        : `${m.days < 0 ? 'Earlier' : 'Later'} ${Math.abs(m.days)} d`;
    case 'add_trigger':
      return hr ? `+ podsjetnik ${m.trigger.label ?? ''}`.trim() : `+ reminder ${m.trigger.label ?? ''}`.trim();
    case 'remove_trigger':
      return hr ? '− podsjetnik' : '− reminder';
    case 'set_state':
      return hr ? `Stanje → ${m.state}` : `State → ${m.state}`;
    case 'set_anchor':
      return hr ? `Datum → ${m.monthDay ?? ''} ${m.year ?? ''}`.trim() : `Date → ${m.monthDay ?? ''} ${m.year ?? ''}`.trim();
    case 'edit_summary':
      return hr ? `Sažetak → "${m.text}"` : `Summary → "${m.text}"`;
    case 'set_keywords':
      return hr ? `Ključne riječi → ${m.keywords.join(', ')}` : `Keywords → ${m.keywords.join(', ')}`;
  }
}
