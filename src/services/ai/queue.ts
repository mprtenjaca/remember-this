// Background enrich queue. Capture never waits for this. Retries 3× with exponential
// backoff; offline-safe (pending notes are picked up when the app comes back).
// If the remote is unreachable, the local heuristic fills triggers immediately so
// the note is useful now — and status stays 'pending' for a later remote upgrade
// only while attempts remain.

import { db } from '@/db';
import { notesRepo } from '@/db/repositories/notes';
import { triggersRepo } from '@/db/repositories/triggers';
import { anchorsRepo } from '@/db/repositories/anchors';
import { prefsRepo } from '@/db/repositories/prefs';
import { embeddingsRepo } from '@/db/repositories/embeddings';
import { clock } from '@/domain/clock';
import { ingest } from '@/domain/enrich/ingest';
import { heuristicEnrich } from '@/domain/enrich/heuristic';
import { reconcile } from '@/domain/enrich/reconcile';
import { uiLang } from '@/ui/theme/locale';
import { draftToTrigger } from '@/domain/mutations';
import { newId } from '@/lib/ids';
import { notifyChange } from '@/lib/events';
import type { EnrichResult, Trigger } from '@/domain/types';
import { AiUnavailable, aiConfigured } from './client';
import { enrichNote } from './enrich';
import { documentText, embedDocument } from './embed';
import { EMBED_MODEL } from './prompt';
import { refillScheduledWindow } from '@/services/scheduling/refill';
import { maybeNotifyQuestion } from '@/services/notifications/questionPush';
import { answerAnchor } from '@/services/anchors';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2_000, 8_000, 30_000];

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export function kickEnrichQueue(delayMs = 0) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void processQueue();
  }, delayMs);
}

export async function processQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const d = db();
    const pending = await notesRepo.listByStatus(d, 'pending', 10);
    let retryDelay: number | null = null;
    for (const n of pending) {
      const r = await enrichOne(n.id);
      if (r === 'retry') retryDelay = Math.min(retryDelay ?? Infinity, BACKOFF_MS[Math.min(n.enrichAttempts, BACKOFF_MS.length - 1)]!);
    }
    if (retryDelay != null) kickEnrichQueue(retryDelay);
  } finally {
    running = false;
  }
}

/** Write an EnrichResult into the DB for a note (used by the queue and by re-enrich). */
export async function applyEnrichResult(noteId: string, raw: EnrichResult, source: 'enrich' | 'heuristic'): Promise<void> {
  const d = db();
  const now = clock.now();
  const note = await notesRepo.byId(d, noteId);
  if (!note) return;
  const existing = await triggersRepo.byNote(d, noteId);
  const anchors = await anchorsRepo.all(d);
  const prefs = await prefsRepo.all(d);

  // Our deterministic edge-case rules run on every model answer (never on the heuristic itself — it already IS
  // those rules), so behaviour never depends on which provider happened to answer.
  const reconciled = source === 'heuristic' ? raw : reconcile(raw, note.rawText, { now, anchors, uiLang: uiLang() });
  const out = ingest(reconciled, { existingTriggers: existing, anchors, prefs, clock, uiLang: uiLang() });

  await d.transaction(async (tx) => {
    await triggersRepo.removeMany(tx, out.removeTriggerIds);
    for (const draft of out.drafts) {
      const t: Trigger = draftToTrigger(draft, noteId, newId(), now);
      await triggersRepo.insert(tx, t);
    }
    await notesRepo.replaceEntities(tx, noteId, [
      ...out.keywords.map((k) => ({ kind: 'keyword', value: k })),
      ...out.people.map((p) => ({ kind: 'person', value: p })),
    ]);
    await notesRepo.setEnriched(tx, noteId, {
      summary: out.summary,
      language: out.language,
      category: out.category,
      intent: out.intent,
      confidence: out.confidence,
      status: out.status,
      questions: out.questions,
      now,
    });
  });
  if (__DEV__) console.log(`[enrich:${source}] ${noteId} → ${out.status}, ${out.drafts.length} triggers, ${out.questions.length} q`);
  notifyChange('notes', 'triggers');

  // Reading ended in a question and the user may already be gone (dictate → pocket the phone): tell them now,
  // while iOS still runs our JS, instead of letting the question sit invisibly on Danas until the next open.
  // maybeNotifyQuestion decides for itself (skips Expo Go and a foregrounded app) — see questionPush.ts.
  if (out.status === 'needs_input' && out.questions[0]) {
    void maybeNotifyQuestion({
      noteId,
      question: out.questions[0].text,
      summary: out.summary ?? note.rawText,
      hr: uiLang() === 'hr',
    });
  }

  // The note stated the date itself ("rođendan 10.6") → create the anchor now, bind the pending drafts, no question.
  if (out.inferredAnchor) {
    const { person, kind, monthDay } = out.inferredAnchor;
    await answerAnchor({ noteId, person, kind, monthDay, source: 'inferred' });
    return; // answerAnchor refills the window
  }
  await refillScheduledWindow();
}

