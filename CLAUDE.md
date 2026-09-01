# Remember This

An external brain that brings information back when it becomes relevant.
The user organizes nothing — the app decides **when** something matters again.

```
"Zapamti: Ivan mi je preporučio servis za auto."   (Remember: Ivan recommended a car service)
   → 6 months later, when you search for a mechanic
🧠 You mentioned this before — Ivan recommended Auto X.
```

---

## Current phase

> **PHASE A → the first iOS dev build was queued on 2026-08-28.** EAS project `c63bb827…`, owner `mprtenja`,
> bundle `com.mp.rememberthis`. Once it is installed: `npm start` and open THAT app, not Expo Go.
> Native notifications, geofencing, Skia and background tasks **cannot be tested in Expo Go**. Everything
> touching them goes through an adapter that picks the real implementation outside Expo Go and a mock inside it
> (`inExpoGo`; see `docs/03-NATIVE.md`).
> Expo Go supports up to SDK 54 — stay on `expo@~54`.
>
> Update this line once a dev build has actually run on a phone.

---

## Current Status

Only open work is listed. Finished areas live in git history and `docs/records/`.

| Area | Status | Notes |
|---|---|---|
| M0 prompt harness | Stale | 59 fixtures. Last numbers (intent 86 %, gate 90 %) predate the −24 % prompt, the slim schema, `temporal.ts` and the Gemini switch — **they no longer describe the app**. Re-run `npm run p0 -- --proxy` before trusting them. |
| M2 Capture + Today | In progress | Implemented and device-tested. Open: the manual acceptance list in `docs/00-PLAN.md` (airplane-mode capture, p95 save→close < 150 ms). "Iz kontakata" on the date question is parked (`OFFER_CONTACTS = false` in `ClarifyCard`), as is "Novo" on Today (`SHOW_NOVO`). |
| Temporal parsing | Open defects | A 65-sentence sweep (2026-08-28) found **15 more**, listed in Next Step 2 — recurrence dropped, "u roku N dana" unparsed, "Verzija 2.10" still dated by `extractExplicitDate()`. Voice transcription itself is fixed and confirmed good on device. |
| Brand assets | Done, not seen in a build | Icon (I3 lime), adaptive icon, C2 splash lockup, favicon and the white-silhouette notification icon — all from `npm run brand` (`scripts/brand/render.mjs`). Expo Go shows its own icon and splash, so none of it is visible until the dev build. Store graphics (C2 at store sizes) still to do. |
| M4 Notifications | Implemented, untested on device | `ExpoScheduler` (`services/notifications/expo.ts`) is live outside Expo Go; Expo Go still gets the mock (`inExpoGo`). Sound `assets/sound/ding.wav`, Android channel `reminders-v1` (**its sound is frozen at creation — bump the id, never edit**), white-silhouette `notification-icon.png`, iOS `timeSensitive` for same-day. **Permissions (notifications, then microphone) are asked once, when the capture sheet CLOSES for the first time — written or not** (`askStartupPermissions`), never at launch and never mid-recording; each behind our own explanation first, and "Ne sada" does not spend the OS's single prompt. Tap → note detail; every launch rebuilds the OS queue from the DB (hard rule 2). **Nothing has been seen deliver yet** — the first iOS dev build was queued 2026-08-28; verify with the debug timeline's "Test obavijest (10 s)", app backgrounded. |

### Next Step

1. **Verify M4 on the dev build** (queued 2026-08-28; `npx eas build --profile development --platform ios`).
   Install, run `npm start`, open the new app — then: debug timeline → "Test obavijest (10 s)" with the app in
   the BACKGROUND (a foreground banner is a different check, and it is deliberately silent). Confirm: the ding
   plays, the status-bar glyph is our bulb, tapping opens the note. Then a real reminder: write "sastanak za 2
   minute", background the app, wait. Also the permission pass when the capture sheet first closes, and that
   killing + reopening the app keeps the queue (rehydration). First sight of the icon and splash, too.
   **The proxy URL is not in the build** — EAS has no env vars for the `development` environment, so a build run
   without Metro is offline (heuristic only, no dictation). Connected to `npm start` it reads the local `.env`.
   Fix properly with `eas env:create` when a standalone build is needed.

