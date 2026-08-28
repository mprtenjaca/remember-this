// FAZA A — Expo Go. Writes what WOULD be scheduled into debug_scheduled so the
// debug timeline can show it. Simulates the iOS 64-slot limit from day one.

import { db } from '@/db';
import { newId } from '@/lib/ids';
import { clock } from '@/domain/clock';
import type { ScheduledInfo, ScheduledNotification, Scheduler } from './types';

export const MockScheduler: Scheduler = {
  kind: 'mock',

  async schedule(n: ScheduledNotification) {
    const id = `mock_${newId()}`;
    await db().run(`INSERT INTO debug_scheduled (id, trigger_id, fire_at, title, body, created_at) VALUES (?,?,?,?,?,?)`, [
      id,
      n.triggerId,
      n.fireAt,
      n.title,
      n.body,
      clock.now(),
    ]);
    if (__DEV__) console.log(`[mock-scheduler] ${new Date(n.fireAt).toISOString()} → ${n.title}`);
    return id;
  },

  async cancel(osId: string) {
    await db().run(`DELETE FROM debug_scheduled WHERE id = ?`, [osId]);
  },

  async cancelAll() {
    await db().run(`DELETE FROM debug_scheduled`);
  },

  async listScheduled(): Promise<ScheduledInfo[]> {
    const rows = await db().all<{ id: string; trigger_id: string; fire_at: number }>(`SELECT id, trigger_id, fire_at FROM debug_scheduled ORDER BY fire_at ASC`);
    return rows.map((r) => ({ osId: r.id, triggerId: r.trigger_id, fireAt: r.fire_at }));
  },

  capacity: () => 64,
};
