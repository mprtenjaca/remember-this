// Anchor flow: answer "Kad je rođendan?" → create/update anchor → bind every
// pending anchor trigger (this note AND any other note about the same person).

import { db, type Db } from '@/db';
import { anchorsRepo } from '@/db/repositories/anchors';
import { triggersRepo } from '@/db/repositories/triggers';
import { notesRepo, type NoteWithQuestions } from '@/db/repositories/notes';
import { clock } from '@/domain/clock';
import { toLocalIso } from '@/domain/dates';
import { newId } from '@/lib/ids';
import { notifyChange } from '@/lib/events';
import { DEFAULT_ANCHOR_TIME, DEFAULT_CHAINS, offsetLabel, resolveAnchorTrigger } from '@/domain/triggers/resolve';
import { anchorLabelFor } from '@/domain/enrich/labels';
import { draftToTrigger } from '@/domain/mutations';
import { dayOfTimeMutations } from '@/domain/anchorTime';
import { applyMutations } from '@/db/applyMutations';
import { prefsRepo } from '@/db/repositories/prefs';
import type { Anchor, AnchorKind, AnchorPayload } from '@/domain/types';
import { refillScheduledWindow } from './scheduling/refill';
import { uiLang } from '@/ui/theme/locale';

export interface AnswerAnchorInput {
  noteId: string;
  person: string;
  kind: AnchorKind;
  monthDay: string; // 'MM-DD'
  year?: number | null; // oneoff only
  source?: Anchor['source'];
  contactId?: string | null;
  /**
   * A time the user chose along with the date (optional in the picker). When given, every reminder bound to this
   * anchor in the note takes that hour — "da se podsjetnici vrte oko toga" (Marko, 2026-08-28). Without it, the
   * default hour stays.
   */
  at?: AnchorPayload | null;
}

export function anchorLabel(person: string, kind: AnchorKind, lang: 'hr' | 'en' = 'hr'): string {
  return anchorLabelFor(person, kind, lang);
}

export async function answerAnchor(input: AnswerAnchorInput): Promise<Anchor> {
  const d = db();
  const now = clock.now();
  const note = await notesRepo.byId(d, input.noteId);
  const lang = uiLang(); // UI copy follows the DEVICE, never the note (Marko, 2026-08-25)

  let anchor = await anchorsRepo.byPersonKind(d, input.person, input.kind);
  if (anchor) {
    // Hard rule 3 applied to anchors: what the user picked in the date sheet outranks anything derived from the
    // text later. Re-enrich calls this with source 'inferred' for a date it read in the note ("godišnjica 14.9.")
    // — that must fill a gap, never overwrite the date the user chose by hand.
    const derived = input.source === 'inferred' || input.source === 'contacts';
    const userChosen = anchor.source === 'user' && anchor.monthDay != null;
    if (derived && userChosen) {
      await bindPendingTriggers(anchor);
      await clearAnchorQuestion(note);
      notifyChange('anchors', 'triggers', 'notes');
      await refillScheduledWindow();
      return anchor;
    }
    await anchorsRepo.setDate(d, anchor.id, input.monthDay, input.year ?? null, now);
    if (!derived) await anchorsRepo.setSource(d, anchor.id, input.source ?? 'user', now);
    anchor = { ...anchor, monthDay: input.monthDay, year: input.year ?? null, source: derived ? anchor.source : input.source ?? 'user' };
  } else {
    anchor = {
      id: newId(),
      label: anchorLabel(input.person, input.kind, lang),
      person: input.person,
      kind: input.kind,
      monthDay: input.monthDay,
      year: input.year ?? null,
      contactId: input.contactId ?? null,
      source: input.source ?? 'user',
      createdAt: now,
      updatedAt: now,
    };
    await anchorsRepo.insert(d, anchor);
  }

  await bindPendingTriggers(anchor);

  // The model asked for the date but emitted no anchor reminders (Groq does this) → answering must still
  // produce the chain, otherwise the answer changes nothing visible.
  const bound = (await triggersRepo.byNote(d, input.noteId)).filter((t) => t.type === 'anchor' && t.anchorId === anchor.id);
  if (bound.length === 0) {
    const prefs = await prefsRepo.all(d);
    const at: AnchorPayload = { hour: Number(prefs['hour.default']) || DEFAULT_ANCHOR_TIME.hour, minute: 0 };
    const intent = note?.intent ?? 'gift';
    // Same rule as ingest.defaultChain: non-birthday kinds keep their own rhythm (anniversary −14/−3).
    const chain = (input.kind !== 'birthday' ? DEFAULT_CHAINS[input.kind] : null) ?? DEFAULT_CHAINS[intent] ?? DEFAULT_CHAINS[input.kind] ?? DEFAULT_CHAINS.oneoff!;
    for (const offset of chain) {
      const fireAt = resolveAnchorTrigger(anchor, offset, at, clock);
      const t = draftToTrigger(
        { type: 'anchor', payload: at, label: offsetLabel(offset, lang), certainty: 0.6, anchorId: anchor.id, offsetDays: offset, fireAt },
        input.noteId,
        newId(),
        now,
      );
      await triggersRepo.insert(d, t);
    }
  }

  // The user chose a time with the date. Only the DAY-OF reminder takes it (Marko: "samo je bitan onaj u tom trenu
  // na taj dan"); the lead reminders keep their hour. The day-of reminder is created when the chain had none.
  if (input.at) {
    const all = await triggersRepo.byNote(d, input.noteId);
    await applyMutations(input.noteId, dayOfTimeMutations(all, anchor, input.at, clock, lang), 'manual');
  }

  await clearAnchorQuestion(note);

  notifyChange('anchors', 'triggers', 'notes');
  await refillScheduledWindow();
  return anchor;
}

