// Rotating window over the OS notification slots. iOS silently drops the 65th
// pending notification — so we only ever schedule the next (capacity − RESERVE)
// triggers and re-run this after every mutation, on foreground and daily.

import { db } from '@/db';
import { notesRepo } from '@/db/repositories/notes';
import { triggersRepo } from '@/db/repositories/triggers';
import { anchorsRepo } from '@/db/repositories/anchors';
import { clock } from '@/domain/clock';
import { clampToWakingHours } from '@/domain/triggers/evaluate';
import { notificationCategory } from '@/domain/notificationCategory';
import { fmtRelative } from '@/domain/dates';
import { scheduler } from '@/services/notifications';
import { coalesce } from './coalesce';
import { uiLang } from '@/ui/theme/locale';
import type { Trigger, Note, Anchor } from '@/domain/types';

const RESERVE = 14; // slots for geofence-triggered + quick actions

export interface RefillStats {
  scheduled: number;
  waitingInDb: number;
  capacity: number;
}

/** "Why now" copy — the most important text in the app. */
export function notificationCopy(t: Trigger, note: Note, anchor: Anchor | null, now: number): { title: string; body: string } {
  const lang = uiLang(); // notification copy follows the DEVICE language
  const summary = note.summary ?? note.rawText;
  if (t.type === 'anchor' && anchor) {
    const when = t.fireAt != null ? fmtRelative(t.fireAt - (t.offsetDays ?? 0) * 86_400_000, t.fireAt, lang) : '';
    const title = lang === 'hr' ? `${anchor.label} je ${when}` : `${anchor.label} is ${when}`;
    return { title, body: summary };
  }
  if (t.type === 'time') {
    const age = fmtRelative(note.createdAt, now, lang);
    const title = lang === 'hr' ? `Zapisao si ovo ${age}` : `You noted this ${age}`;
    return { title, body: summary };
  }
  return { title: lang === 'hr' ? 'Podsjetnik' : 'Reminder', body: summary };
}

/**
 * Never two refills at once, and never a stale one.
 *
 * The previous guard returned the in-flight promise to callers who arrived after the data had changed — so
 * ticking a reminder off and straight back on kept the "off" schedule: active in the DB, missing from the OS.
 * `coalesce` runs a fresh pass afterwards instead (see coalesce.ts).
 */
export const refillScheduledWindow = coalesce<RefillStats>(() => doRefill());

async function doRefill(): Promise<RefillStats> {
  const d = db();
  const now = clock.now();
  const cap = Math.max(0, scheduler.capacity() - RESERVE);

  await scheduler.cancelAll();
  await triggersRepo.clearAllOsIds(d);

  const upcoming = await triggersRepo.nextScheduled(d, now, cap);
  const total = await triggersRepo.countActiveScheduled(d, now);

  const notes = new Map((await notesRepo.byIds(d, Array.from(new Set(upcoming.map((t) => t.noteId))))).map((n) => [n.id, n]));
  const anchorIds = Array.from(new Set(upcoming.map((t) => t.anchorId).filter((x): x is string => !!x)));
  const anchors = new Map((await anchorsRepo.byIds(d, anchorIds)).map((a) => [a.id, a]));

  let scheduled = 0;
  for (const t of upcoming) {
    const note = notes.get(t.noteId);
    if (!note || note.archived) continue;
    const copy = notificationCopy(t, note, t.anchorId ? anchors.get(t.anchorId) ?? null : null, now);
    const osId = await scheduler.schedule({
      triggerId: t.id,
      noteId: t.noteId,
      fireAt: clampToWakingHours(t.fireAt!),
      title: copy.title,
      body: copy.body,
      category: notificationCategory(note),
    });
    await triggersRepo.setOsId(d, t.id, osId);
    scheduled++;
  }

  return { scheduled, waitingInDb: Math.max(0, total - scheduled), capacity: cap };
}
