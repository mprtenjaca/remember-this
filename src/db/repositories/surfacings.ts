import type { Db } from '../index';
import { toSurfacing, type SurfacingRow } from '../rows';
import type { Reaction, Surfacing, SurfacingChannel } from '@/domain/types';
import { notifyChange } from '@/lib/events';

export const surfacingsRepo = {
  async insert(db: Db, s: { id: string; noteId: string; triggerId: string | null; channel: SurfacingChannel; score: number | null; now: number }) {
    await db.run(`INSERT INTO surfacings (id, note_id, trigger_id, channel, score, shown_at) VALUES (?,?,?,?,?,?)`, [
      s.id,
      s.noteId,
      s.triggerId,
      s.channel,
      s.score,
      s.now,
    ]);
    notifyChange('surfacings');
  },

  async react(db: Db, id: string, reaction: Reaction, now: number) {
    await db.run(`UPDATE surfacings SET reaction = ?, reacted_at = ? WHERE id = ?`, [reaction, now, id]);
    notifyChange('surfacings');
  },

  async byId(db: Db, id: string): Promise<Surfacing | null> {
    const r = await db.get<SurfacingRow>(`SELECT * FROM surfacings WHERE id = ?`, [id]);
    return r ? toSurfacing(r) : null;
  },

  async recent(db: Db, since: number): Promise<Surfacing[]> {
    const rows = await db.all<SurfacingRow>(`SELECT * FROM surfacings WHERE shown_at >= ? ORDER BY shown_at DESC`, [since]);
    return rows.map(toSurfacing);
  },

  async all(db: Db): Promise<Surfacing[]> {
    const rows = await db.all<SurfacingRow>(`SELECT * FROM surfacings ORDER BY shown_at DESC`);
    return rows.map(toSurfacing);
  },

  async byNote(db: Db, noteId: string): Promise<Surfacing[]> {
    const rows = await db.all<SurfacingRow>(`SELECT * FROM surfacings WHERE note_id = ? ORDER BY shown_at DESC`, [noteId]);
    return rows.map(toSurfacing);
  },

  /**
   * Open (un-reacted) Today-channel surfacings, one per note, newest first.
   *
   * Bounded at BOTH ends. The upper bound is not pedantry: a surfacing stamped in the future stayed
   * permanently "open" (`shown_at >= since` is trivially true for it), so it appeared on Today every day
   * until reacted to. Dev time travel writes exactly such rows — jump six months, come back, and a reminder
   * due in January was sitting on today's screen. The rule itself is `isOpenOnToday()` in
   * domain/triggers/evaluate.ts, where it has tests; this WHERE clause must keep matching it.
   */
  async openToday(db: Db, since: number, until: number): Promise<Surfacing[]> {
    const rows = await db.all<SurfacingRow>(
      `SELECT s.* FROM surfacings s
       WHERE s.channel IN ('today','notification') AND s.shown_at >= ? AND s.shown_at <= ? AND s.reaction IS NULL
         AND s.rowid = (SELECT MAX(rowid) FROM surfacings x WHERE x.note_id = s.note_id AND x.channel IN ('today','notification'))
       ORDER BY s.shown_at DESC`,
      [since, until],
    );
    return rows.map(toSurfacing);
  },

  /**
   * DEV only: drop surfacings stamped after `t`. Time travel fires reminders for real, and coming back to
   * the present must not leave the future's paperwork behind.
   */
  async removeAfter(db: Db, t: number): Promise<void> {
    await db.run(`DELETE FROM surfacings WHERE shown_at > ?`, [t]);
  },

  async reactionsForCategory(db: Db, category: string): Promise<Reaction[]> {
    const rows = await db.all<{ reaction: string }>(
      `SELECT s.reaction FROM surfacings s JOIN notes n ON n.id = s.note_id WHERE n.category = ? AND s.reaction IS NOT NULL ORDER BY s.reacted_at DESC LIMIT 50`,
      [category],
    );
    return rows.map((r) => r.reaction as Reaction);
  },
};
