// Db abstraction over expo-sqlite. Domain code depends on the `Db` interface only.
//
// Concurrency model: ONE connection, ALL access serialized through a JS mutex.
// expo-sqlite's withExclusiveTransactionAsync opens a second connection, and any write on the
// main connection while that transaction is open fails with "database is locked" (SQLITE_BUSY).
// Live-query hooks re-fetch on every change event, so that race is guaranteed. Serializing in JS
// makes every read/write/transaction atomic w.r.t. each other; the app is far below the scale
// where this costs anything.
//
// ⚠ Inside `transaction(fn)` use ONLY the `tx` handle. Calling `db()` from within the callback
// would wait for the lock the transaction holds → deadlock.

import * as SQLite from 'expo-sqlite';
import { SQL_001 } from './schema/001_init';
import { SQL_002 } from './schema/002_anchor_labels';

export type Param = string | number | null | Uint8Array;

export interface Db {
  get<T>(sql: string, params?: Param[]): Promise<T | null>;
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
  run(sql: string, params?: Param[]): Promise<void>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  { version: 1, sql: SQL_001 },
  { version: 2, sql: SQL_002 },
];

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    return prev.then(fn).finally(release);
  }
}

class ExpoDb implements Db {
  constructor(
    private readonly h: SQLite.SQLiteDatabase,
    private readonly mutex: Mutex | null, // null → we are inside a transaction that already holds the lock
  ) {}

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex ? this.mutex.run(fn) : fn();
  }

  get<T>(sql: string, params: Param[] = []) {
    return this.locked(() => this.h.getFirstAsync<T>(sql, params as SQLite.SQLiteBindParams));
  }
  all<T>(sql: string, params: Param[] = []) {
    return this.locked(() => this.h.getAllAsync<T>(sql, params as SQLite.SQLiteBindParams));
  }
  run(sql: string, params: Param[] = []) {
    return this.locked(async () => {
      await this.h.runAsync(sql, params as SQLite.SQLiteBindParams);
    });
  }
  exec(sql: string) {
    return this.locked(() => this.h.execAsync(sql));
  }
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
    if (!this.mutex) return fn(this); // nested → join the outer transaction
    return this.mutex.run(async () => {
      await this.h.execAsync('BEGIN IMMEDIATE');
      try {
        const out = await fn(new ExpoDb(this.h, null));
        await this.h.execAsync('COMMIT');
        return out;
      } catch (e) {
        await this.h.execAsync('ROLLBACK').catch(() => undefined);
        throw e;
      }
    });
  }
}

export const DB_NAME = 'rememberthis.db';

// The open handle lives on globalThis so it survives Fast Refresh: when Metro re-evaluates this
// module, a plain module-level variable would reset to null while mounted components keep calling db().
type Slot = { instance: Db | null; opening: Promise<Db> | null };
const slot: Slot = ((globalThis as unknown as { __rememberThisDb?: Slot }).__rememberThisDb ??= { instance: null, opening: null });

export async function openDb(): Promise<Db> {
  if (slot.instance) return slot.instance;
  if (slot.opening) return slot.opening;
  slot.opening = (async () => {
    const h = await SQLite.openDatabaseAsync(DB_NAME);
    await h.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    const db = new ExpoDb(h, new Mutex());
    await migrate(db);
    slot.instance = db;
    return db;
  })().catch((e) => {
    slot.opening = null;
    throw e;
  });
  return slot.opening;
}

export function db(): Db {
  if (!slot.instance) throw new Error('DB not opened — call openDb() in the root layout first');
  return slot.instance;
}

export async function migrate(db: Db) {
  const hasMeta = await db.get<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table' AND name='meta'`);
  let version = 0;
  if (hasMeta) {
    const row = await db.get<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`);
    version = Number(row?.value ?? 0);
  }
  for (const m of MIGRATIONS) {
    if (m.version <= version) continue;
    await db.exec(m.sql);
    await db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)`, [String(m.version)]);
  }
}

/** DEV only: wipe everything (debug screen). */
export async function resetDb() {
  const d = db();
  await d.exec(`
    DELETE FROM debug_scheduled; DELETE FROM geofence_slots; DELETE FROM surfacings; DELETE FROM edits;
    DELETE FROM embeddings; DELETE FROM note_entities; DELETE FROM triggers; DELETE FROM anchors; DELETE FROM notes;
  `);
}
