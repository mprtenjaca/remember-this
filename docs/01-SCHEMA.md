# Schema and types

Migrations are **append-only**. Never edit an existing migration file —
add `002_*.ts`. The runner (`src/db/index.ts`) reads `meta.schema_version`.

The SQL lives as a TS string in `src/db/schema/001_init.ts` (Metro does not import `.sql`).
That file is the source of truth; this is an overview with rationale.

## Deliberate deviations from the original spec

| What | Why |
|---|---|
| `notes.questions TEXT` (JSON) | The clarify card needs the questions between enrich and the answer; without the column they would have to be regenerated. |
| `edits.inverse TEXT` (JSON) | Undo applies a stored inverse instead of deriving it from `before` — simpler and exact for `set_time`, which changes the trigger type. |
| `triggers.anchor_id ... ON DELETE SET NULL` (not CASCADE) | Deleting an anchor must not delete note-bound reminders; they fall back to "waiting for a date". |
| `debug_scheduled` table | `MockScheduler` (Phase A) writes what it WOULD schedule; the debug timeline shows it. |
| `AnchorPayload.person/kind` | Temporarily in the payload while the anchor is unresolved (`anchor_id IS NULL`). `answerAnchor()` strips them when binding. |

---

## Tables

### notes
`raw_text` never changes. `summary` is filled by the LLM or the user (`summary_edited = 1` → enrich no longer touches it).
`status`: `pending | enriched | failed | needs_input`. `enrich_attempts` for backoff.

### note_entities
`(note_id, kind, value)` — `kind` ∈ person | org | place | keyword. Keyword search uses them.

### embeddings
`vector BLOB` = `Float32Array` (768 × 4 B = 3 KB). `fromBlob()` copies for 4-byte alignment.

### anchors
Named points in time that triggers bind to relatively. `month_day 'MM-DD'` recurring; `year` only for `oneoff`.
`UNIQUE (person, kind) WHERE person IS NOT NULL` — one person = one birthday.

### triggers — SOURCE OF TRUTH
`os_notification_id` is only a cache (NULL after reinstall). `payload` is JSON per type (see types).
`fire_at` epoch ms resolved through the **local calendar** (DST-safe). `user_edited` — enrich never overwrites.
Indexes: `fire_at WHERE active`, `next_eval_at WHERE active`, `note_id`, `anchor_id`.

### surfacings
Every display + reaction (`useful | not_now | wrong | done | ignored`). Feeds the daily cap (`idx_surf_day`),
per-note cooldown and the adaptive threshold. Channels: `notification | today | inline_search | digest` —
only the first two count towards fatigue.

### edits
Audit trail since M1. `before` snapshot, `after` = mutations, `inverse` = mutations for undo, `source` ∈ manual | ai_chat | enrich | learned.

### prefs
Learned defaults: `hour.default`, `threshold.semantic`, `lead_time.<intent>`. `learned = 1` if derived from behaviour.

### geofence_slots
Which regions are CURRENTLY registered in the OS (iOS max 20). M5.

---

## TS types — `src/domain/types.ts`

Key decisions:

- **Payload is flat per type**; the discriminated union `TriggerPayload` is only for typing; JSON in the DB.
- **`Mutation`** is the only path that changes state. The same types are the tooling for the AI chat (function calling):
  `set_time | shift_offset | add_trigger | remove_trigger | set_state | set_anchor | edit_summary | set_keywords`.
- **`EnrichResult`** is the shape of the LLM output (and of the heuristic enricher) — flat nullable fields because Gemini `responseSchema` has no `anyOf`.
- `CERTAINTY_VALUE`: low 0.3 · medium 0.6 · high 0.9.

## Clock — `src/domain/clock.ts`

The single source of time. `clock.now()` delegates to `SystemClock` or `FakeClock` (the debug timeline calls `setClock()`).
Tests pin `process.env.TZ = 'Europe/Zagreb'` in `vitest.config.mts`.

## Mutations — `src/domain/mutations.ts` + `src/db/applyMutations.ts`

The pure reducer `reduce(state, m, now, newId)` returns the new state, `before`, `inverse`, `touchedTriggerIds`, `touchedAnchorId`.
`applyMutations(noteId, muts, source)` in a transaction: cancel OS notifications of touched triggers → write anchor/trigger/summary changes
(re-resolve `fire_at` for anchor triggers, **also in other notes** bound to the same anchor) → `user_edited = 1` for manual/ai_chat →
`edits` row → `refillScheduledWindow()`.
`undoLast(noteId)` applies the stored `inverse`.

## Resolve — `src/domain/triggers/resolve.ts`

- `nextOccurrence('MM-DD')`: today counts as "this year"; passed → next year.
- `resolveAnchorTrigger(anchor, offset, {hour, minute}, clock)`: recurring always yields a **future** firing
  (if the offset already passed, it goes to next year); a past one-off → `null`.
- `DEFAULT_CHAINS`: gift/birthday `[-21, -7, -1]`, anniversary `[-14, -3]`, annual `[-30, -7]`, oneoff `[-7, -1]`.
- `DEFAULT_ANCHOR_TIME` 19:00 — when people shop.

## Scoring — `src/domain/triggers/scoring.ts`

```
score = 0.55·cosine + 0.20·certainty + 0.15·recencyRelevance + 0.10·categoryFeedback − fatiguePenalty
```
Adaptive threshold starts at 0.62, 👎 +0.05, 👍 −0.03, "not now" +0.01, clamped to [0.45, 0.85], stored in `prefs.threshold.semantic`.

`FATIGUE`: maxPushPerDay 2 · quietHours [21, 8) · maxFiresPerNote 3 · cooldownDays [7, 30, ∞].
