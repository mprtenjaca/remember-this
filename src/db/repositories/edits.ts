import type { Db } from '../index';
import { toEdit, type EditRow } from '../rows';
import type { EditSource, Mutation } from '@/domain/types';
import { notifyChange } from '@/lib/events';

export const editsRepo = {
  async insert(
    db: Db,
    e: { id: string; noteId: string; target: string; before: unknown; after: Mutation[]; inverse: Mutation[]; source: EditSource; now: number },
  ) {
    await db.run(
      `INSERT INTO edits (id, note_id, target, before, after, inverse, source, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [e.id, e.noteId, e.target, JSON.stringify(e.before ?? null), JSON.stringify(e.after), JSON.stringify(e.inverse), e.source, e.now],
    );
    notifyChange('edits');
  },

  async last(db: Db, noteId: string) {
    const r = await db.get<EditRow>(`SELECT * FROM edits WHERE note_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`, [noteId]);
    return r ? toEdit(r) : null;
  },

  async byNote(db: Db, noteId: string, limit = 50) {
    const rows = await db.all<EditRow>(`SELECT * FROM edits WHERE note_id = ? ORDER BY created_at DESC LIMIT ?`, [noteId, limit]);
    return rows.map(toEdit);
  },

  async remove(db: Db, id: string) {
    await db.run(`DELETE FROM edits WHERE id = ?`, [id]);
    notifyChange('edits');
  },

  /** Count of manual lead-time changes per intent — after 2, the default is learned. */
  async countOffsetEdits(db: Db, source: EditSource = 'manual'): Promise<number> {
    const r = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM edits WHERE source = ? AND after LIKE '%"shift_offset"%'`, [source]);
    return r?.c ?? 0;
  },
};
