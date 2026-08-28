import type { Db } from '../index';
import { notifyChange } from '@/lib/events';

export const PREF = {
  hourDefault: 'hour.default',
  thresholdSemantic: 'threshold.semantic',
  leadTime: (intent: string) => `lead_time.${intent}`,
  theme: 'ui.theme',
  onboarded: 'ui.onboarded',
  /** '1' once the user has seen (or dismissed) the "what happens next" explainer. The 💡 button re-opens it. */
  explainerSeen: 'ui.explainer_seen',
  installId: 'install_id',
} as const;

export const prefsRepo = {
  async get(db: Db, key: string): Promise<string | null> {
    const r = await db.get<{ value: string }>(`SELECT value FROM prefs WHERE key = ?`, [key]);
    return r?.value ?? null;
  },

  async getNumber(db: Db, key: string, fallback: number): Promise<number> {
    const v = await this.get(db, key);
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
  },

  async all(db: Db): Promise<Record<string, string>> {
    const rows = await db.all<{ key: string; value: string }>(`SELECT key, value FROM prefs`);
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  },

  async set(db: Db, key: string, value: string, now: number, learned = false) {
    await db.run(
      `INSERT INTO prefs (key, value, learned, updated_at) VALUES (?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, learned = excluded.learned, updated_at = excluded.updated_at`,
      [key, value, learned ? 1 : 0, now],
    );
    notifyChange('prefs');
  },

  async remove(db: Db, key: string) {
    await db.run(`DELETE FROM prefs WHERE key = ?`, [key]);
    notifyChange('prefs');
  },
};
