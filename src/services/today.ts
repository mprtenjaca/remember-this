// Today screen data: what surfaces now (with anti-fatigue), pending clarify cards,
// and the upcoming horizon. Also records surfacings so fatigue rules have history.

import { db } from '@/db';
import { notesRepo, type NoteWithQuestions } from '@/db/repositories/notes';
import { triggersRepo } from '@/db/repositories/triggers';
import { anchorsRepo } from '@/db/repositories/anchors';
import { surfacingsRepo } from '@/db/repositories/surfacings';
import { prefsRepo, PREF } from '@/db/repositories/prefs';
import { clock, DAY_MS } from '@/domain/clock';
import { planSurfacings, dueInWindow } from '@/domain/triggers/evaluate';
import { resolveAnchorTrigger } from '@/domain/triggers/resolve';
import { adjustThreshold, THRESHOLD } from '@/domain/triggers/scoring';
import { endOfDay, startOfDay } from '@/domain/dates';
import { RECENT_WINDOW_MS } from '@/domain/recentNotes';
import { faceOf } from '@/domain/herald';
import { newId } from '@/lib/ids';
import { notifyChange } from '@/lib/events';
import type { Anchor, Reaction, Surfacing, Trigger } from '@/domain/types';
import { notificationCopy } from './scheduling/refill';
import { uiLang } from '@/ui/theme/locale';
import { applyMutations } from '@/db/applyMutations';
import { setReminderDone } from '@/services/noteActions';

/**
 * How far "Dolazi" looks ahead. Three years, because yearly anchors (birthdays, anniversaries, memorials)
 * resolve to their NEXT occurrence — which is routinely 10+ months out and was invisible under the old
 * 90-day window. The list groups by month/year, so distance costs a heading, not clutter.
 */
const UPCOMING_HORIZON_DAYS = 365 * 3;


export interface SurfacedItem {
  surfacing: Surfacing;
  note: NoteWithQuestions;
  trigger: Trigger | null;
  anchor: Anchor | null;
  why: string; // "Anin rođendan je za 3 tjedna"
}

export interface UpcomingItem {
  /** The note's face in the list — the event itself when the soonest reminder was only its "sat prije" herald. */
  trigger: Trigger;
  note: NoteWithQuestions;
  anchor: Anchor | null;
  /** When the hour-before herald fires, if this face has one (domain/herald.ts). */
  heraldAt: number | null;
}

/** A note written in the last day, with what the app did with it — the "Novo" section. */
export interface RecentItem {
  note: NoteWithQuestions;
  next: Trigger | null;
  anchor: Anchor | null;
}

export interface TodayData {
  now: number;
  surfaced: SurfacedItem[];
  clarify: NoteWithQuestions[];
  failed: NoteWithQuestions[];
  /** Notes the enricher is still working on — the Today screen shows the reading animation for these. */
  reading: NoteWithQuestions[];
  upcoming: UpcomingItem[];
  /**
   * Written in the last RECENT_WINDOW_MS, newest first, not yet capped or de-duplicated against the cards —
   * the screen does that with pickRecent(), because only it knows which reading cards are still being held.
   */
  recent: RecentItem[];
  totalNotes: number;
}

/**
 * Turn due triggers into surfacings (idempotent per day) and return everything the
 * Today screen needs. Called on screen focus and after time travel.
 */