/** The anchor now has a date → this note's date question is answered. */
async function clearAnchorQuestion(note: NoteWithQuestions | null) {
  if (!note) return;
  const remaining = note.questions.filter((q) => q.kind !== 'date');
  await notesRepo.setStatus(db(), note.id, remaining.length ? 'needs_input' : 'enriched', clock.now(), remaining);
}

/** Bind every anchor trigger with anchor_id NULL whose payload names this person+kind. */
async function bindPendingTriggers(anchor: Anchor) {
  const d = db();
  const now = clock.now();
  const rows = await d.all<{ id: string; payload: string; offset_days: number | null; note_id: string }>(
    `SELECT id, payload, offset_days, note_id FROM triggers WHERE type = 'anchor' AND anchor_id IS NULL AND state = 'active'`,
  );
  for (const r of rows) {
    const p = JSON.parse(r.payload) as AnchorPayload;
    if (!p.person || p.person.toLowerCase() !== (anchor.person ?? '').toLowerCase()) continue;
    if ((p.kind ?? 'birthday') !== anchor.kind) continue;
    const fireAt = r.offset_days == null ? null : resolveAnchorTrigger(anchor, r.offset_days, p, clock);
    const { person: _p, kind: _k, ...clean } = p;
    await triggersRepo.bindAnchor(d, r.id, anchor.id, fireAt, clean, now);
  }
}

/** Skip the question — keep the note ("Bez podsjetnika" / "Preskoči pitanje"). Pending anchor triggers are dropped. */
export async function dismissQuestions(noteId: string) {
  const d = db();
  const now = clock.now();
  const pending = await triggersRepo.pendingAnchor(d, noteId);
  await triggersRepo.removeMany(
    d,
    pending.map((t) => t.id),
  );
  await notesRepo.setStatus(d, noteId, 'enriched', now, []);
  notifyChange('notes', 'triggers');
}

