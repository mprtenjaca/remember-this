// Migration 001 — append-only. Never edit this file; add 002_*.ts instead.
// Metro cannot import .sql files without extra config, so the SQL lives in a TS string.

export const SQL_001 = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ─────────────────────────────────────────── notes

CREATE TABLE IF NOT EXISTS notes (
  id              TEXT PRIMARY KEY,
  raw_text        TEXT NOT NULL,
  summary         TEXT,
  language        TEXT,
  category        TEXT,
  intent          TEXT,
  confidence      REAL,
  status          TEXT NOT NULL DEFAULT 'pending',
  summary_edited  INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'typed',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  enriched_at     INTEGER,
  enrich_attempts INTEGER NOT NULL DEFAULT 0,
  questions       TEXT
);

CREATE INDEX IF NOT EXISTS idx_notes_status  ON notes(status) WHERE status != 'enriched';
CREATE INDEX IF NOT EXISTS idx_notes_active  ON notes(archived, created_at DESC);

CREATE TABLE IF NOT EXISTS note_entities (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (note_id, kind, value)
);
CREATE INDEX IF NOT EXISTS idx_entities_value ON note_entities(kind, value);

CREATE TABLE IF NOT EXISTS embeddings (
  note_id    TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  dim        INTEGER NOT NULL,
  vector     BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

-- ─────────────────────────────────────────── anchors

CREATE TABLE IF NOT EXISTS anchors (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  person     TEXT,
  kind       TEXT NOT NULL,
  month_day  TEXT,
  year       INTEGER,
  contact_id TEXT,
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_anchor_person_kind
  ON anchors(person, kind) WHERE person IS NOT NULL;

-- ─────────────────────────────────────────── triggers (SOURCE OF TRUTH)

CREATE TABLE IF NOT EXISTS triggers (
  id                 TEXT PRIMARY KEY,
  note_id            TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  type               TEXT NOT NULL,
  payload            TEXT NOT NULL,
  label              TEXT,
  certainty          REAL NOT NULL DEFAULT 0.5,
  anchor_id          TEXT REFERENCES anchors(id) ON DELETE SET NULL,
  offset_days        INTEGER,
  fire_at            INTEGER,
  next_eval_at       INTEGER,
  os_notification_id TEXT,
  state              TEXT NOT NULL DEFAULT 'active',
  fire_count         INTEGER NOT NULL DEFAULT 0,
  last_fired_at      INTEGER,
  user_edited        INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trig_fire   ON triggers(fire_at)      WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_trig_eval   ON triggers(next_eval_at) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS idx_trig_note   ON triggers(note_id);
CREATE INDEX IF NOT EXISTS idx_trig_anchor ON triggers(anchor_id)    WHERE anchor_id IS NOT NULL;

-- ─────────────────────────────────────────── surfacings

CREATE TABLE IF NOT EXISTS surfacings (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  trigger_id TEXT,
  channel    TEXT NOT NULL,
  score      REAL,
  shown_at   INTEGER NOT NULL,
  reaction   TEXT,
  reacted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_surf_note ON surfacings(note_id, shown_at DESC);
CREATE INDEX IF NOT EXISTS idx_surf_day  ON surfacings(shown_at);

-- ─────────────────────────────────────────── edits (audit trail, undo)

CREATE TABLE IF NOT EXISTS edits (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL,
  target     TEXT NOT NULL,
  before     TEXT,
  after      TEXT,
  inverse    TEXT,
  source     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edits_note ON edits(note_id, created_at DESC);

-- ─────────────────────────────────────────── prefs (learned defaults)

CREATE TABLE IF NOT EXISTS prefs (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  learned    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- ─────────────────────────────────────────── geofence_slots (iOS max 20)

CREATE TABLE IF NOT EXISTS geofence_slots (
  trigger_id    TEXT PRIMARY KEY REFERENCES triggers(id) ON DELETE CASCADE,
  region_id     TEXT NOT NULL,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  radius        REAL NOT NULL,
  registered_at INTEGER NOT NULL
);

-- ─────────────────────────────────────────── debug_scheduled (MockScheduler, Faza A)

CREATE TABLE IF NOT EXISTS debug_scheduled (
  id         TEXT PRIMARY KEY,
  trigger_id TEXT NOT NULL,
  fire_at    INTEGER NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1');
`;
