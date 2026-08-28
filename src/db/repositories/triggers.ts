import type { Db } from '../index';
import { toTrigger, type TriggerRow } from '../rows';
import type { Trigger } from '@/domain/types';
import { notifyChange } from '@/lib/events';

export const triggersRepo = {
  async insert(db: Db, t: Trigger) {
    await db.run(
      `INSERT INTO triggers (id, note_id, type, payload, label, certainty, anchor_id, offset_days, fire_at, next_eval_at,
                             os_notification_id, state, fire_count, last_fired_at, user_edited, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        t.id,
        t.noteId,
        t.type,
        JSON.stringify(t.payload),
        t.label,
        t.certainty,
        t.anchorId,
        t.offsetDays,
        t.fireAt,
        t.nextEvalAt,
        t.osNotificationId,
        t.state,
        t.fireCount,
        t.lastFiredAt,
        t.userEdited ? 1 : 0,
        t.createdAt,
        t.updatedAt,
      ],
    );
    notifyChange('triggers');
  },

  /** Full-row upsert used by applyMutations after the pure reducer ran. */
  async upsert(db: Db, t: Trigger) {
    await db.run(
      `INSERT INTO triggers (id, note_id, type, payload, label, certainty, anchor_id, offset_days, fire_at, next_eval_at,
                             os_notification_id, state, fire_count, last_fired_at, user_edited, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type, payload = excluded.payload, label = excluded.label, certainty = excluded.certainty,
         anchor_id = excluded.anchor_id, offset_days = excluded.offset_days, fire_at = excluded.fire_at,
         next_eval_at = excluded.next_eval_at, os_notification_id = excluded.os_notification_id, state = excluded.state,
         fire_count = excluded.fire_count, last_fired_at = excluded.last_fired_at, user_edited = excluded.user_edited,
         updated_at = excluded.updated_at`,
      [
        t.id,
        t.noteId,
        t.type,
        JSON.stringify(t.payload),
        t.label,
        t.certainty,
        t.anchorId,
        t.offsetDays,
        t.fireAt,
        t.nextEvalAt,
        t.osNotificationId,
        t.state,
        t.fireCount,
        t.lastFiredAt,
        t.userEdited ? 1 : 0,
        t.createdAt,
        t.updatedAt,
      ],
    );
    notifyChange('triggers');
  },

  async byId(db: Db, id: string): Promise<Trigger | null> {
    const r = await db.get<TriggerRow>(`SELECT * FROM triggers WHERE id = ?`, [id]);
    return r ? toTrigger(r) : null;
  },

  async byNote(db: Db, noteId: string): Promise<Trigger[]> {
    const rows = await db.all<TriggerRow>(`SELECT * FROM triggers WHERE note_id = ? ORDER BY fire_at IS NULL, fire_at ASC, created_at ASC`, [noteId]);
    return rows.map(toTrigger);
  },

  async byAnchor(db: Db, anchorId: string): Promise<Trigger[]> {
    const rows = await db.all<TriggerRow>(`SELECT * FROM triggers WHERE anchor_id = ?`, [anchorId]);
    return rows.map(toTrigger);
  },

  /** Anchor triggers still waiting for a date (needs_input flow). */
  async pendingAnchor(db: Db, noteId: string): Promise<Trigger[]> {
    const rows = await db.all<TriggerRow>(`SELECT * FROM triggers WHERE note_id = ? AND type = 'anchor' AND anchor_id IS NULL`, [noteId]);
    return rows.map(toTrigger);
  },

  async allActive(db: Db): Promise<Trigger[]> {
    const rows = await db.all<TriggerRow>(`SELECT * FROM triggers WHERE state = 'active'`);
    return rows.map(toTrigger);
  },

  async upcoming(db: Db, from: number, to: number, limit = 200): Promise<Trigger[]> {
    const rows = await db.all<TriggerRow>(
      `SELECT * FROM triggers WHERE state = 'active' AND fire_at IS NOT NULL AND fire_at > ? AND fire_at <= ? ORDER BY fire_at ASC LIMIT ?`,
      [from, to, limit],
    );
    return rows.map(toTrigger);
  },

  async nextScheduled(db: Db, from: number, limit: number): Promise<Trigger[]> {
    const rows = await db.all<TriggerRow>(
      `SELECT * FROM triggers WHERE state = 'active' AND fire_at IS NOT NULL AND fire_at > ? ORDER BY fire_at ASC LIMIT ?`,
      [from, limit],
    );
    return rows.map(toTrigger);
  },

  async countActiveScheduled(db: Db, from: number): Promise<number> {
    const r = await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM triggers WHERE state = 'active' AND fire_at IS NOT NULL AND fire_at > ?`, [from]);
    return r?.c ?? 0;
  },

  async setOsId(db: Db, id: string, osId: string | null) {
    await db.run(`UPDATE triggers SET os_notification_id = ? WHERE id = ?`, [osId, id]);
  },

  async clearAllOsIds(db: Db) {
    await db.run(`UPDATE triggers SET os_notification_id = NULL WHERE state = 'active'`);
  },

  async setFireAt(db: Db, id: string, fireAt: number | null, now: number) {
    await db.run(`UPDATE triggers SET fire_at = ?, os_notification_id = NULL, updated_at = ? WHERE id = ?`, [fireAt, now, id]);
    notifyChange('triggers');
  },

  async bindAnchor(db: Db, id: string, anchorId: string, fireAt: number | null, payload: unknown, now: number) {
    await db.run(`UPDATE triggers SET anchor_id = ?, fire_at = ?, payload = ?, os_notification_id = NULL, updated_at = ? WHERE id = ?`, [
      anchorId,
      fireAt,
      JSON.stringify(payload),
      now,
      id,
    ]);
    notifyChange('triggers');
  },

  async markFired(db: Db, id: string, now: number, nextFireAt: number | null) {
    await db.run(
      `UPDATE triggers SET fire_count = fire_count + 1, last_fired_at = ?, fire_at = ?, os_notification_id = NULL,
              state = CASE WHEN ? IS NULL THEN 'fired' ELSE state END, updated_at = ? WHERE id = ?`,
      [now, nextFireAt, nextFireAt, now, id],
    );
    notifyChange('triggers');
  },

  /**
   * DEV only: undo firings that happened after `t`. Time travel calls markFired for real — it bumps
   * fire_count, flips one-offs to 'fired' and rolls yearly anchors to their next occurrence. Returning to
   * the present without this leaves reminders permanently spent, or dated a year further out than they are.
   *
   * fire_at is recomputed by the caller (anchors) or restored from last_fired_at (one-offs), so this only
   * clears the bookkeeping and reactivates what the future consumed.
   */
  async rewindFiringsAfter(db: Db, t: number): Promise<void> {
    await db.run(
      `UPDATE triggers SET fire_count = MAX(0, fire_count - 1), last_fired_at = NULL, os_notification_id = NULL,
              state = CASE WHEN state = 'fired' THEN 'active' ELSE state END
       WHERE last_fired_at > ?`,
      [t],
    );
    notifyChange('triggers');
  },

  async remove(db: Db, id: string) {
    await db.run(`DELETE FROM triggers WHERE id = ?`, [id]);
    notifyChange('triggers');
  },

  async removeMany(db: Db, ids: string[]) {
    if (ids.length === 0) return;
    const q = ids.map(() => '?').join(',');
    await db.run(`DELETE FROM triggers WHERE id IN (${q})`, ids);
    notifyChange('triggers');
  },
};
