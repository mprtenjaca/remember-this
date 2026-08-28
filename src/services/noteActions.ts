// Row actions shared by every list (Danas, Sve, Riješeno) so a swipe means the same thing everywhere.
//
// Deleting a note takes its reminders with it, which is not undoable — so it always asks first. Archiving
// ("Riješeno") is the reversible one and needs no dialog.

import { Alert } from 'react-native';
import { db } from '@/db';
import { notesRepo } from '@/db/repositories/notes';
import { clock } from '@/domain/clock';
import { uiLang } from '@/ui/theme/locale';
import { notifyChange } from '@/lib/events';
import { triggersRepo } from '@/db/repositories/triggers';
import { applyMutations } from '@/db/applyMutations';
import { afterTriggerDone, markNoteDone, reopenNote } from '@/domain/noteStatus';
import { playDing } from '@/services/sound';

const COPY = {
  hr: {
    title: 'Obrisati bilješku?',
    body: 'Nestaju i svi podsjetnici. Ovo se ne može vratiti.',
    cancel: 'Odustani',
    del: 'Obriši',
    menuTitle: 'Bilješka',
    done: 'Označi riješeno',
    undone: 'Vrati u aktivne',
  },
  en: {
    title: 'Delete note?',
    body: 'All its reminders go with it. This cannot be undone.',
    cancel: 'Cancel',
    del: 'Delete',
    menuTitle: 'Note',
    done: 'Mark as done',
    undone: 'Move back to active',
  },
} as const;

/** Confirm, then delete the note and its reminders. */
export function confirmDeleteNote(noteId: string, summary: string, after?: () => void) {
  const c = COPY[uiLang()];
  Alert.alert(c.title, `${summary}\n\n${c.body}`, [
    { text: c.cancel, style: 'cancel' },
    {
      text: c.del,
      style: 'destructive',
      onPress: async () => {
        await notesRepo.remove(db(), noteId);
        after?.();
      },
    },
  ]);
}

/**
 * Mark the whole note done, or reopen it. Reversible, so no dialog.
 *
 * Done means done: every still-active reminder is switched off, or a "finished" note would keep firing. The
 * semantic trigger stays, so the note is still findable in six months — that is the point of the app.
 */
export async function setNoteDone(noteId: string, done: boolean) {
  // Only the "done" direction is a completion; reopening is a correction and stays silent.
  if (done) playDing();
  const d = db();
  const triggers = await triggersRepo.byNote(d, noteId);
  const decision = done ? markNoteDone(triggers) : reopenNote();
  if (decision.cancelTriggerIds.length) {
    await applyMutations(
      noteId,
      decision.cancelTriggerIds.map((triggerId) => ({ op: 'set_state' as const, triggerId, state: 'done' as const })),
      'manual',
    );
  }
  await notesRepo.setArchived(d, noteId, done, clock.now());
  notifyChange('notes', 'triggers');
}

/**
 * Tick off ONE reminder. When it was the last one outstanding the note follows on its own — nobody wants to
 * say "done" twice for the same errand.
 *
 * @returns true when the note was archived as a result, so the caller can say so.
 */
export async function setReminderDone(noteId: string, triggerId: string): Promise<boolean> {
  // Every tick sounds, not only the last one: ticking a reminder off IS a completion, and a silent tap
  // followed by a sudden ding on the final one reads as though only the last errand counted.
  playDing();
  const d = db();
  await applyMutations(noteId, [{ op: 'set_state', triggerId, state: 'done' }], 'manual');
  const after = await triggersRepo.byNote(d, noteId);
  const decision = afterTriggerDone(after, triggerId);
  // No second ding here: the tick above already sounded, and the note archiving itself is a consequence of
  // that same tap. The escalation from "one done" to "all done" is carried by the haptic, not by two dings.
  if (decision.archive) await notesRepo.setArchived(d, noteId, true, clock.now());
  notifyChange('notes', 'triggers');
  return decision.archive;
}

/** Undo a ticked reminder. The note reopens with it. */
export async function setReminderActive(noteId: string, triggerId: string) {
  const d = db();
  await applyMutations(noteId, [{ op: 'set_state', triggerId, state: 'active' }], 'manual');
  await notesRepo.setArchived(d, noteId, false, clock.now());
  notifyChange('notes', 'triggers');
}

/** Long-press menu: done/undone, delete, cancel. */
export function openNoteMenu(opts: { noteId: string; summary: string; archived: boolean; onOpen?: () => void }) {
  const c = COPY[uiLang()];
  Alert.alert(c.menuTitle, opts.summary, [
    { text: opts.archived ? c.undone : c.done, onPress: () => void setNoteDone(opts.noteId, !opts.archived) },
    { text: c.del, style: 'destructive', onPress: () => confirmDeleteNote(opts.noteId, opts.summary) },
    { text: c.cancel, style: 'cancel' },
  ]);
}

/**
 * Replace the note's own text. The reasoning behind its reminders came from the OLD text, so the caller
 * decides (via shouldOfferReread) whether to offer a re-read; this only writes.
 */
export async function setNoteText(noteId: string, text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  await db().run(`UPDATE notes SET raw_text = ?, updated_at = ? WHERE id = ?`, [clean, clock.now(), noteId]);
  notifyChange('notes');
}