2. **Fix what the 65-sentence sweep found** (2026-08-28, second session). All deterministic, all in
   `temporal.ts` / `heuristic.ts` / `reconcile.ts`, all with a test in `device-2026-08-28.test.ts` first.
   Silent-failure ones first — each produces a correct title and a wrong or missing reminder:
   - **"Verzija 2.10 ima bug" schedules 2 October.** `temporal.ts` already refuses this (identifier words before
     a number); `extractExplicitDate()` in `heuristic.ts` does not, and it is the one that wins here. Same for
     "Polica osiguranja 12.5 mil".
   - **"Platit kaznu u roku 8 dana" → nothing.** "u roku N dana" is not parsed as +N days.
   - **Recurrence is dropped**: "Cijepiti psa svakih godinu dana" and "Plaćat članarinu svaki prvi u mjesecu"
     produce nothing; "Filter mijenjat svaka 3 miseca" gets the invented "~6 mjeseci" fallback instead of the
     stated rhythm; "Svaki ponedjeljak trening u 7" loses the hour (lands 09:00).
   - **"U ponoć čestitat Ani" → nothing** (00:00 is not a parsed hour).
   - **"U srijedu poslije 5" → 09:00** ("poslije N" is not read as an hour).
   - **"Kupit poklon za vjenčanje 20.6." asks "Kad je rođendan?"** — the date is in the text, and a wedding is
     not a birthday.
   - **"Zapamti da Ana voli lavandu" asks for a birthday** — that note is a fact to recall, not a gift errand.
   - **"Popodne nazvat banku"** triggers the same-day pair (E23 fires on a bare day-part); one reminder is right.
   - Seasons produce nothing useful: "Na proljeće posadit lavandu" → no date, "Ljeti obnovit fasadu" → asks.
   - `knownDates` has no Nikoldan (19.12.), so "Slava je na Nikoldan" is dateless.

3. **Two decisions Marko has not made yet** (both change behaviour, so ask before coding):
   - **3 or 4 reminders by default for a birthday?** Today it is inconsistent: 4 when the date came from the
     text or a time was chosen, 3 when it came from the date question. Recommendation: 4 everywhere — "na dan"
     is the only one that says *it is today*.
   - **Is a recommendation a reminder?** "Ivan mi je preporučio servis za auto" quietly schedules ~6 months out.
     Recommendation: no — that is knowledge for search, and the fallback should stay for `future_need` notes
     that actually name a need.

4. **Re-run the harness** (`npm run p0 -- --proxy`, ~59 Gemini calls) — its numbers are still stale. Add
   `reconcile` rules only for patterns that repeat, never for a single fixture.

> **Testing note:** this project's characteristic failure is a note that produces a correct-looking title and
> **no reminder at all**. After any parser or enrich change, verify that a note which *should* schedule
> something actually did — a passing typecheck says nothing about it.

---

## Hard rules (never break without an explicit decision)

1. **Capture never waits for the LLM.** `capture()` writes to SQLite and closes the sheet in < 100 ms.
   Enrichment goes to a background queue. If the network is dead, capture still works.
2. **The `triggers` table is the source of truth.** `os_notification_id` is only a cache.
   Never schedule an OS notification without a row in the DB — otherwise new phone = lost reminders.
3. **`user_edited = 1` is sacred.** Enrich, re-enrich and AI chat never overwrite a trigger the user
   changed by hand. They only fill gaps.
4. **Max 2 questions at capture, tapping is the default.** Options are chips; the app never demands typing.
   Two exceptions, both escapes rather than the main path: a date picker for an anchor (one tap), and a
   "Nešto drugo…" chip that opens a small field when every offered option misses ("Obitelj" when the answer
   is "Ćaću"). A typed answer is kept as a keyword, not thrown away. There is always an exit, and it says its
   consequence: "Bez podsjetnika" on the date question, "Preskoči pitanje" on the rest (was "Samo zapamti").
5. **Ask only what cannot be derived.** A birthday date the app cannot know — ask.
   Lead time it can — default `-21d`, don't ask. Relative time ("sljedeći tjedan") is always resolved, never asked.
   **Never ask WHO a person is** ("Čiji je rođendan?", "Za koga?") — an options answer only becomes a keyword and
   moves no reminder, and the day-of reminder never needed the name (`WHO_QUESTION` in `ingest.ts`, 2026-08-28).
6. **Anti-fatigue is a functional requirement.** Max 2 pushes/day, never before 08:00 or after 21:00,
   the same note max 3× ever with cooldown 7d → 30d → never.
   **Better to miss than to falsely call.**
