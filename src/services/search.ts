// Search: semantic (embeddings, local cosine) when available, keyword fallback always.
// Reactive only — semantic triggers are never evaluated in the background.

import { db } from '@/db';
import { notesRepo, type NoteWithQuestions } from '@/db/repositories/notes';
import { embeddingsRepo } from '@/db/repositories/embeddings';
import { surfacingsRepo } from '@/db/repositories/surfacings';
import { prefsRepo, PREF } from '@/db/repositories/prefs';
import { topK } from '@/domain/search/cosine';
import { THRESHOLD } from '@/domain/triggers/scoring';
import { clock } from '@/domain/clock';
import { newId } from '@/lib/ids';
import { embedQuery } from './ai/embed';

export interface SearchHit {
  note: NoteWithQuestions;
  score: number; // cosine or 1 for keyword hits
  mode: 'semantic' | 'keyword';
}

export async function search(query: string, limit = 20): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const d = db();

  const keyword = await notesRepo.keywordSearch(d, q, limit);
  const hits = new Map<string, SearchHit>(keyword.map((n) => [n.id, { note: n, score: 1, mode: 'keyword' as const }]));

  try {
    const vec = await embedQuery(q);
    if (vec) {
      const docs = await embeddingsRepo.all(d);
      const threshold = await prefsRepo.getNumber(d, PREF.thresholdSemantic, THRESHOLD.initial);
      const ranked = topK(
        vec,
        docs.map((e) => ({ item: e.noteId, vector: e.vector })),
        limit,
        threshold - 0.15, // search is exploratory → looser than surfacing
      );
      const notes = new Map((await notesRepo.byIds(d, ranked.map((r) => r.item))).map((n) => [n.id, n]));
      for (const r of ranked) {
        const n = notes.get(r.item);
        if (!n || n.archived) continue;
        const prev = hits.get(n.id);
        if (!prev || prev.mode === 'keyword') hits.set(n.id, { note: n, score: r.score, mode: 'semantic' });
      }
    }
  } catch {
    // offline / no proxy → keyword only
  }

  return Array.from(hits.values())
    .sort((a, b) => b.score - a.score || b.note.createdAt - a.note.createdAt)
    .slice(0, limit);
}

/** Record that a note was shown as a search result (feeds fatigue history, low weight). */
export async function recordInlineSurfacing(noteId: string, score: number) {
  await surfacingsRepo.insert(db(), { id: newId(), noteId, triggerId: null, channel: 'inline_search', score, now: clock.now() });
}

// Words that connect every gift/task note to every other one — a match on these alone is noise.
const GENERIC = new Set([
  'rođendan', 'rodendan', 'rodjendan', 'birthday', 'poklon', 'dar', 'gift', 'present', 'želi', 'zeli', 'wants',
  'podsjeti', 'remind', 'zapamti', 'remember', 'kupiti', 'kupi', 'nazvati', 'nazovi', 'sutra', 'danas', 'tomorrow', 'today',
  'neki', 'neka', 'nešto', 'nesto', 'treba', 'možda', 'mozda', 'jako', 'dobar', 'dobro', 'godina', 'tjedan', 'mjesec',
  'this', 'that', 'with', 'from', 'about', 'some', 'when', 'what', 'have', 'will', 'nije', 'kako', 'gdje', 'kada',
]);

function specificWords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[.,;:!?()"']/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w)),
    ),
  );
}

/**
 * Inline "≋ već imaš nešto o ovome" while typing a new note — keyword-based, debounced by the caller.
 * Only fires on SPECIFIC overlap: a proper noun (capitalised word) or ≥ 2 distinctive words in common.
 * "rođendan" alone connecting Ana's Dyson to Marta's camera is exactly the noise this avoids.
 */
export async function relatedWhileTyping(text: string): Promise<NoteWithQuestions[]> {
  const words = specificWords(text);
  if (words.length === 0) return [];
  const proper = new Set(
    text
      .replace(/[.,;:!?()"']/g, ' ')
      .split(/\s+/)
      .filter((w, i) => i > 0 && /^[A-ZČĆŽŠĐ][a-zčćžšđ]{2,}$/.test(w))
      .map((w) => w.toLowerCase()),
  );
  const candidates = await notesRepo.keywordSearch(db(), words.slice(-6).join(' '), 8);
  const scored = candidates
    .map((n) => {
      const hay = `${n.rawText} ${n.summary ?? ''}`.toLowerCase();
      const hits = words.filter((w) => hay.includes(w));
      const properHit = hits.some((w) => proper.has(w));
      return { n, score: hits.length + (properHit ? 2 : 0), ok: properHit || hits.length >= 2 };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((x) => x.n);
}
