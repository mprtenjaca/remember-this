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

> **PHASE A → two iOS builds now run on the phone.** EAS project `c63bb827…`, owner `mprtenja`, bundle
> `com.mp.rememberthis`. **`development`** (`npm run build:dev:ios`) needs Metro: `npm start`, open THAT app,
> not Expo Go — it carries `__DEV__`, so the debug timeline (time travel, "Test obavijest (10 s)", seed) exists
> only here. **`preview`** (`npx eas build --profile preview --platform ios`) is standalone: no Metro, ad-hoc
> signed for registered devices, `EXPO_PUBLIC_AI_PROXY_URL` baked in by EAS env → dictation and the AI ladder
> work, but `__DEV__` is false so there is **no time travel and no test notification** (Marko's call, 2026-09-03).
> Native notifications, geofencing, Skia and background tasks **cannot be tested in Expo Go**. Everything
> touching them goes through an adapter that picks the real implementation outside Expo Go and a mock inside it
> (`inExpoGo`; see `docs/03-NATIVE.md`). Expo Go supports up to SDK 54 — stay on `expo@~54`.
> First device run found the `categoryIdentifier: undefined` crash (fixed; see
> `docs/records/2026-09-01-third-device-session.md`) — reminders schedule on the phone now.

---

## Current Status

Only open work is listed. Finished areas live in git history and `docs/records/`.

| Area | Status | Notes |
|---|---|---|
| M0 prompt harness | Gate FAIL, numbers fresh | Re-run 2026-09-01 through the model ladder: 59/59 notes, 0 transport errors, **intent 84.7 %** (heuristic alone 78 %), triggers 96.6 %, schema 100 %. FAILING: `unacceptable_question_rate` **15.3 %** (the gift→birthday reflex, Next Step 3) and `latency_p95` **23.8 s** (thinking + walking exhausted rungs — invisible to the user, but the gate threshold predates the ladder; decide whether to raise it or re-run early in the quota day). |
| M2 Capture + Today | In progress | Implemented and device-tested. Open: the manual acceptance list in `docs/00-PLAN.md` (airplane-mode capture, p95 save→close < 150 ms). "Iz kontakata" on the date question is parked (`OFFER_CONTACTS = false` in `ClarifyCard`), as is "Novo" on Today (`SHOW_NOVO`). |
| Temporal parsing | Mostly closed | The 2026-08-28 sweep is largely fixed (2026-09-01): rok spans (both word orders), iza/poslije hours, ponoć, za N minuta/sati, recurrence incl. ikavica + stated hour, identifiers never dates, dialect birthday slang (roćkas/rođus). **Still failing — see Next Step 2.** |
| Brand assets | Store graphics to do | Icon/splash/favicon/notification icon all render from `npm run brand`. The dev build ran 2026-09-01 — confirm the icon and splash actually look right on the phone. Store graphics (C2 at store sizes) still to do. |
| M4 Notifications | Scheduling works on device, delivery unverified | First device run (2026-09-01) crashed on `categoryIdentifier: undefined` — fixed (a payload key must be ABSENT, not undefined; `domain/notificationCategory.ts`). Reminders schedule on the phone now. **Still unverified**: the background delivery checklist (ding, bulb glyph, tap→note, kill+reopen rehydration), app BACKGROUNDED. New and also untested on device: foreground banner now plays the ding, and the **question push** (`questionPush.ts` — enrich ends in a question while backgrounded → notification, tap → Danas, answered in app → tray cleared). The `preview` build is now the way to test all of it standalone (2026-09-03) — but it has no "Test obavijest (10 s)", so use real short notes ("sastanak za 2 minute"). |

### Next Step

1. **The device verification pass** (the build runs; the checklist does not verify itself). Everything below is
   ready to run — `npm run build:preview:ios` gives a standalone build with the proxy URL baked in, so this is
   the first build where dictation and the AI ladder work off Metro.
   With the app BACKGROUNDED: write "sastanak za 2 minute", background, wait → ding, bulb glyph in the status
   bar, tap → note. Kill + reopen → queue survives (rehydration).
   Also in this pass: **foreground banner now dings** (write a note, stay in the app), the **question push**
   (dictate "Marta želi bicikl", background immediately → notification with the question, tap → Danas, answer →
   tray entry gone), the **rok pair** ("platit kaznu u roku 8 dana" → dan prije + na dan), auto-resolve
   (answer a surfaced card → its reminder ticks itself), the "Kako ovo radi" drawer look, and **dictation
   itself** (never yet run on a build without Metro).
   **What `preview` cannot do:** no `__DEV__`, so no time travel and no "Test obavijest (10 s)". The birthday
   chain (−21d/−7d/−1d) and the yearly anchor need the `development` build (`npm run build:dev:ios` + `npm start`)
   — verifying them on `preview` would mean waiting weeks.

2. **Cases that still do NOT work** (all reproduced 2026-09-01; each wants a test in
   `device-2026-09-01.test.ts` first):
   - **"Plaćat članarinu svaki prvi u mjesecu" → nothing** — "svaki prvi u mjesecu" (nth-day-of-month
     recurrence without a weekday) is not parsed.
   - **Seasons produce nothing**: "Na proljeće posadit lavandu" → no date; "Ljeti obnovit fasadu" → the ~6 mj
     interval question instead of the season.
   - **"Slava je na Nikoldan" → nothing** — `knownDates` has no Nikoldan (19.12.).
   - **"za tri i po tjedna kontrola" → nothing** — fractional units ("i po" on weeks/months) are unparsed.
     Only the fraction is broken: re-probed 2026-09-03, **"za tri tjedna kontrola u srijedu" works** and returns
     one compound signal (`weekday: 3, occurrence: 'next', weeksAhead: 3` → 23.9.2026), word-number and all.
   - **"Kupit poklon za vjenčanje 20.6." asks "Kad je rođendan?"** — a wedding is not a birthday and the date
     is in the text. **"Zapamti da Ana voli lavandu" asks too** — a fact to recall, not an errand. Both are OUR
     heuristic's gift→birthday reflex, so E24 cannot catch them; they are also the bulk of the harness's
     15.3 % unacceptable questions.
   - **"svakih godinu dana" fires once** (1.9.2027) — the trigger is not truly recurring past its first fire.
     Marko has said this is acceptable for now (this is not a recurring-tasks app); noted so nobody "fixes" it
     into scope creep, but the yearly ANCHOR path already recurs where it matters (birthdays).

3. **Two decisions Marko has not made yet** (both change behaviour, so ask before coding):
   - **3 or 4 reminders by default for a birthday?** Today it is inconsistent: 4 when the date came from the
     text or a time was chosen, 3 when it came from the date question. Recommendation: 4 everywhere — "na dan"
     is the only one that says *it is today*.
   - **Is a recommendation a reminder?** "Ivan mi je preporučio servis za auto" quietly schedules ~6 months out.
     Recommendation: no — that is knowledge for search, and the fallback should stay for `future_need` notes
     that actually name a need. Deciding this also decides most of the harness question-rate failure.

4. **Harness gate**: after Next Step 2/3 land, re-run `npm run p0 -- --proxy` and revisit the `latency_p95 < 5 s`
   threshold — it predates thinking and the ladder. Add `reconcile` rules only for patterns that repeat, never
   for a single fixture.

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
| AI | Cloudflare Worker proxy (`worker/`) speaking the **Gemini request shape** to the app. `GEMINI_MODELS` in `wrangler.toml` is a **ladder walked best-first** (2026-09-01): `3.7-flash → 3.6-flash → 3.5-flash → 3-flash-preview` (each 5 RPM / 20 RPD, **thinking ON** — requests are the scarce resource, not tokens) `→ 3.5-flash-lite → 3.1-flash-lite` (15 RPM / 500 RPD each, worker strips thinkingConfig) `→` **Groq** `gpt-oss-120b` (`reasoning: high`, 1000 RPD / 200k TPD) `→` local heuristic. 429/5xx/timeout walk on; **404 skips only that rung** (a wrong model id — the dashboard's display name is NOT the API id, verify via `GET /models`); other 4xx stop the chain. `maxOutputTokens: 3000` — Gemini 3.x spends the budget on thinking FIRST, and 1200 returned `content: {}` with `finishReason: MAX_TOKENS`. Voice: **Groq Whisper large-v3-turbo**. Model output → `normalize()` → `reconcile()` → `ingest()`; **time comes from `temporal.ts`, never from the model**. |
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
  domain/                     # pure TS, 715 Vitest tests, zero native imports
    types.ts  clock.ts  dates.ts  mutations.ts  contactBirthday.ts  noteStatus.ts (what "done" means)
    notificationCategory.ts (which notification category a note carries — pure so the undefined-key crash class stays pinned by tests)
    upcomingGroups.ts (Dolazi headings: this month → month name → year)
    sameDay.ts (moving an occasion onto today collapses its chain)  anchorTime.ts (a chosen hour re-times only "na dan")
    herald.ts (a row's face is the event, not its "sat prije")  reminderOrder.ts (list by when it happens)
    recentNotes.ts (the parked "Novo" section)
    triggers/ resolve.ts  evaluate.ts  scoring.ts
    enrich/   temporal.ts (ALL date parsing; 203 tests across temporal.test.ts + the device-*.test.ts files)  knownDates.ts (public/church/Easter)  labels.ts (no name inflection)
              heuristic.ts (rules + dialect + places + relations + cars)  normalize.ts  reconcile.ts (policy)  ingest.ts
              rereadPrompt.ts (is an edit big enough to offer a re-read?)
    search/   cosine.ts
  db/
    schema/001_init.ts        # migrations, append-only (SQL as a TS string)
    index.ts                  # Db interface + migration runner + JS mutex
    rows.ts  applyMutations.ts  repositories/
  services/
    ai/        client.ts  prompt.ts (prompt+schema, shared with the harness)  enrich.ts  embed.ts  queue.ts  transcribe.ts
    notifications/  types.ts (Scheduler adapter)  mock.ts (Expo Go → debug_scheduled)  expo.ts (real OS, channel + sound; payload keys ABSENT, never undefined)
                    index.ts (picks one via `inExpoGo`)  permission.ts (asked after the first note)  runtime.ts (tap → note; question push → Danas; rehydrate on launch; foreground banner dings)
                    questionPush.ts (enrich ended in a question while backgrounded → immediate local push, tap → Danas, answered in app → tray cleared; NOT under hard rule 2 — the durable form is the needs_input status)
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
npm run build:dev             # EAS dev build (Android apk) — needs Metro; :ios for iPhone
                              # after installing: `npm start`, then open the DEV app (not Expo Go) and scan
                              # this is the build WITH __DEV__ → time travel + "Test obavijest (10 s)"
npm run build:preview:ios     # standalone iOS (ad-hoc, no Metro). Dictation + AI ladder work (proxy URL comes
                              # from EAS env, not .env); no __DEV__ → no debug timeline. Registers device UDIDs.
npx eas env:list --environment preview        # verify EXPO_PUBLIC_AI_PROXY_URL is set for a profile
npx eas env:create --environment preview \    # ...and how it got there (--visibility plaintext: it is only a URL)
  --name EXPO_PUBLIC_AI_PROXY_URL --value https://remember-this-ai.mpcodebase.workers.dev --visibility plaintext
```

---

## Recent Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-09-03 | **`preview` is the standalone test build, and it stays without debug tools.** `eas.json` `preview` gained `ios.simulator: false`; `EXPO_PUBLIC_AI_PROXY_URL` lives in EAS env per environment (`--visibility plaintext`), NOT in the build from `.env`. The `__DEV__` gate on the debug timeline was deliberately left alone after being offered a channel-based gate | Marko's call: debug tools have no business in anything but a development build. Cost, accepted knowingly: `preview` cannot time-travel, so the birthday chain and yearly anchor must be verified on the `development` build instead. `.env` is a Metro-time file — a standalone build reads env only from EAS, which is why the earlier dev build was offline (heuristic, no dictation). |
| 2026-09-01 | **The Gemini ladder is walked BEST-FIRST** (`GEMINI_MODELS` in `wrangler.toml`): four 20-RPD Flash rungs with **thinking ON**, then the two 500-RPD Lites, then Groq (`reasoning: high`), then the heuristic. 404 skips one rung; other 4xx stop the chain. Supersedes "lite leads because 20/day cannot carry a day" — four stacked 20/day pools can | Each rung is its own quota pool, so best-first costs nothing. Thinking is free where REQUESTS are the scarce resource (250K TPM vs 20 RPD) — but Gemini 3.x spends `maxOutputTokens` on thinking FIRST, so the cap went 1200 → 3000 after a probe returned `content: {}` / `finishReason: MAX_TOKENS` (HTTP 200, no JSON — the silent-failure class). See `docs/records/2026-09-01-third-device-session.md`. |
| 2026-09-01 | **A payload key crossing a native bridge is ABSENT, never `undefined`.** `categoryIdentifier: undefined` crashed every non-gift reminder on the first device run ("Cannot cast 'nil'"); `expo.ts` spreads optional keys in conditionally, and the rule lives in `domain/notificationCategory.ts` with tests | JS treats `{k: undefined}` and "no k" the same; iOS does not. Grep for `: undefined` in anything OS-bound. |
| 2026-09-01 | **E24: an occasion nobody mentioned is never asked about** — the model's `needs_anchor` survives only when the TEXT implies the occasion (occasion word, memorial/marriage, gift marker). Slang counts as text: `fold()` maps roćkas/rođus/rodjus → rodendan, one mapping teaching every folded pattern | "Piće s Ivanom" was asked "Kad je rođendan?" — the model saw a name and reached for the birthday a name implies. Then "Marko rockas" showed the other edge: E24 stripped a CORRECT model anchor because our vocabulary lacked the dialect word. Teach vocabulary in fold(), never weaken the rule. |
| 2026-09-01 | **E25: a deadline 3+ days out gets a "dan prije" companion** ("u roku 8 dana", "Rok od 10 dana", "do petka" → dan prije + na dan). A plain dated note stays single — the pair is only for dates with a penalty behind them | Marko's call: the last day at 09:00 is often too late to act (bank hours). Day-before is calendar arithmetic, not −24 h, so DST cannot move the hour. |
| 2026-09-01 | **Answering a surfaced card resolves its reminder** — every answer (Riješeno/Korisno/Ne treba mi) closes that one trigger; only the stored reaction differs (it still teaches the scorer). `'not_now'`'s re-arm-in-7-days is gone with the button that sent it | "Ne treba mi" sent `'wrong'`, and `react()` had NO branch for it — the tap changed nothing. A reminder that already rang does not also need a manual tick; the tap IS the answer. |
| 2026-09-01 | **Enrich that ends in a question KNOCKS when the app is backgrounded** (`questionPush.ts`): a local push with the question as title, tap → Danas, answered in app → tray cleared. Presented IMMEDIATELY, never scheduled; deliberately outside hard rule 2 and outside anti-fatigue | Scheduled pushes lose the race with refill's `cancelAll()` when two notes enrich back to back; a presented one is untouchable. The durable form of a question is the `needs_input` status Danas renders — losing the push loses nothing. It answers the user's own action from seconds ago, so it is not fatigue traffic. |
| 2026-09-01 | **Foreground notifications play the ding** (was deliberately silent) | Marko: a silent banner reads as broken — you cannot tell a working notification from a dead one. Known cost: can overlap the app's own completion ding. |
| 2026-08-25 | **Time is parsed in TypeScript, not by the model** (`domain/enrich/temporal.ts`); the model gets a pre-resolved TEMPORAL line and `reconcile()` discards any date it returns | Models dated notes that had no date, and dates cannot be unit-tested inside a prompt. Also cut the prompt −24%. See `docs/records/2026-08-25-temporal-parser.md`. |
| 2026-08-25 | Deterministic `reconcile()` policy layer between model and `ingest()` | Providers disagreed on intent, forgot anchors, hallucinated dates; behaviour must not depend on which model answered. See `docs/records/2026-08-25-enrichment-policy-layer.md`. |
| 2026-08-25 | **Dialect is a first-class input**, and "god" means the anniversary of a death | People dictate the way they speak. Several notes produced a correct title and NO reminder — the worst outcome, because it looks like it worked. See `docs/records/2026-08-25-device-session-ux.md`. |
| 2026-08-25 | **"Riješeno" is one concept at two levels**; the semantic trigger is neither tickable nor deletable. **2026-08-28:** "✓ Riješeno" on the resurfaced card is the REMINDER level (that trigger only; the note archives itself only when it was the last one) — it used to close the whole note. The card has two answers: Riješeno/Korisno and "Ne treba mi". A done or fired reminder keeps showing its time, faded (`fireAt ?? lastFiredAt`) | A note holds several errands. The semantic trigger is what makes it findable in six months, so it survives being done. See `docs/records/2026-08-25-device-session-ux.md`. |
| 2026-08-25 | UI language follows the DEVICE (`ui/theme/locale.ts`), never the note | A Croatian phone showed "next week" inside a Croatian note. The note's own language is still stored for the model and for dictation, but no label reads from it. |
| 2026-08-25 | Names are never inflected: label "Rođendan · Marti"; the Croatian question carries **no name at all** — "Kad je rođendan?" (2026-08-28, was "Kad je rođendan — Marti?") | Approximating the Croatian possessive produced "Martiov"/"Lukin". Asking generally is correct for every name; the clarify card shows the note, so the dash-name read as clutter. Migration 002 rewrites existing labels. |
| 2026-08-28 | **Low certainty never gates delivery.** It shows a sparkles icon (gone once `user_edited`), orders same-day competitors, and weighs 0.2 in surfacing score — the push fires either way | An earlier claim of mine that it suppressed pushes was wrong. A guessed deadline is also always WRITTEN; the one-tap correction (`kind: 'interval'`) is offered only when the category has no rhythm. See the record. |
| 2026-08-28 | **Same day → exactly two reminders: an hour before and at the moment** (`reconcile` E23), for occasions and tasks alike; the anchor chain and the anchor itself are dropped for a same-day occasion. "Danas" with no hour whose default hour has passed → the next full hour, never after 21:00. **A bare hour 1–11 whose morning reading has passed means the evening one** ("danas u 10" at 17:00 = 22:00; resolver, `temporal.ts`). **A stated hour that has genuinely passed today is an event that is over** — no reminder and nothing invented (an 18:00 nobody asked for was the bug). Also: `statedOccasionDate()` counts a relative DAY on the calendar, not through the resolver (which rolls "danas" to tomorrow once the hour passed) | Device: a birthday "večeras u 8" produced FOUR reminders — −21/−7/−1 rolled into 2027 and "na dan" sat at the default 09:00, already past. Known cost: a same-day birthday creates no yearly anchor (its day-of reminder cannot carry the stated hour, and two is the number). |
| 2026-08-28 | **Whisper's `prompt` is a style SAMPLE, not an instruction.** The app's Croatian instruction block ("Transkribiraj govor DOSLOVNO…") was being forwarded as that prompt, so the decoder imitated its wording and register and Croatian came out garbled. Only a part explicitly marked `voicePrompt: true` (the note text so far) reaches it now, behind a short natural-sounding Croatian example; the instructions still go to Gemini, which does read them. Recording is mono (Whisper downmixes anyway — the second channel only doubled the upload) | Device: "prepoznavanje glasa na hrvatskom radi očajno". The provider was never the problem — `GEMINI_TRANSCRIBE = ""` means transcription already went to Whisper. |
| 2026-08-25 | Same-day reminders belong to Today's top card, never to `surfaced` | Surfacing before the time would push early (anti-fatigue rule). The Today screen splits `upcoming` into "Danas još N" and "Dolazi". |

---

## Documents

| File | Contents |
|---|---|
| `docs/00-PLAN.md` | Milestones, tasks, acceptance criteria, status |
| `docs/01-SCHEMA.md` | Full SQL schema + TS types |
| `docs/02-AI-LAYER.md` | Prompts, responseSchema, provider layer, edge-case rules, harness |
| `docs/03-NATIVE.md` | Expo Go matrix, dev build strategy, OS limits, all the traps |
| `docs/04-DESIGN.md` | Themes, typography, native chrome, signature moments |
| `docs/records/` | Dated decision records. Most load-bearing: `2026-08-25-temporal-parser.md` (why time is TS, not the model), `2026-08-25-enrichment-policy-layer.md` (why `reconcile()` decides), `2026-08-25-device-session-ux.md` (dialect, "done", the silent-failure class), `2026-08-28-ui-session-and-onboarding.md` (honest labels, two views of "Sve", the welcome, expo-router traps), `2026-08-28-second-device-session-m4.md` (six parser blind spots, the same-day rule, the first-run copy pass, why Whisper's `prompt` is a style sample, M4), `2026-09-01-third-device-session.md` (the nil-payload crash class, the model ladder + thinking, E24/E25, the question push, the harness's first honest numbers) |

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