7. **Embeddings and semantic search are 100% local, forever.** The server (when it comes) sees
   only E2E-encrypted blobs. That is why pgvector on the server makes no sense.
8. **Native chrome, signature content.** Navigation/sheets/inputs/gestures = 100% platform-native.
   Character lives in the cards and the resurface moment. See `docs/04-DESIGN.md`.
9. **All time goes through the `Clock` service.** Never `Date.now()` directly in domain code.
   Without it the trigger engine cannot be tested without waiting.
10. **AI edit always shows a diff + confirmation.** Never a silent apply.
11. **The model proposes, `reconcile()` decides.** Every provider's output goes through the deterministic
    edge-case policy (`src/domain/enrich/reconcile.ts`) before `ingest()`. A behaviour that depends on which
    model answered is a bug; fix it with a rule + test, not with a better prompt alone.
12. **A name is not an identity.** A personal date (birthday, anniversary) is NEVER recalled from a previous
    note just because the name matches — the Marta here need not be the Marta there, and a confidently wrong
    reminder costs more than one tap. Only OFFICIAL dates (Božić, Uskrs, Valentinovo — `kind: annual`) are
    remembered and never asked. A date written in the note itself always wins.
13. **Time is never the model's job.** Every date, offset, recurrence and deadline is parsed in
    `src/domain/enrich/temporal.ts` (deterministic TS, 54 tests). The model is not asked for `iso_datetime` and
    any time it volunteers is discarded. A rule that can be computed belongs in code, not in the prompt —
    prompt tokens are the scarcest resource (Groq free tier caps TOKENS per day, not requests).

---

## Stack

| Layer | Decision |
|---|---|
| Runtime | Expo SDK 54, React Native 0.81, expo-router v6 (file-based) |
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess` |
| Styling | Typed tokens + `StyleSheet` (`src/ui/theme/tokens.ts`). "Deep": **olive-black ground, one accent hue** (lime `#D7EC7C` on olive-black, tints `ion`/`accentSoft`; `onAccent` is DARK), borderless glass cards (`Glass`), glowing voice orb (`VoiceOrb`), floating dock (`TabBar`). Fonts Manrope + Inter, Ionicons. *(NativeWind from the spec replaced for stability with Reanimated 4 on SDK 54.)* See `docs/04-DESIGN.md`. |
| Animation | Reanimated 4 + Worklets + Gesture Handler; Skia only for the theme switch (Phase B) |
| Local DB | `expo-sqlite` (works in Expo Go), behind the `Db` interface (`src/db/index.ts`); one connection, JS mutex |
| AI | Cloudflare Worker proxy (`worker/`) speaking the **Gemini request shape** to the app. Primary **Gemini** `gemini-3.5-flash-lite` (15 RPM / **500 RPD**), then `gemini-3.5-flash` (7 RPM / **20 RPD** — hence not primary), then **Groq** `openai/gpt-oss-120b` (30 RPM / 1000 RPD / 200k TPD). Provider/model/effort all live in `worker/wrangler.toml`. Voice: **Groq Whisper large-v3-turbo**. Local heuristic enricher when the proxy is unreachable. Model output → `normalize()` → `reconcile()` → `ingest()`; **time comes from `temporal.ts`, never from the model**. |
| Embeddings | `gemini-embedding-001`, 768 dims, BLOB in SQLite, cosine in plain JS (Gemini only — Groq has no embeddings) |
| Notifications | `expo-notifications` behind the `Scheduler` adapter: real one outside Expo Go, `MockScheduler` → `debug_scheduled` inside it. Own sound (`ding.wav`), channel `reminders-v1`, monochrome status-bar icon |
| Remote | Nothing until M6. Then Turso or Supabase, E2E encrypted |

**The API keys are never in the RN bundle.** All AI traffic goes through the Worker, which holds the keys and
rate-limits per device token. `EXPO_PUBLIC_AI_PROXY_URL` (a URL only) is the app's single env variable.
Without it the app runs 100% offline on the heuristic.

---

## Architecture — enrichment pipeline

