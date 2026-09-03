# 2026-09-01 — first run on the phone: the nil crash, the model ladder, and enrich that answers back

## Context

The first session with the iOS dev build actually running on a phone (Metro-connected). Marko used it live and
reported as he went; almost everything found was ours, again. Tests 655 → **715**, typecheck clean throughout.
Nothing committed — Marko commits himself.

---

## 1. The crash class: a payload key that is PRESENT holding undefined

The very first scheduled reminder killed the build:

```
Failed to schedule notification, Cannot cast 'nil' for field 'categoryIdentifier' of type Optional<String>
```

`refill.ts` built `category: note.intent === 'gift' ? 'gift' : undefined` — so for every non-gift note the key
*existed* with the value `undefined`, and expo-notifications forwards a present-but-undefined key to iOS, which
cannot cast nil into a non-optional String. The gift note scheduled fine; the next ordinary one crashed. Fix:
spread the key in only when there is a value (`...(n.category ? { categoryIdentifier: n.category } : {})`).

The rule moved to `domain/notificationCategory.ts` with tests — `refill.ts` imports the scheduler, which reaches
react-native, so Vitest cannot import it; the rule is policy anyway. The typecheck then caught that `intent` is
`Intent | null` (capture never waits for the LLM, so a reminder can be scheduled before an intent exists) — the
old inline comparison handled that by accident, the signature now states it.

Worth generalizing: **JS `{ key: undefined }` and "no key" are different things at a native bridge.** Grep for
`: undefined` in anything that crosses to the OS.

Also from the same minutes on the phone:
- **"Rendered fewer hooks than expected" on "Bez podsjetnika"** — ClarifyCard had a `useState` *below* the
  `if (!q || done) return null` early return. Committing an answer flipped `done` and React saw one hook fewer.
  Hooks live above every early return, no exceptions; the other components were swept (all clean).
