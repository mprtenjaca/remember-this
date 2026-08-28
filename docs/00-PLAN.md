# Development plan

## The order is deliberate

Constraint: **Expo Go only (SDK 54)**, dev build in ~7 days. That is not a problem, it is a schedule.
Everything in M0–M3 works in Expo Go. Nothing in M0–M3 needs a native build.

But first — **you may not have to wait**:

| You have | Do this | Cost |
|---|---|---|
| Mac + Xcode | `npx expo run:ios` → simulator dev build | free, unlimited |
| Android Studio | `npx expo run:android` → emulator | free, unlimited |
| Neither | wait for EAS, do M0–M3 meanwhile | — |

A local build **does not burn EAS credits**. An iOS simulator build doesn't even need an Apple Developer account.
Local scheduled notifications **work in the iOS simulator**, and geofencing is simulated via
Xcode → Debug → Simulate Location. That covers ~80% of what you think you have to wait for.

If you go EAS: **install every native dependency at once before the first build**
(list in `docs/03-NATIVE.md` § Burn list). One dev build covers all later JS work —
but only if you didn't forget a package.

---

## Status (2026-08-25)

| Milestone | State |
|---|---|
| M0 harness | 🟡 59 real fixtures, runs through the deployed worker (`--proxy`, Groq). After the `reconcile` policy layer: 0 errors, schema 100 %, trigger types 100 %, recall 100 %, questions 0.15/note, **intent 86 % (gate 90 %)**. p95 latency fails only on 429-retry waits. Re-run after the latest rules. |
| M1 domain engine | ✅ 116 tests green. All acceptance tests below covered. |
| M2 Capture + Today | 🟡 Implemented and device-tested iteratively (voice capture via Whisper, drafts, same-day "Danas još N" card). Manual acceptance list below still to be ticked. |
| M3 Detail + edit | 🟡 Summary edit, `DatePickerSheet`, + reminder, delete/done, undo, anchor date change with propagation dialog, actions list. Swipe-to-delete remains. |
| M4+ | ⏳ needs a dev build |

See `docs/records/2026-08-25-enrichment-policy-layer.md` for why the model output now goes through `normalize → reconcile → ingest`.

---

## M0 — Prompt harness (first, no RN)

**Why first:** if Gemini doesn't guess the triggers, the whole UX above collapses. This is the gate.
No point building 40 screens around a model that returns three questions for every note.

Node CLI in `p0-harness/`. No RN, no UI. Spec in `docs/02-AI-LAYER.md`.

### Tasks
- [ ] `p0-harness/fixtures/notes.jsonl` — **50 real notes** (the user writes them, do not generate them)
- [ ] For each: `expected_triggers`, `acceptable_questions`
- [x] `enrich.ts` — Gemini call with `responseSchema` (+ `--heuristic` baseline)
- [x] `eval.ts` — metrics + markdown report
- [x] `npm run p0` — results table

### Metrics and gate

| Metric | Gate | Target |
|---|---|---|
| Avg questions / note | < 0.8 | **< 0.4** |
| Notes with 0 questions | > 60% | > 75% |
| Proposed options contain the right answer | > 80% | > 90% |
| Semantic keywords hit the later query | > 70% | > 85% |
| Valid JSON | 100% | 100% |
| p50 latency | < 2.5s | < 1.5s |

**Gate fails → iterate the prompt, don't build the app.** Average questions is the most important
metric in the whole project; it is the difference between an external brain and yet another todo app.

---

## M1 — Domain engine (Expo Go, no UI)

The whole trigger engine as pure TypeScript logic, tested with Vitest.
Zero native dependencies. This is where the brain is written.

