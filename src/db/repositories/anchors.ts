import type { Db } from '../index';
import { toAnchor, type AnchorRow } from '../rows';
import type { Anchor, AnchorKind } from '@/domain/types';
import { notifyChange } from '@/lib/events';

export const anchorsRepo = {
  async insert(db: Db, a: Anchor) {
    await db.run(
      `INSERT INTO anchors (id, label, person, kind, month_day, year, contact_id, source, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [a.id, a.label, a.person, a.kind, a.monthDay, a.year, a.contactId, a.source, a.createdAt, a.updatedAt],
    );
    notifyChange('anchors');
  },

  async byId(db: Db, id: string): Promise<Anchor | null> {
    const r = await db.get<AnchorRow>(`SELECT * FROM anchors WHERE id = ?`, [id]);
    return r ? toAnchor(r) : null;
  },

  async byIds(db: Db, ids: string[]): Promise<Anchor[]> {
    if (ids.length === 0) return [];
    const q = ids.map(() => '?').join(',');
    const rows = await db.all<AnchorRow>(`SELECT * FROM anchors WHERE id IN (${q})`, ids);
    return rows.map(toAnchor);
  },

  async byPersonKind(db: Db, person: string, kind: AnchorKind): Promise<Anchor | null> {
    const r = await db.get<AnchorRow>(`SELECT * FROM anchors WHERE LOWER(person) = LOWER(?) AND kind = ?`, [person, kind]);
    return r ? toAnchor(r) : null;
  },

  async all(db: Db): Promise<Anchor[]> {
    const rows = await db.all<AnchorRow>(`SELECT * FROM anchors ORDER BY person ASC`);
    return rows.map(toAnchor);
  },

  async setDate(db: Db, id: string, monthDay: string | null, year: number | null, now: number) {
    await db.run(`UPDATE anchors SET month_day = ?, year = ?, updated_at = ? WHERE id = ?`, [monthDay, year, now, id]);
    notifyChange('anchors');
  },

  /** Provenance decides who may overwrite the date later: 'user' outranks 'inferred'/'contacts'. */
  async setSource(db: Db, id: string, source: Anchor['source'], now: number) {
    await db.run(`UPDATE anchors SET source = ?, updated_at = ? WHERE id = ?`, [source, now, id]);
    notifyChange('anchors');
  },

  async remove(db: Db, id: string) {
    await db.run(`DELETE FROM anchors WHERE id = ?`, [id]);
    notifyChange('anchors', 'triggers');
  },
};