```
capture(text) ──► notes(status=pending) ──► queue ──► provider (Groq | Gemini | heuristic)
                        │                                │  EnrichResult: MEANING only
   parseTemporal(text) ─┘                                │  (no dates — see hard rule 12)
   TemporalSignal[]                                      ▼
   dates · offsets · recurrence           normalize()  fills arrays, clamps enums+category, never crashes
   deadlines · defaults · certainty                      ▼
   (54 tests, zero tokens) ─────────────► reconcile()  OUR rules: TIME IS OURS (model's dates discarded),
                                                intent corrections, people (relations, not places),
                                                gift+person → birthday anchor, known public dates (Valentinovo,
                                                Uskrs…), marriage anniversary → person "Brak", UI language
                                                         ▼
                                   ingest()     drafts + questions (max 2), needsAnchor / inferredAnchor, status
                                                         ▼
                                   applyEnrichResult → triggers, entities, note; inferredAnchor → answerAnchor()
```

The harness (`p0-harness/eval.ts`) runs the identical `normalize → reconcile → ingest` chain, so its metrics
are the app's behaviour, not the raw model's.

---

## Structure

```
app/                          # expo-router
  (tabs)/index.tsx            # Today — surfaced cards, clarify, drafts ("Nedovršeno"), "Danas još N", "Dolazi"; "Novo" is wired but parked (SHOW_NOVO = false)
  (tabs)/timeline.tsx         # all notes, grouped by month
  (tabs)/search.tsx           # keyword + semantic (when embeddings exist)
  note/[id].tsx               # detail + edit (own glass back button, DatePickerSheet, actions list, undo). Title/text edits cancel on a tap outside (blur); return saves the title, "Spremi" the text. ✨ next to the text = re-read (always behind one confirmation, askReread). Reminders list by WHEN (`domain/reminderOrder.ts`: fireAt, else the time it fired; timeless last) — the repo's fire_at sort shoved fired one-offs to the bottom
  capture.tsx                 # native modal; orb stage (voice) / editor; drafts on dismiss
  onboarding.tsx              # first launch only (PREF.onboarded): 3 pages that SHOW write → decide → resurface, then open capture
  _debug/timeline.tsx         # DEV: FakeClock time travel, OS slots, seed, onboarding preview (?preview=1 → closes with back, touches nothing)
src/
  domain/                     # pure TS, 655 Vitest tests, zero native imports
    types.ts  clock.ts  dates.ts  mutations.ts  contactBirthday.ts  noteStatus.ts (what "done" means)
    upcomingGroups.ts (Dolazi headings: this month → month name → year)
    sameDay.ts (moving an occasion onto today collapses its chain)  anchorTime.ts (a chosen hour re-times only "na dan")
    herald.ts (a row's face is the event, not its "sat prije")  reminderOrder.ts (list by when it happens)
    recentNotes.ts (the parked "Novo" section)
    triggers/ resolve.ts  evaluate.ts  scoring.ts
    enrich/   temporal.ts (ALL date parsing, 54 tests)  knownDates.ts (public/church/Easter)  labels.ts (no name inflection)
              heuristic.ts (rules + dialect + places + relations + cars)  normalize.ts  reconcile.ts (policy)  ingest.ts
              rereadPrompt.ts (is an edit big enough to offer a re-read?)
    search/   cosine.ts
  db/
    schema/001_init.ts        # migrations, append-only (SQL as a TS string)
    index.ts                  # Db interface + migration runner + JS mutex
    rows.ts  applyMutations.ts  repositories/
  services/
    ai/        client.ts  prompt.ts (prompt+schema, shared with the harness)  enrich.ts  embed.ts  queue.ts  transcribe.ts
    notifications/  types.ts (Scheduler adapter)  mock.ts (Expo Go → debug_scheduled)  expo.ts (real OS, channel + sound)
                    index.ts (picks one via `inExpoGo`)  permission.ts (asked after the first note)  runtime.ts (tap → note, rehydrate on launch)
    scheduling/  refill.ts (64-slot rotating window + "why now" copy)  coalesce.ts (no stale refill)
    anchors.ts  capture.ts  today.ts  search.ts  drafts.ts  explainer.ts  noteActions.ts (delete/done/text)  contacts/birthday.ts
    onboarding.ts  hasOnboarded / markOnboarded / resetOnboarding (DEV) — one prefs row, same shape as explainer.ts
    sound/     playDing() — completion ding: every "riješeno" (reminder tick, its menu, "Kupljeno ✓", whole
               note done). Never on capture, edit or reopen. Exactly one ding per tap.
  ui/
    theme/     tokens.ts (Deep)  ThemeProvider.tsx  fonts.ts  locale.ts (UI language = device)
    components/ Glass  Background  VoiceOrb  Waveform  TabBar  Sheet (generic bottom sheet)  FlipIcon  DatePickerSheet  SurfacingCard  ClarifyCard  NoteCard  TriggerRow
                ReadingCard (enrich progress + "what happens next")  SwipeToDelete (swipe/hold on lists)
                CaptureToast + toastHold.ts ("Zapisano" card after a save: the typed words, whole card opens the note, a lime rail drains over its 8 s; hosted once in (tabs)/_layout, fed by captureEvents. Answering a clarify question shows it again as "Podsjetnik postavljen" — only once the save's own card is gone, `showToastIfGone`)
                DatePickerSheet (date/datetime; time optional — dismissing the clock keeps the default hour; "Bez vremena" button is gone; editing an existing reminder offers "Obriši podsjetnik" in the sheet)  ...
    hooks/     useLiveQuery.ts  useKeyboardHeight.ts  useReadingCards.ts (hold the reading card long enough to read)
worker/                       # Cloudflare Worker AI proxy (own package.json, wrangler.toml [vars] picks models)
p0-harness/                   # Node CLI: fixtures/notes.jsonl (59), eval.ts (--heuristic | --proxy | direct)
scripts/brand/                # own package.json (resvg); render.mjs holds the ONE bulb glyph → assets/brand/*.svg + assets/*.png
assets/brand/                 # generated SVG sources of icon / adaptive-icon / splash-icon / favicon — edit render.mjs, not these
docs/                         # 00-PLAN, 01-SCHEMA, 02-AI-LAYER, 03-NATIVE, 04-DESIGN, records/
```