### Tasks
- [x] `expo init` + expo-router + TS strict
- [x] `src/db/` — migration runner, `001_init` (see `docs/01-SCHEMA.md`)
- [x] Repositories: notes, triggers, anchors, prefs, edits, surfacings, embeddings
- [x] `domain/clock.ts` — `SystemClock` + `FakeClock` + swappable `clock`
- [x] `domain/triggers/resolve.ts` — anchor + offset → `fire_at`, with `nextOccurrence()`
- [x] `domain/triggers/evaluate.ts` — which triggers fire in window [t1, t2] + anti-fatigue plan
- [x] `domain/mutations.ts` — pure reducer + inverse; `db/applyMutations.ts` — `edits` audit, undo
- [x] `domain/triggers/scoring.ts` — relevance score + fatigue penalty + adaptive threshold
- [x] `Scheduler` interface + `MockScheduler`

### Acceptance
- [x] Test: birthday 14.03., offset −21 → `fire_at` = 21.02. 19:00 **in the local timezone**
- [x] Test: birthday already passed this year → next year
- [x] Test: DST transition does not move the firing time
- [x] Test: changing an anchor moves **all** bound triggers (reducer `touchedTriggerIds`)
- [x] Test: enrich does not overwrite a trigger with `user_edited = 1`
- [x] Test: `FakeClock` + 12 months forward → correct firing sequence
- [x] `npm test` green without a single native module

---

## M2 — Capture + Today (Expo Go, first visible app)

### Tasks
- [x] `capture.tsx` — instant capture, sheet closes before the LLM
- [x] Background enrich queue with retry (3×, exponential backoff), offline-safe, heuristic fallback
- [x] Clarify card — **not a modal**, appears in the Today list when enrich needs input
- [x] Anchor flow: contacts lookup → fallback date picker → write to `anchors` + bind pending triggers
- [x] Today screen: what is relevant today + pending clarify + next 90 days
- [x] Timeline + search (keyword always; embedding cosine when a proxy exists)
- [x] Feedback: 👍 / "not now" / 👎 / ✓ → `surfacings.reaction` → adaptive threshold
- [x] **`_debug/timeline.tsx`** — time travel: jump +1d/+1w/+1m/+6m and see what would fire

### Acceptance (manual check on a device)
- [ ] Capture a note in airplane mode → saved, enrich runs when the network returns
- [ ] p95 from tapping "Spremi" to sheet close < 150 ms (DEV log `[capture] save → close`)
- [ ] Debug timeline: "Seed 4 primjera", jump to 21.02. → you see 3 reminders for Ana
- [ ] Without `READ_CONTACTS` permission → date picker, the flow does not break
- [ ] Search "poklon" finds a note from 5 months ago

---

## M3 — Detail + edit (Expo Go)

### Tasks
- [x] `note/[id].tsx` — inline summary edit, list of reminders
- [x] Time edit — **native picker** (`DateTimePickerAndroid` / iOS inline)
- [ ] Swipe-to-delete (now: tap → native Alert with actions) + Undo snackbar ✅
- [x] `+` add a reminder manually
- [x] Anchor edit with propagation: *"Ovo pomiče 4 podsjetnika u 3 bilješke"* → confirm (note detail → Datumi row / reminder menu)
- [x] Guard: edit into the past → "Next year or right now?"
- [x] All changes through `applyMutations()`, `user_edited = 1`

### Acceptance
- [x] Time edit → `os_notification_id` invalidated, `refillScheduledWindow()` called
- [x] Re-enrich after a manual edit does not change that trigger
- [x] Undo restores exactly the previous state (`reduceAll` inverse test)

---

# ⬇ Everything below needs a dev build ⬇

## M4 — Notifications (day one with the dev build)

Replace `MockScheduler` → `ExpoScheduler`. Domain code is **not touched**.

