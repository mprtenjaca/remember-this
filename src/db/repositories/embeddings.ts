import type { Db } from '../index';
import { fromBlob, toBlob } from '@/domain/search/cosine';

export interface EmbeddingDoc {
  noteId: string;
  vector: Float32Array;
}

export const embeddingsRepo = {
  async upsert(db: Db, noteId: string, model: string, vector: ArrayLike<number>, now: number) {
    await db.run(
      `INSERT INTO embeddings (note_id, model, dim, vector, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(note_id) DO UPDATE SET model = excluded.model, dim = excluded.dim, vector = excluded.vector, created_at = excluded.created_at`,
      [noteId, model, vector.length, toBlob(vector), now],
    );
  },

  async all(db: Db): Promise<EmbeddingDoc[]> {
    const rows = await db.all<{ note_id: string; vector: Uint8Array }>(
      `SELECT e.note_id, e.vector FROM embeddings e JOIN notes n ON n.id = e.note_id WHERE n.archived = 0`,
    );
    return rows.map((r) => ({ noteId: r.note_id, vector: fromBlob(r.vector) }));
  },

  async has(db: Db, noteId: string): Promise<boolean> {
    const r = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM embeddings WHERE note_id = ?`, [noteId]);
    return (r?.c ?? 0) > 0;
  },

  async count(db: Db): Promise<number> {
    const r = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM embeddings`);
    return r?.c ?? 0;
  },
};
