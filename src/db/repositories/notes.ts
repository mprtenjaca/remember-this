import type { Db } from '../index';
import { toNote, type NoteRow } from '../rows';
import type { EnrichQuestion, Note, NoteStatus } from '@/domain/types';
import { notifyChange } from '@/lib/events';

export type NoteWithQuestions = Note & { questions: EnrichQuestion[] };

export const notesRepo = {
  async insert(db: Db, n: { id: string; rawText: string; source: Note['source']; now: number }) {
    await db.run(
      `INSERT INTO notes (id, raw_text, status, source, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?)`,
      [n.id, n.rawText, n.source, n.now, n.now],
    );
    notifyChange('notes');
  },

  async byId(db: Db, id: string): Promise<NoteWithQuestions | null> {
    const r = await db.get<NoteRow>(`SELECT * FROM notes WHERE id = ?`, [id]);
    return r ? toNote(r) : null;
  },

  async listActive(db: Db, limit = 500): Promise<NoteWithQuestions[]> {
    const rows = await db.all<NoteRow>(`SELECT * FROM notes WHERE archived = 0 ORDER BY created_at DESC LIMIT ?`, [limit]);
    return rows.map(toNote);
  },

  /** Archived = "riješeno" (done). Reachable from Sve → Riješeno, so nothing is ever lost silently. */
  async listArchived(db: Db, limit = 500): Promise<NoteWithQuestions[]> {
    const rows = await db.all<NoteRow>(`SELECT * FROM notes WHERE archived = 1 ORDER BY updated_at DESC LIMIT ?`, [limit]);
    return rows.map(toNote);
  },

  async countArchived(db: Db): Promise<number> {
    const r = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM notes WHERE archived = 1`);
    return r?.c ?? 0;
  },

  async listAll(db: Db): Promise<NoteWithQuestions[]> {
    const rows = await db.all<NoteRow>(`SELECT * FROM notes ORDER BY created_at DESC`);
    return rows.map(toNote);
  },

  async listByStatus(db: Db, status: NoteStatus, limit = 20): Promise<NoteWithQuestions[]> {
    const rows = await db.all<NoteRow>(`SELECT * FROM notes WHERE status = ? AND archived = 0 ORDER BY created_at ASC LIMIT ?`, [status, limit]);
    return rows.map(toNote);
  },

  async byIds(db: Db, ids: string[]): Promise<NoteWithQuestions[]> {
    if (ids.length === 0) return [];
    const q = ids.map(() => '?').join(',');
    const rows = await db.all<NoteRow>(`SELECT * FROM notes WHERE id IN (${q})`, ids);
    return rows.map(toNote);
  },

  async setEnriched(
    db: Db,
    id: string,
    e: {
      summary: string;
      language: string;
      category: string | null;
      intent: string;
      confidence: number;
      status: NoteStatus;
      questions: EnrichQuestion[];
      now: number;
    },
  ) {
    // Respect a user-edited summary: only fill the gap.
    await db.run(
      `UPDATE notes SET
         summary = CASE WHEN summary_edited = 1 THEN summary ELSE ? END,
         language = ?, category = ?, intent = ?, confidence = ?, status = ?, questions = ?,
         enriched_at = ?, updated_at = ?
       WHERE id = ?`,
      [e.summary, e.language, e.category, e.intent, e.confidence, e.status, JSON.stringify(e.questions), e.now, e.now, id],
    );
    notifyChange('notes');
  },

  async setStatus(db: Db, id: string, status: NoteStatus, now: number, questions?: EnrichQuestion[]) {
    if (questions) {
      await db.run(`UPDATE notes SET status = ?, questions = ?, updated_at = ? WHERE id = ?`, [status, JSON.stringify(questions), now, id]);
    } else {
      await db.run(`UPDATE notes SET status = ?, updated_at = ? WHERE id = ?`, [status, now, id]);
    }
    notifyChange('notes');
  },

  async bumpAttempts(db: Db, id: string, now: number) {
    await db.run(`UPDATE notes SET enrich_attempts = enrich_attempts + 1, updated_at = ? WHERE id = ?`, [now, id]);
  },

  async setSummary(db: Db, id: string, summary: string, edited: boolean, now: number) {
    await db.run(`UPDATE notes SET summary = ?, summary_edited = ?, updated_at = ? WHERE id = ?`, [summary, edited ? 1 : 0, now, id]);
    notifyChange('notes');
  },

  async setArchived(db: Db, id: string, archived: boolean, now: number) {
    await db.run(`UPDATE notes SET archived = ?, updated_at = ? WHERE id = ?`, [archived ? 1 : 0, now, id]);
    notifyChange('notes');
  },

  async remove(db: Db, id: string) {
    await db.run(`DELETE FROM notes WHERE id = ?`, [id]);
    notifyChange('notes', 'triggers');
  },

  async entities(db: Db, noteId: string): Promise<Array<{ kind: string; value: string }>> {
    return db.all<{ kind: string; value: string }>(`SELECT kind, value FROM note_entities WHERE note_id = ?`, [noteId]);
  },

  /** Add one entity without disturbing the rest (replaceEntities wipes them all — enrich owns that path). */
  async addEntity(db: Db, noteId: string, e: { kind: string; value: string }) {
    await db.run(`INSERT OR IGNORE INTO note_entities (note_id, kind, value) VALUES (?, ?, ?)`, [noteId, e.kind, e.value]);
    notifyChange('notes');
  },

  async replaceEntities(db: Db, noteId: string, entities: Array<{ kind: string; value: string }>) {
    await db.run(`DELETE FROM note_entities WHERE note_id = ?`, [noteId]);
    for (const e of entities) {
      await db.run(`INSERT OR IGNORE INTO note_entities (note_id, kind, value) VALUES (?, ?, ?)`, [noteId, e.kind, e.value]);
    }
  },

  async keywordSearch(db: Db, query: string, limit = 30): Promise<NoteWithQuestions[]> {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2)
      .slice(0, 6);
    if (terms.length === 0) return [];
    const where = terms
      .map(
        () =>
          `(LOWER(n.raw_text) LIKE ? OR LOWER(COALESCE(n.summary,'')) LIKE ? OR EXISTS (SELECT 1 FROM note_entities e WHERE e.note_id = n.id AND LOWER(e.value) LIKE ?)
            OR EXISTS (SELECT 1 FROM triggers t WHERE t.note_id = n.id AND t.type = 'semantic' AND LOWER(t.payload) LIKE ?))`,
      )
      .join(' OR ');
    const params: string[] = [];
    for (const t of terms) params.push(`%${t}%`, `%${t}%`, `%${t}%`, `%${t}%`);
    const rows = await db.all<NoteRow>(`SELECT n.* FROM notes n WHERE n.archived = 0 AND (${where}) ORDER BY n.created_at DESC LIMIT ?`, [...params, limit]);
    return rows.map(toNote);
  },

  async count(db: Db): Promise<number> {
    const r = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM notes WHERE archived = 0`);
    return r?.c ?? 0;
  },
};