async function enrichOne(noteId: string): Promise<'done' | 'retry' | 'failed'> {
  const d = db();
  const now = clock.now();
  const note = await notesRepo.byId(d, noteId);
  if (!note || note.status !== 'pending') return 'done';
  const anchors = await anchorsRepo.all(d);
  const prefs = await prefsRepo.all(d);

  await notesRepo.bumpAttempts(d, noteId, now);

  try {
    const { result, source } = await enrichNote(note.rawText, anchors, prefs);
    await applyEnrichResult(noteId, result, source === 'gemini' ? 'enrich' : 'heuristic');
    if (source === 'gemini') void embedNote(noteId).catch(() => undefined);
    return 'done';
  } catch (e) {
    const retryable = e instanceof AiUnavailable && e.retryable;
    const attempts = note.enrichAttempts + 1;
    if (retryable && attempts < MAX_ATTEMPTS) {
      // Give the note instant local triggers, keep 'pending' so remote can upgrade later.
      const existing = await triggersRepo.byNote(d, noteId);
      if (existing.length === 0) {
        const local = heuristicEnrich(note.rawText, { now, anchors });
        await applyEnrichResult(noteId, local, 'heuristic');
        // ...but NOT when the heuristic already produced a question. Today only shows questions for notes in
        // `needs_input`, so forcing 'pending' back hid it until the retries ran out — the user saw the note
        // saved silently and got the question only after tapping "Pročitaj ponovno". A question we already
        // know we need is asked now; the remote upgrade is not worth waiting for.
        const after = await notesRepo.byId(d, noteId);
        if (after?.status !== 'needs_input') await notesRepo.setStatus(d, noteId, 'pending', now);
      }
      return 'retry';
    }
    // Out of retries or non-retryable: heuristic is the final answer.
    try {
      const local = heuristicEnrich(note.rawText, { now, anchors });
      await applyEnrichResult(noteId, local, 'heuristic');
      return 'done';
    } catch {
      await notesRepo.setStatus(d, noteId, 'failed', now);
      return 'failed';
    }
  }
}

export async function embedNote(noteId: string): Promise<void> {
  if (!aiConfigured()) return;
  const d = db();
  const note = await notesRepo.byId(d, noteId);
  if (!note) return;
  const triggers = await triggersRepo.byNote(d, noteId);
  const keywords = triggers.filter((t) => t.type === 'semantic').flatMap((t) => (t.payload as { keywords: string[] }).keywords);
  const vec = await embedDocument(documentText(note.summary, note.rawText, keywords));
  if (vec) await embeddingsRepo.upsert(d, noteId, EMBED_MODEL, vec, clock.now());
}

/** Manual "Pokušaj ponovno" from a failed card. */
export async function retryEnrich(noteId: string) {
  const d = db();
  await d.run(`UPDATE notes SET status = 'pending', enrich_attempts = 0, updated_at = ? WHERE id = ?`, [clock.now(), noteId]);
  notifyChange('notes');
  kickEnrichQueue();
}
