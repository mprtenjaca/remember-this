// Persistence around the pure reducer. Manual edits AND AI chat go through here —
// one reschedule path, one audit trail, one undo.

import { db } from './index';
import { triggersRepo } from './repositories/triggers';
import { anchorsRepo } from './repositories/anchors';
import { notesRepo } from './repositories/notes';
import { editsRepo } from './repositories/edits';
import { reduceAll, targetOf, type NoteState } from '@/domain/mutations';
import { clock } from '@/domain/clock';
import { newId } from '@/lib/ids';
import { resolveAnchorTrigger } from '@/domain/triggers/resolve';
import type { EditSource, Mutation, Trigger } from '@/domain/types';
import { scheduler } from '@/services/notifications';
import { refillScheduledWindow } from '@/services/scheduling/refill';
import { notifyChange } from '@/lib/events';

export async function loadNoteState(noteId: string): Promise<NoteState> {
  const d = db();
  const note = await notesRepo.byId(d, noteId);
  if (!note) throw new Error(`note ${noteId} not found`);
  const triggers = await triggersRepo.byNote(d, noteId);
  const anchorIds = Array.from(new Set(triggers.map((t) => t.anchorId).filter((x): x is string => !!x)));
  const anchors = await anchorsRepo.byIds(d, anchorIds);
  return { noteId, summary: note.summary, triggers, anchors };
}

/** Re-resolve fire_at for anchor triggers whose anchor or offset changed. */
function reresolve(t: Trigger, state: NoteState): Trigger {
  if (t.type !== 'anchor' || !t.anchorId || t.offsetDays == null) return t;
  const anchor = state.anchors.find((a) => a.id === t.anchorId);
  if (!anchor) return t;
  const p = t.payload as { hour: number; minute: number };
  return { ...t, fireAt: resolveAnchorTrigger(anchor, t.offsetDays, p, clock) };
}

export interface ApplyResult {
  editId: string;
  inverse: Mutation[];
  touched: number;
}

export async function applyMutations(noteId: string, muts: Mutation[], source: EditSource): Promise<ApplyResult> {
  if (muts.length === 0) return { editId: '', inverse: [], touched: 0 };
  const d = db();
  const now = clock.now();
  const before = await loadNoteState(noteId);
  const { state, results, inverse } = reduceAll(before, muts, now, newId);

  const touchedTriggers = new Set(results.flatMap((r) => r.touchedTriggerIds));
  const touchedAnchors = new Set(results.map((r) => r.touchedAnchorId).filter((x): x is string => !!x));
  const lock = source === 'manual' || source === 'ai_chat';

  const editId = newId();

  // 1. invalidate OS notifications of everything we touch — OUTSIDE the transaction:
  //    the mock scheduler writes through db() and would deadlock on the DB mutex.
  //    (refillScheduledWindow() below cancels everything anyway; this is just immediate hygiene.)
  for (const id of touchedTriggers) {
    const prev = before.triggers.find((t) => t.id === id);
    if (prev?.osNotificationId) await scheduler.cancel(prev.osNotificationId).catch(() => undefined);
  }

  await d.transaction(async (tx) => {
    // 2. anchors
    for (const a of state.anchors) {
      const prev = before.anchors.find((x) => x.id === a.id);
      if (prev && (prev.monthDay !== a.monthDay || prev.year !== a.year)) {
        await anchorsRepo.setDate(tx, a.id, a.monthDay, a.year, now);
      }
    }

    // 3. triggers — removed
    const nextIds = new Set(state.triggers.map((t) => t.id));
    const removed = before.triggers.filter((t) => !nextIds.has(t.id)).map((t) => t.id);
    await triggersRepo.removeMany(tx, removed);

    // 4. triggers — upsert touched (re-resolving anchor-bound fire_at)
    for (const t of state.triggers) {
      const prev = before.triggers.find((x) => x.id === t.id);
      const isTouched = touchedTriggers.has(t.id) || (t.anchorId != null && touchedAnchors.has(t.anchorId));
      if (!isTouched && prev) continue;
      const resolved = reresolve(t, state);
      await triggersRepo.upsert(tx, {
        ...resolved,
        osNotificationId: null,
        userEdited: lock && touchedTriggers.has(t.id) ? true : resolved.userEdited,
        updatedAt: now,
      });
    }

    // 5. anchor change → ALL triggers bound to it in OTHER notes too
    for (const anchorId of touchedAnchors) {
      const anchor = state.anchors.find((a) => a.id === anchorId);
      if (!anchor) continue;
      const bound = await triggersRepo.byAnchor(tx, anchorId);
      for (const t of bound) {
        if (t.noteId === noteId) continue;
        // OS notification is invalidated by setFireAt (os_notification_id = NULL) + the refill below.
        const p = t.payload as { hour: number; minute: number };
        await triggersRepo.setFireAt(tx, t.id, t.offsetDays == null ? t.fireAt : resolveAnchorTrigger(anchor, t.offsetDays, p, clock), now);
      }
    }

    // 6. summary
    if (state.summary !== before.summary) {
      await notesRepo.setSummary(tx, noteId, state.summary ?? '', lock, now);
    }

    // 7. audit
    await editsRepo.insert(tx, {
      id: editId,
      noteId,
      target: muts.length === 1 ? targetOf(muts[0]!) : 'batch',
      before: results.map((r) => r.before),
      after: muts,
      inverse,
      source,
      now,
    });
  });

  notifyChange('triggers', 'notes', 'anchors', 'edits');
  await refillScheduledWindow();
  return { editId, inverse, touched: touchedTriggers.size };
}

/** Undo the latest edit of a note by applying its stored inverse (as a manual edit). */
export async function undoLast(noteId: string): Promise<boolean> {
  const d = db();
  const last = await editsRepo.last(d, noteId);
  if (!last?.inverse) return false;
  const inverse = JSON.parse(last.inverse) as Mutation[];
  await editsRepo.remove(d, last.id);
  if (inverse.length === 0) return false;
  await applyMutations(noteId, inverse, 'manual');
  // the undo itself is recorded as an edit; remove it so undo-undo doesn't loop oddly
  const undoEdit = await editsRepo.last(d, noteId);
  if (undoEdit) await editsRepo.remove(d, undoEdit.id);
  return true;
}