/** Options-question answered: store as a learned pref if it maps to one; then clear it. */
export async function answerOption(noteId: string, questionId: string, option: string) {
  const d = db();
  const now = clock.now();
  const note = await notesRepo.byId(d, noteId);
  if (!note) return;

  // The answer used to be thrown away — only the question was cleared. That is a real loss when the user typed
  // it themselves ("Ćaću" when the offered chips said "Obitelj"): they told us the one thing we could not work
  // out, and it has to end up in the note's keywords so search can find it later.
  const value = option.trim();
  if (value) {
    const existing = await notesRepo.entities(d, noteId);
    const known = new Set(existing.map((e) => e.value.toLowerCase()));
    if (!known.has(value.toLowerCase())) {
      await notesRepo.addEntity(d, noteId, { kind: 'keyword', value });
      await appendKeyword(d, noteId, value);
    }
  }

  const remaining = note.questions.filter((q) => q.id !== questionId);
  const stillNeedsAnchor = (await triggersRepo.pendingAnchor(d, noteId)).length > 0;
  await notesRepo.setStatus(d, noteId, remaining.length || stillNeedsAnchor ? 'needs_input' : 'enriched', now, remaining);
  notifyChange('notes', 'triggers');
}

/** Put the answer into the note's semantic trigger too, so it is searchable the way every other keyword is. */
async function appendKeyword(d: Db, noteId: string, value: string) {
  const semantic = (await triggersRepo.byNote(d, noteId)).find((t) => t.type === 'semantic');
  if (!semantic) return;
  const payload = semantic.payload as { keywords: string[] };
  const keywords = payload.keywords ?? [];
  if (keywords.some((k) => k.toLowerCase() === value.toLowerCase())) return;
  await applyMutations(noteId, [{ op: 'set_keywords', triggerId: semantic.id, keywords: [...keywords, value] }], 'manual');
}

/**
 * Answer the "I guessed ~N months" question by MOVING the fallback reminder.
 *
 * Deliberately not answerOption(): that keeps the answer as a keyword and never touches a trigger, so an
 * interval offered as a plain option would clear the question and change nothing — the note would look
 * corrected while still firing on the guess.
 *
 * Only the low-certainty fallback moves. A trigger the user already edited by hand is sacred (hard rule 3),
 * and a confident one came from the note's own words.
 */
export async function answerInterval(noteId: string, questionId: string, months: number) {
  const at = new Date(clock.now());
  at.setMonth(at.getMonth() + months);
  await moveFallback(noteId, questionId, at, true);
}

/** Same question answered with an exact day from the picker instead of one of the offered intervals. */
export async function answerFallbackDate(noteId: string, questionId: string, when: number) {
  await moveFallback(noteId, questionId, new Date(when), false);
}

async function moveFallback(noteId: string, questionId: string, at: Date, keepHour: boolean) {
  const d = db();
  const now = clock.now();
  const note = await notesRepo.byId(d, noteId);
  if (!note) return;

  const target = (await triggersRepo.byNote(d, noteId)).find((t) => t.type === 'time' && !t.userEdited && t.certainty < 0.5);
  if (target) {
    // An interval keeps the hour the fallback already chose (only the day moves); a picked date brings its
    // own, falling back to the default when the picker returned a bare day.
    const prev = target.fireAt != null ? new Date(target.fireAt) : null;
    if (keepHour || (at.getHours() === 0 && at.getMinutes() === 0)) {
      at.setHours(prev?.getHours() ?? DEFAULT_ANCHOR_TIME.hour, prev?.getMinutes() ?? DEFAULT_ANCHOR_TIME.minute, 0, 0);
    }
    await applyMutations(noteId, [{ op: 'set_time', triggerId: target.id, iso: toLocalIso(at.getTime()) }], 'manual');
  }

  const remaining = note.questions.filter((q) => q.id !== questionId);
  const stillNeedsAnchor = (await triggersRepo.pendingAnchor(d, noteId)).length > 0;
  await notesRepo.setStatus(d, noteId, remaining.length || stillNeedsAnchor ? 'needs_input' : 'enriched', now, remaining);
  notifyChange('notes', 'triggers');
  await refillScheduledWindow();
}