- **Foreground notifications now play the sound** (Marko's call). The silent banner read as broken — you could
  not tell a working notification from a dead one. Known cost: can overlap the app's own completion ding.
- **A body edit is never discarded silently** — tapping outside an edited description now asks
  (Nastavi uređivanje / Odbaci / Spremi); an unchanged draft still closes without a dialog.

## 2. The Gemini ladder, and what thinking actually costs

`GEMINI_MODELS` in `wrangler.toml` is now a comma-separated ladder walked best-first:

```
gemini-3.7-flash → 3.6-flash → 3.5-flash → 3-flash-preview   (each 5 RPM / 20 RPD, thinking ON)
→ 3.5-flash-lite → 3.1-flash-lite                             (15 RPM / 500 RPD each, no thinking)
→ Groq gpt-oss-120b (reasoning: high)                          (1000 RPD, 200k tokens/day)
→ local heuristic
```

Why best-first is affordable now: each rung is its own free-tier quota pool, so four 20/day models stack into
~80 top-tier requests before the Lites take over with 1000 more. A single 20 RPD model could never lead; four
of them can. The worker walks the ladder on 429/5xx/timeout; **a 404 skips only that rung** (a wrong model id
is a config mistake in one entry, not a reason to abandon five working models — one bad id had failed all 59
harness notes because 404 counted as "stop"). Any other 4xx stops the chain: re-sending a rejected body to five
more models buys five identical 400s.

Three lessons paid for:
- **The dashboard's display name is not the API id.** "Gemini 3 Flash" is `gemini-3-flash-preview`. Verify
  against `GET /models`, never against the console label.
- **Thinking is on for the Flash rungs** (`thinkingBudget: -1`) because the binding limit is REQUESTS, not
  tokens (250K TPM vs 20 RPD) — reasoning inside a request already paid for is free. But Gemini 3.x spends
  `maxOutputTokens` on thinking FIRST: at the old 1200 cap a hard note could burn the whole budget reasoning
  and return HTTP 200 with `content: {}` and `finishReason: MAX_TOKENS` — a silent failure. Cap raised to
  3000, and `extractJsonText` now names that cause in its error instead of "empty model response".
- **`x-model` alone forces Groq's path.** Debugging with that header produced Groq's "model does not exist"
  404s for Gemini names and sent an hour down the wrong hole; pair it with `x-provider: gemini`.

`GROQ_REASONING` went medium → high: Groq is the last rung, rare, and when it runs it is the only thing between
the note and the offline heuristic.

## 3. The harness runs again — first honest numbers since August

`npm run p0 -- --proxy` through the ladder: **59/59 notes, zero transport errors**. Gate FAIL on two metrics:

| Metric | Value | Gate |
|---|---|---|
| intent_accuracy | **84.7 %** (heuristic alone: 78 %) | ✅ >80 |
| expected_trigger_types | 96.6 % | ✅ |
| schema_valid | 100 % | ✅ |
| unacceptable_question_rate | **15.3 %** | ❌ <10 |
| latency_p95 | **23.8 s** | ❌ <5 s |

The p95 is thinking plus walking four exhausted rungs — invisible to the user (capture never waits), but the
gate threshold predates the ladder. The bad questions are the open sweep defects (gift→birthday, below).

## 4. reconcile grew two rules, and the vocabulary grew a dialect word

- **E24 — an occasion nobody mentioned is never asked about.** "Piće s Ivanom" was asked "Kad je rođendan?".
  Our heuristic never asked it; the MODEL saw a name and reached for the birthday a name implies, and
  `reconcile` took `needs_anchor` on trust. Now a model anchor question survives only when the TEXT implies the
  occasion (occasion word, memorial/marriage phrase, or a gift marker). A smarter model guesses *more*
  confidently, not less — this is hard rule 11 earning its keep.
- **E25 — a deadline 3+ days out gets a "dan prije" companion** (Marko's call). "U roku 8 dana", "Rok od 10
  dana", "do petka" → dan prije + na dan; shorter stays single; a plain "za 8 dana kontrola" is NOT a deadline
  and stays single (the pair is for dates with a penalty behind them). Day-before is computed calendar-wise,
  not −24 h, so DST cannot move the hour.
- **"Marko rockas" produced no question on either path** — the heuristic did not know the word, and E24
  stripped the model's *correct* anchor because the raw text carried no occasion word our rules knew. Fixed in
  `fold()`: roćkas/ročkas/rockas and rođus/rodus/rodjus normalize to "rodendan", the same way "rodjendan"
  already did — one mapping teaches all eight folded patterns at once, and case endings ride along
  ("roćkasa" → "rodendana"). Slang is vocabulary, not a new rule.

## 5. temporal.ts — the sweep defects that fell today

All with tests in `device-2026-09-01.test.ts` first:

- **"u roku 8 dana" / "Rok od 10 dana za platit kaznu" / "Rok za prijavu je 15 dana"** — a deadline stated as a
  span, in both the preposition and the noun form. The noun form tolerates a few words between "rok" and the
  number but stops at punctuation ("Produžili su rok, platit ću za 3 dana" — the 3 days are when he pays).
- **"iza 7" / "poslije 5" is an hour**, not (only) a day shift; bare 8–11 after "iza" flips to evening unless a
  day is named ("sutra iza 9" is 09:00 — that regression was caught by its own test the same day).
- **"u ponoć" is 00:00** (a `midnight` day-part, matched before the generic night words).
- **"za 2 minute" / "za 2 sata"** — a new `in_minutes` signal resolved in plain ms. It could not be a
  fractional `relative.days`: `setDate()` truncates and the resolver overwrites the hour with the 09:00 default.
- **Recurrence**: "svakih godinu dana" (yearly said with the noun), "svaka 3 miseca" (ikavica was missing from
  the month unit), and a recurring weekday now keeps its stated hour ("svaki ponedjeljak trening u 7" → 19:00,
  was the 09:00 default).
- **An identifier is not a date on BOTH parsers** — "Verzija 2.10" scheduled 2 October and "Polica osiguranja
  12.5 mil" scheduled 12 May because `extractExplicitDate()` had its own copy of the date regex without the
  guard `temporal.ts` had since August. Now one shared `looksLikeIdentifier()`; the guard allows one noun
  between keyword and number ("polica osiguranja 12.5") but only for unambiguous identifier words — "kod" is
  overwhelmingly the preposition ("pregled kod oftalmologa 15.9." must stay a date). Two regex copies of one
  rule WILL drift; share the function.
- **Dictation shorthand**: `spokenShorthand()` — "vcrs" → večeras, digits glued to the preposition ("u8" → "u
  8"; only the standalone preposition is split, so "verzija 2.10" and "covid19" survive).

## 6. Enrich answers back: the question push, and cards that resolve themselves

- **A question now knocks** (`services/notifications/questionPush.ts`): when enrichment ends in `needs_input`
  and the app is backgrounded, a local notification fires with the question as its title; tap lands on Danas
  where the ClarifyCard waits. Presented IMMEDIATELY (channel-aware trigger on Android, null on iOS) rather
  than scheduled — refill wipes the OS queue with `cancelAll()` on every mutation, and a scheduled push loses
  that race when two notes enrich back to back; a presented one is untouchable. Answering in the app (any of
  the five paths) clears the tray entry. Deliberately NOT under hard rule 2: the durable form of a question is
  the `needs_input` status Danas already renders — if the push is lost, nothing is lost. Not anti-fatigue
  traffic either: it is a response to something the user wrote seconds ago.
- **Answering a surfaced card resolves its reminder** (Marko's call). "Ne treba mi" sends `'wrong'`, and
  `react()` had NO branch for it — the tap changed nothing on the trigger. Now every answer closes that one
  reminder (the reaction still teaches the scorer); `'not_now'`'s re-arm-in-7-days is gone with the button that
  sent it.
- **"Kako ovo radi" is a real bottom drawer** — the shared `Sheet` (scrim, grabber, drag-down), not a card
  pushed into the Today list. First cut passed `title` to Sheet and read as a text dump; the body now carries
  its own bulb-badge header, icon-badged steps and a divider, so the 💡 opens what it promises.

## 7. Open questions Marko has not decided

1. **Is a recommendation a reminder?** "Ivan mi je preporučio servis" still quietly schedules ~6 months out.
   Standing recommendation: no — knowledge for search; keep the fallback for `future_need` that names a need.
2. **3 or 4 birthday reminders by default** — unchanged from the previous session.
3. The **gift→birthday reflex is now OURS to fix**: "Kupit poklon za vjenčanje 20.6." asks "Kad je rođendan?"
   (a wedding is not a birthday, and the date is in the text), "Zapamti da Ana voli lavandu" asks too (a fact
   to recall, not an errand). E24 cannot catch these — the heuristic itself proposes them.

## Consequences

- Tests 655 → **715**; typecheck clean; worker redeployed (version d4acc267).
- New files: `domain/notificationCategory.ts`, `services/notifications/questionPush.ts`,
  `domain/enrich/device-2026-09-01.test.ts` (50 tests).
- Memory: replies to Marko in Croatian or English only, never Serbian.

## Related

- `2026-08-28-second-device-session-m4.md` — the sweep this session closed most of
- `2026-08-25-temporal-parser.md`, `2026-08-25-enrichment-policy-layer.md` — why every fix above is TS, not prompt
- Hard rules 2, 5, 6, 11, 13