### Tasks
- [ ] `ExpoScheduler` implements the same interface (`src/services/notifications/types.ts`)
- [x] `refillScheduledWindow()` — rotating 64-slot window (iOS limit) — already works with the mock
- [ ] `rehydrateNotifications()` on every launch — install-id detection
- [ ] Notification categories: "Kupljeno ✓" / "+7 dana" / "Uredi"
- [ ] **Custom notification sound** — the same ding as the in-app confirmation
      (`assets/dragon-studio-ding-sfx-472366.mp3`, played in-app by `src/services/sound`). Expo Go cannot
      deliver a custom sound, so this waits for the dev build. Needs: the file bundled via the
      `expo-notifications` plugin `sounds` array in `app.json`, `sound: '<filename>'` on the content, and an
      Android channel created WITH that sound — an Android channel's sound is frozen at creation, so
      changing it later requires a new channel id, not an edit.
- [ ] Background handler for actions without opening the app
- [ ] Android 13+ `POST_NOTIFICATIONS` permission in onboarding, not on cold start

### Acceptance
- [ ] Schedule 80 triggers → exactly 50 in the OS, the rest waits in the DB
- [ ] Delete the app, reinstall with the same DB → `rehydrate()` restores everything
- [ ] Tap "Kupljeno" in the notification → rest of the chain cancelled, app does not open
- [ ] Notification arrives to the second in airplane mode

---

## M5 — Location + voice

- [ ] Geofence rotating pool: 19 nearest + 1 re-eval region (20 km)
- [ ] `expo-background-task` daily refill as a fallback
- [ ] On-device voice input (zero API cost)
- [ ] Share sheet / Quick Settings tile
- [ ] **Acceptance:** 40 location triggers → never more than 20 registered regions

---

## M6 — Sync (moved from P4 — this is not a premium feature)

Changing phones loses everything. `iCloud`/Android backup is unreliable, cross-platform doesn't work.
This product lives on trust; if it loses notes once, it is dead.

- [ ] Turso or Supabase, E2E-encrypted blobs
- [ ] Sync on login → `rehydrate()` reschedules everything
- [ ] Embeddings stay local, **not** synced (regenerate on the new device)
- [ ] **Acceptance:** new phone, login → all notes and reminders alive

---

## M7 — AI chat edit

- [ ] Function calling with `Mutation` types (`docs/02-AI-LAYER.md`)
- [ ] Diff preview + [Primijeni] / [Odustani] (`describeMutation()` already yields the lines)
- [ ] Offline: chat locked with a clear empty state, manual edit works
- [ ] **Acceptance:** "move everything a week earlier and add a reminder at the mall"
      → correct diff, one tap to apply

---

## M8 — Polish

- [ ] All 3 themes + Skia theme-switch reveal (themes exist, no picker in settings yet)
- [ ] Android dynamic color (Material 3)
- [ ] SF Symbols on iOS
- [ ] Onboarding that produces the **first correct resurface within 5 minutes** (import 3 old notes)
- [ ] Silent push for content refresh + 64-slot refill
- [ ] Widget, Siri shortcut

---

## Cost

| | Free | At scale |
|---|---|---|
| Gemini 2.5 Flash | dev + first ~200 users | ~$0.0002 / note (2 calls) |
| Embeddings | same | negligible |
| Cloudflare Worker | 100k req/day | probably never |
| EAS Build | limited monthly count | ~$19/mo |

1000 active × 10 notes/mo ≈ **$2–4/mo**. The economics work.
Check current EAS and Gemini free-tier limits before launch — they change.

---

## Risks

| Risk | Mitigation |
|---|---|
| **Notification fatigue** — one miss and the user turns notifications off | hard caps + adaptive threshold + "better to miss" |
| **Cold start** — the app is empty for 3 weeks | onboarding import, first resurface in 5 min |
| **iOS 64-notif / 20-geofence limit** | rotating windows, same pattern for both |
| **iOS background unreliability** | pre-scheduled notifications, not runtime evaluation |
| **Changing phones** | M6 sync + `rehydrate()` |
| **Cloud AI vs privacy** | send only text without IDs; local-only mode as a Pro feature later |
| **LLM hallucinates triggers** | `responseSchema` + `ingest()` validation + `certainty` filter |