---

## Commands

```bash
npm start                     # Expo Go
npm run typecheck
npm test                      # Vitest, domain logic without native
npm run p0 -- --heuristic     # prompt eval harness, local baseline
npm run p0 -- --proxy         # through the deployed worker (Groq), ~8 req/min; --rpm=N
GEMINI_KEY=... npm run p0     # direct Gemini
npm run worker:dev            # wrangler dev (in worker/)
cd worker && npm run deploy   # after changing wrangler.toml [vars] or src/index.ts
npm run brand                 # re-render icon/splash/favicon/notification PNGs (needs `npm install` in scripts/brand once)
npm run build:dev             # EAS dev build (Android apk) — the only way to test notifications; :ios for iPhone
                              # after installing: `npm start`, then open the DEV app (not Expo Go) and scan
```

---

## Recent Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-08-25 | **Time is parsed in TypeScript, not by the model** (`domain/enrich/temporal.ts`); the model gets a pre-resolved TEMPORAL line and `reconcile()` discards any date it returns | Models dated notes that had no date, and dates cannot be unit-tested inside a prompt. Also cut the prompt −24%. See `docs/records/2026-08-25-temporal-parser.md`. |
| 2026-08-25 | Deterministic `reconcile()` policy layer between model and `ingest()` | Providers disagreed on intent, forgot anchors, hallucinated dates; behaviour must not depend on which model answered. See `docs/records/2026-08-25-enrichment-policy-layer.md`. |
| 2026-08-25 | **Dialect is a first-class input**, and "god" means the anniversary of a death | People dictate the way they speak. Several notes produced a correct title and NO reminder — the worst outcome, because it looks like it worked. See `docs/records/2026-08-25-device-session-ux.md`. |
| 2026-08-25 | **"Riješeno" is one concept at two levels**; the semantic trigger is neither tickable nor deletable. **2026-08-28:** "✓ Riješeno" on the resurfaced card is the REMINDER level (that trigger only; the note archives itself only when it was the last one) — it used to close the whole note. The card has two answers: Riješeno/Korisno and "Ne treba mi". A done or fired reminder keeps showing its time, faded (`fireAt ?? lastFiredAt`) | A note holds several errands. The semantic trigger is what makes it findable in six months, so it survives being done. See `docs/records/2026-08-25-device-session-ux.md`. |
| 2026-08-25 | UI language follows the DEVICE (`ui/theme/locale.ts`), never the note | A Croatian phone showed "next week" inside a Croatian note. The note's own language is still stored for the model and for dictation, but no label reads from it. |
| 2026-08-25 | Names are never inflected: label "Rođendan · Marti"; the Croatian question carries **no name at all** — "Kad je rođendan?" (2026-08-28, was "Kad je rođendan — Marti?") | Approximating the Croatian possessive produced "Martiov"/"Lukin". Asking generally is correct for every name; the clarify card shows the note, so the dash-name read as clutter. Migration 002 rewrites existing labels. |
| 2026-08-25 | Model chain follows QUOTA, not preference: `3.5-flash-lite` (500/day) primary, `3.5-flash` (20/day) fallback, Groq last; voice stays on Whisper | The better model is unusable as primary at 20 requests a day. `temperature: 1` for Gemini 3.x — it is trained to reason at 1, so lowering it degrades reasoning. |
| 2026-08-25 | Wedding anniversary anchors to the pseudo-person `Brak` | The note names no spouse; guessing produced nonsense questions ("Kad je Zadruov godišnjica?"). |
| 2026-08-28 | **A label must not outlive what it describes.** One that states WHEN ("30 dana prije", "za ~6 mjeseci") is dropped when the user moves the date; one that states WHAT ("Kupiti poklon") survives — `describesTiming()` | The label kept its old arithmetic and contradicted the date beside it. Consequence worth remembering: `set_time`/`shift_offset` then need the FULL inverse (remove + re-add), or undo restores the date but leaves the label deleted. See `docs/records/2026-08-28-ui-session-and-onboarding.md`. |
| 2026-08-28 | **Low certainty never gates delivery.** It shows a sparkles icon (gone once `user_edited`), orders same-day competitors, and weighs 0.2 in surfacing score — the push fires either way | An earlier claim of mine that it suppressed pushes was wrong. A guessed deadline is also always WRITTEN; the one-tap correction (`kind: 'interval'`) is offered only when the category has no rhythm. See the record. |
| 2026-08-28 | **"Sve" is two views**, and the title is the state: **Sve** (default, by date written) ⇄ **Kronologija** (by reminder's month — the order things HAPPEN); in Kronologija, undated notes sit under one "Kad zatreba" section | Two real questions — "where is the thing I wrote in July?" and "what is coming?". First shipped the other way round; Marko's device note: a *chronology* is when things happen, not when they were typed, and the default list should be the one you scroll to find something. Grouping purely by reminder would drop the "kad zatreba" notes, which are the point of the app. |
| 2026-08-28 | **expo-router: `initialRouteName` does not pick the first route** (it only sorts children), and **`useRootNavigationState()` throws in the root layout**. A gate must not subscribe to `'state'` — its own `replace()` emits it | All three produced the same symptom: a blinking screen and scheduler logs pouring, because the throw remounted `Boot` → `openDb()` → `refill` in a loop. Readiness in a layout = `useNavigationContainerRef().isReady()`; the sent-flag must be module-level to outlive remounts. See the record. |
| 2026-08-28 | **Hand-moving an occasion onto today collapses its chain** (`domain/sameDay.ts`, used by `commitAnchor` in note detail): the anchor's reminders in that note are removed and the same-day pair (sat prije · u to vrijeme) is added in the SAME mutation batch, so one undo restores the chain. **Re-read is offered on any changed word** (`rereadPrompt.ts`; case/punctuation/diacritics stay quiet). **"Novo" shows only notes with no other place on Today** — no card, no reminder in Danas još/Dolazi; in practice the "kad zatreba" notes of the last 24 h. Order: Danas još above Novo. **A row's face is the event, not its herald** (`domain/herald.ts` `faceOf`): when the soonest reminder is "sat prije" and the moment follows an hour later, the row shows the moment's time and says "sat prije u 19:00" underneath | Device: 30.11 → today pushed three lead reminders into 2027; a description edit under the old 34 % threshold silently kept reminders reasoned from vanished text; Novo duplicated dated notes. |
| 2026-08-28 | **First-time-user copy pass.** One word for "saved": **Zapisano** (every button says "Zapiši"). Question exits say their consequence: "Bez podsjetnika" on the date question, "Preskoči pitanje" on the rest. Same-day moment label **"u to vrijeme"**. Today: **cards for what is today**, a plain list for what comes later. Amber stays exclusive to the resurface moment (undo "Poništi" is accent; `signalBorder` token replaced the last colour literals) | A code-side UX audit of the first ten minutes. Details and the full list in `docs/records/2026-08-28-second-device-session-m4.md`. |
| 2026-08-28 | **Same day → exactly two reminders: an hour before and at the moment** (`reconcile` E23), for occasions and tasks alike; the anchor chain and the anchor itself are dropped for a same-day occasion. "Danas" with no hour whose default hour has passed → the next full hour, never after 21:00. **A bare hour 1–11 whose morning reading has passed means the evening one** ("danas u 10" at 17:00 = 22:00; resolver, `temporal.ts`). **A stated hour that has genuinely passed today is an event that is over** — no reminder and nothing invented (an 18:00 nobody asked for was the bug). Also: `statedOccasionDate()` counts a relative DAY on the calendar, not through the resolver (which rolls "danas" to tomorrow once the hour passed) | Device: a birthday "večeras u 8" produced FOUR reminders — −21/−7/−1 rolled into 2027 and "na dan" sat at the default 09:00, already past. Known cost: a same-day birthday creates no yearly anchor (its day-of reminder cannot carry the stated hour, and two is the number). |
| 2026-08-28 | **"Novo" on Today is built but PARKED** (`SHOW_NOVO = false`; `domain/recentNotes.ts`, `today.recent` stay wired). Same for "Iz kontakata" on the date question (`OFFER_CONTACTS`) | A fourth block on a screen whose point is the resurface moment; the "Zapisano" card and "Sve" (by date written) already answer "did it land?". Turn either back on in one constant. |
| 2026-08-28 | **A relative date is a date written in the note.** `statedOccasionDate()` (heuristic.ts) dates a birthday/anniversary from "u subotu", "sutra", "za 2 tjedna", "prva srida u misecu" exactly as from "5.9." — no question, and the day itself stays as a reminder. Month/year offsets ("za 3 mjeseca") still ask. **The occasion's own day is bound to the anchor** (E22, offset 0 "na dan"), never a free time reminder — so it moves when the user moves the date. Also: a numeric month needs no ordinal dot ("u 10 misecu" = October, never 10 o'clock); "za N tjedna u subotu" is the Saturday of the week N weeks ahead (`weeksAhead`); numbers as words before a unit ("za dva tjedna", "u pet sati") are read (`numberWords`); spoken half-hours read as said — "u pola 9" = 8:30, "u 9 i pol" / "u 9 i 30" = 9:30, with the bare-hour afternoon rule still applied ("pola 3" = 14:30); Dalmatian "i po" = "i pol". **A nameless occasion still takes its date from the text** ("rođendan u 8 u petak" → the model's anchor gets our Friday, no question — the heuristic only builds an anchor for a named person, so `reconcile` reads `statedOccasionDate()` itself). **Occasion dates take an optional time** (the clarify question AND the anchor picker in note detail): `DatePickerSheet.onConfirm(d, { timeSet })` — the iOS sheet is always the DATE calendar plus our own "Vrijeme" row (native widgets get `locale` hr-HR); the hour reads GREY until the user opens the row and sets it, then lime, with × to clear; a chosen time re-times **only the day-of reminder** ("na dan", created if the chain had none — `domain/anchorTime.ts`), the lead reminders keep their hour; left alone, nothing changes. Danas tab icon is `today` (calendar page), not a sun. `device-2026-08-28.test.ts` ends with a table of odd everyday Croatian sentences → expected day; add there first when a dictation lands wrong | Device: "Branki je rođendan u subotu" asked for the date and threw the Saturday away; "u 10 misecu u prvu sridu" landed on 2.9. at 10:00. Both were OUR parser, not the model — the model is not asked for time (rule 13), so a gap in `temporal.ts`/`heuristic.ts` always shows up as a correct title with a wrong or missing reminder. Tests: `device-2026-08-28.test.ts`, `temporal.test.ts`. |
| 2026-08-28 | **`expo-dev-client` and `expo-updates` are in the build** — EAS added both while setting up the first dev build. `expo-dev-client` is what lets the installed app attach to Metro; `expo-updates` came with it and brought `runtimeVersion: {policy: "appVersion"}` + an `updates.url`. Harmless in development (the dev client always loads from Metro) and it is the OTA channel M6 would want, so it stays. Also: EAS duplicated and padded `android.permissions` — trimmed back to READ_CONTACTS / POST_NOTIFICATIONS / RECORD_AUDIO, which is what the app actually uses | An unreviewed autofill in `app.json` is how an app ends up asking for WRITE_CONTACTS it never uses. |
| 2026-08-28 | **Whisper's `prompt` is a style SAMPLE, not an instruction.** The app's Croatian instruction block ("Transkribiraj govor DOSLOVNO…") was being forwarded as that prompt, so the decoder imitated its wording and register and Croatian came out garbled. Only a part explicitly marked `voicePrompt: true` (the note text so far) reaches it now, behind a short natural-sounding Croatian example; the instructions still go to Gemini, which does read them. Recording is mono (Whisper downmixes anyway — the second channel only doubled the upload) | Device: "prepoznavanje glasa na hrvatskom radi očajno". The provider was never the problem — `GEMINI_TRANSCRIBE = ""` means transcription already went to Whisper. |
| 2026-08-28 | **Brand: I3 lime icon on both platforms, C2 lockup for the splash.** The Android adaptive icon keeps the lime ground (`backgroundColor` in `app.json`) with the glyph at 57 % of the 66 % safe zone, so it lands the same size as on iOS; the splash uses the `expo-splash-screen` plugin with `imageWidth` rather than the legacy top-level `splash`, so the lockup is 240 dp wide instead of stretched to the screen | One glyph definition in `scripts/brand/render.mjs` produces every asset — a hand-drawn set drifts the moment the palette moves. Lime on both platforms because the launcher is the one place the app is seen next to everything else; olive-black would vanish among dark icons. |
| 2026-08-28 | An animation is a flourish on a change that already happened, **never a gate in front of it** | The Sve ⇄ Kronologija list swaps on the tap, with `FlipIcon` spinning alongside. A full-screen wipe was built first and thrown out: too big a gesture for a change of list order, and translating a screen-sized disc stuttered on device. |
| 2026-08-25 | Same-day reminders belong to Today's top card, never to `surfaced` | Surfacing before the time would push early (anti-fatigue rule). The Today screen splits `upcoming` into "Danas još N" and "Dolazi". |
| 2026-08-25 | Capture is a native `modal`; note detail draws its own glass back button | formSheet detents opened half-height and kept the old content height; the native header drew a solid band over the gradient. Swipe-back stays native. |

---

## Documents

| File | Contents |
|---|---|
| `docs/00-PLAN.md` | Milestones, tasks, acceptance criteria, status |
| `docs/01-SCHEMA.md` | Full SQL schema + TS types |
| `docs/02-AI-LAYER.md` | Prompts, responseSchema, provider layer, edge-case rules, harness |
| `docs/03-NATIVE.md` | Expo Go matrix, dev build strategy, OS limits, all the traps |
| `docs/04-DESIGN.md` | Themes, typography, native chrome, signature moments |
| `docs/records/` | Dated decision records. Most load-bearing: `2026-08-25-temporal-parser.md` (why time is TS, not the model), `2026-08-25-enrichment-policy-layer.md` (why `reconcile()` decides), `2026-08-25-device-session-ux.md` (dialect, "done", the silent-failure class), `2026-08-28-ui-session-and-onboarding.md` (honest labels, two views of "Sve", the welcome, expo-router traps), `2026-08-28-second-device-session-m4.md` (six parser blind spots, the same-day rule, the first-run copy pass, why Whisper's `prompt` is a style sample, M4) |

**Read `docs/03-NATIVE.md` before coding.** It holds the OS limits (64 notifications, 20 geofences)
and the 0-indexed month in contacts — all three are sources of bugs that don't show in development.

## Working rules for this repo

- **Do not commit.** Marko commits himself. Never a `Co-Authored-By` trailer.
- Conversation with Marko is in Croatian; **documentation, code and comments are in English**.
  UI copy is Croatian-first, and follows the DEVICE language (`ui/theme/locale.ts`) — never the note's.
- Domain code (`src/domain`) never imports React, Expo or RN. If you need time, use `clock`.
- Every trigger change goes through `applyMutations()` — never a direct UPDATE from the UI.
- The word "trigger" does not exist in UI copy; the user manages **reminders** (podsjetnici).
- Amber (`signal`) is used **exclusively** in the resurface moment.
- No hardcoded hex in components — every colour comes from `t.c.*` tokens (a literal blue survived one palette
  change and produced a two-toned button).
- **Never put a fast-ticking animation inside a `FlatList` with an inline `renderItem`.** The onboarding
  typewriter (`setShown` ~25×/s) re-created `renderItem` on every tick, so all pages re-rendered, the
  typewriter remounted, and its effect restarted the timer — a self-feeding loop that read as a blinking
  screen and redrew the SVG `Background` continuously. Few fixed pages → plain `ScrollView` + `React.memo`.
- Stale-state gotchas: `db()` handle lives on `globalThis` (Fast Refresh); all DB access is serialized by one
  mutex — never call `db()` inside a `transaction()` callback (use `tx`), never call the mock scheduler inside one.