export async function loadToday(): Promise<TodayData> {
  const d = db();
  const now = clock.now();

  // 1. fire what is due, within fatigue rules
  const active = await triggersRepo.allActive(d);
  const history = await surfacingsRepo.all(d);
  const plan = planSurfacings(active, history, clock, now);
  for (const t of plan) {
    const note = await notesRepo.byId(d, t.noteId);
    if (!note || note.archived) continue;
    await surfacingsRepo.insert(d, { id: newId(), noteId: t.noteId, triggerId: t.id, channel: 'today', score: t.certainty, now });
    // recurring anchor → next year; one-off → fired
    let next: number | null = null;
    if (t.type === 'anchor' && t.anchorId && t.offsetDays != null) {
      const anchor = await anchorsRepo.byId(d, t.anchorId);
      if (anchor && anchor.kind !== 'oneoff') {
        next = resolveAnchorTrigger(anchor, t.offsetDays, t.payload as { hour: number; minute: number }, { now: () => now + DAY_MS, timezone: clock.timezone });
      }
    }
    await triggersRepo.markFired(d, t.id, now, next);
  }
  // Due triggers we could NOT surface today (cap/cooldown) just stay active and get picked up later.
  const skipped = dueInWindow(active, now - DAY_MS, now).filter((t) => !plan.some((p) => p.id === t.id));
  if (skipped.length && __DEV__) console.log(`[today] ${skipped.length} due triggers held back by anti-fatigue`);

  // 2. open surfacings (last 3 days, un-reacted)
  // endOfDay, not `now`: a surfacing written earlier today stays visible all day, but one stamped tomorrow
  // or in six months does not leak backwards onto today's screen.
  const open = await surfacingsRepo.openToday(d, now - 3 * DAY_MS, endOfDay(now));
  const surfaced: SurfacedItem[] = [];
  for (const s of open) {
    const note = await notesRepo.byId(d, s.noteId);
    if (!note || note.archived) continue;
    const trigger = s.triggerId ? await triggersRepo.byId(d, s.triggerId) : null;
    const anchor = trigger?.anchorId ? await anchorsRepo.byId(d, trigger.anchorId) : null;
    const why = trigger ? notificationCopy(trigger, note, anchor, now).title : uiLang() === 'en' ? 'You might need this' : 'Možda ti ovo treba';
    surfaced.push({ surfacing: s, note, trigger, anchor, why });
  }

  // 3. clarify + failed
  const clarify = await notesRepo.listByStatus(d, 'needs_input', 5);
  const failed = await notesRepo.listByStatus(d, 'failed', 5);
  const reading = await notesRepo.listByStatus(d, 'pending', 3);

  // 4. upcoming — starts at `now`, not endOfDay(now): a reminder later THIS afternoon must still show up
  // somewhere. It can't be in `surfaced` yet (that would push/surface it before its time, breaking the
  // anti-fatigue rule), so it belongs at the top of "upcoming" instead of falling into a same-day gap.
  //
  // The horizon is years, not 90 days. An anniversary whose next occurrence is in February 2027 was simply
  // absent from the screen — the note existed, the reminder existed, and "Dolazi" showed nothing: exactly
  // this project's silent-failure shape. The list groups itself by month and then by year (groupUpcoming),
  // so a long horizon costs a heading rather than a wall of rows.
  const upTrig = await triggersRepo.upcoming(d, now, startOfDay(now) + UPCOMING_HORIZON_DAYS * DAY_MS, 120);
  const noteMap = new Map((await notesRepo.byIds(d, Array.from(new Set(upTrig.map((t) => t.noteId))))).map((n) => [n.id, n]));
  const anchorMap = new Map((await anchorsRepo.byIds(d, Array.from(new Set(upTrig.map((t) => t.anchorId).filter((x): x is string => !!x))))).map((a) => [a.id, a]));
  // One row per note. Its face is the soonest reminder — unless that is only the "sat prije" herald of a moment
  // an hour later, in which case the moment fronts the row and the herald goes into the subtitle (faceOf).
  const upcoming: UpcomingItem[] = [];
  const seenNotes = new Set<string>();
  for (const t of upTrig) {
    const note = noteMap.get(t.noteId);
    if (!note || note.archived || seenNotes.has(note.id)) continue;
    seenNotes.add(note.id);
    const face = faceOf(upTrig.filter((x) => x.noteId === note.id));
    const trigger = face?.trigger ?? t;
    upcoming.push({ trigger, note, anchor: trigger.anchorId ? anchorMap.get(trigger.anchorId) ?? null : null, heraldAt: face?.heraldAt ?? null });
  }

  // 5. "Novo" — what was written in the last day, so a fresh note leaves a trace on Today even when it has no
  // question and no reminder soon. Its next reminder comes from the same `upcoming` pass (one per note).
  const recent: RecentItem[] = (await notesRepo.listActive(d, 20))
    .filter((n) => n.createdAt >= now - RECENT_WINDOW_MS && n.createdAt <= now)
    .map((n) => {
      const u = upcoming.find((x) => x.note.id === n.id);
      return { note: n, next: u?.trigger ?? null, anchor: u?.anchor ?? null };
    });

  return { now, surfaced, clarify, failed, reading, upcoming, recent, totalNotes: await notesRepo.count(d) };
}

/** 👍 / "ne sad" / 👎 / done → surfacing.reaction + adaptive threshold + side effects. */
export async function react(surfacingId: string, reaction: Reaction) {
  const d = db();
  const now = clock.now();
  const s = await surfacingsRepo.byId(d, surfacingId);
  if (!s) return;
  await surfacingsRepo.react(d, surfacingId, reaction, now);

  const cur = await prefsRepo.getNumber(d, PREF.thresholdSemantic, THRESHOLD.initial);
  await prefsRepo.set(d, PREF.thresholdSemantic, String(adjustThreshold(cur, reaction)), now, true);

  if (reaction === 'done' && s.triggerId) {
    // "Riješeno" on the card resolves THIS reminder only — the same tick as in the note's own list. It used to
    // close the whole chain and archive the note, which surprised Marko ("sat prije" done ≠ birthday done). The
    // note still follows on its own when this was the last reminder open (setReminderDone → afterTriggerDone).
    await setReminderDone(s.noteId, s.triggerId);
  }
  if (reaction === 'not_now' && s.triggerId) {
    const t = await triggersRepo.byId(d, s.triggerId);
    if (t && t.state !== 'active') {
      // re-arm in 7 days as a one-shot time trigger
      await applyMutations(
        s.noteId,
        [{ op: 'add_trigger', trigger: { type: 'time', payload: { iso: new Date(now + 7 * DAY_MS).toISOString() }, label: t.label, certainty: t.certainty, fireAt: now + 7 * DAY_MS } }],
        'manual',
      );
    }
  }
  notifyChange('surfacings', 'notes');
}
