# AI layer

Three calls, three different purposes:

| Call | Model | When | Code |
|---|---|---|---|
| **Enrich** | `gemini-2.5-flash` + `responseSchema` | background, after capture | `src/services/ai/enrich.ts`, `queue.ts` |
| **Embed** | `gemini-embedding-001` | right after enrich | `src/services/ai/embed.ts` |
| **Edit chat** | `gemini-2.5-flash` + function calling | when the user opens the chat (M7) | — |

> Check current model IDs before implementing — Google changes them. They change **in the worker**, not in the app.
> Fallback: Groq `llama-3.3-70b-versatile` (faster TTFT, useful if Gemini rate-limits).

## Local heuristic enricher — `src/domain/enrich/heuristic.ts`

While the proxy is not configured (`EXPO_PUBLIC_AI_PROXY_URL` empty) or unreachable, the app uses a
rule-based enricher that returns **the same `EnrichResult` shape**. Conservative: never invents a date,
asks only for a birthday it doesn't know. Covers: `u 15h`, `sutra u 10:30`, `za 2 tjedna`, `u petak`, `14.3.`,
`at 3pm tomorrow`, birthday/anniversary → anchor chain, categories (auto_servis, zdravlje, dom, poklon, restoran, putovanje, preporuka)
with synonyms for semantic keywords. `npm run p0 -- --heuristic` measures it with the same metrics as Gemini.

---

## 1. Worker proxy — `worker/`

**The API key is never in the RN bundle.** `EXPO_PUBLIC_*` variables end up in the bundle and decompile trivially.

`worker/src/index.ts`: POST `{ endpoint: 'enrich'|'embed'|'edit', body }` with the `x-device-id` header.
Optional per-device rate limit (KV binding `RL`, `rl:<day>:<deviceId>`, default 200/day via `DAILY_LIMIT`).
Models come from `[vars]` (`ENRICH_MODEL`, `EMBED_MODEL`) — the app never pins a model. Forwards to
`generativelanguage.googleapis.com/v1beta/models/<MODEL>:<ACTION>` with `x-goog-api-key`.
`GET /models` (or `/health`) lists which models the key may actually call — Google's 429 `limit: 0` does not
distinguish "quota spent" from "no free tier for this model".

Deployed: `https://remember-this-ai.mpcodebase.workers.dev` (Cloudflare account mpcodebase, 2026-08-25).

```bash
cd worker
npx wrangler secret put GEMINI_API_KEY    # same key the burin worker uses; GEMINI_KEY also accepted
npm run deploy
curl https://remember-this-ai.mpcodebase.workers.dev/health
# .env: EXPO_PUBLIC_AI_PROXY_URL=https://remember-this-ai.mpcodebase.workers.dev
```

The `burin-summary` worker from the weather app is NOT compatible (fixed `{lat, lon, place…}` → `{text}` contract).

### Provider layer (2026-08-25)

The app and the harness always send the **Gemini request shape** and read the Gemini response shape. The worker
translates for other providers and fails over between them, so a provider change never touches the app.

| Endpoint | Primary (`ENRICH_PROVIDER = groq`) | Failover | Notes |
|---|---|---|---|
| enrich / edit | Groq `openai/gpt-oss-120b` — JSON mode, schema embedded in the system prompt | Gemini `gemini-3.5-flash` → `-lite` | Groq free: 30 RPM / 1000 RPD. The app normalises missing arrays (`enrich.ts`). |
| transcribe | Groq **Whisper large-v3-turbo** (multipart upload built from the inline base64) | Gemini audio inline | Whisper is the better transcriber for Croatian. The app sends `language: 'hr'` (or `'en'` when the note so far is English) — auto-detect turns short Croatian clips into Slovenian/Serbian/Czech. The text so far goes in as Whisper's `prompt` for continuity. |
| embed | Gemini `gemini-embedding-001` only | — | Groq has no embeddings. |

Failover triggers on 429/5xx; a non-retryable 4xx is passed through. Diagnostics: `x-provider: groq|gemini`,
`x-model: <name>` request headers force a path; responses carry `x-provider` / `x-model-used`.
Secrets: `npx wrangler secret put GROQ_API_KEY` (console.groq.com) and `GEMINI_API_KEY`. `GET /health` shows what is set.

### Models and quota (2026-08-25)

- `gemini-2.5-flash` returns **404 "no longer available to new users"** on this key → `ENRICH_MODEL = gemini-3.5-flash`.
- Free tier is **5 requests/min per model**, shared across every worker on the key (burin included). The worker retries a
  429 once on `FALLBACK_MODEL` (`gemini-3.5-flash-lite`, its own quota bucket). For real traffic enable billing — the
  app's queue treats 429 as retryable (2s/8s/30s) and falls back to the heuristic after 3 attempts.
- `GET /health` shows the configured models and which ones the key may call.

### Voice capture — `transcribe` endpoint

Native speech recognition needs a dev build, so in Expo Go the capture sheet records with `expo-audio`
(`RecordingPresets.HIGH_QUALITY`, .m4a) and sends the clip as `inlineData` to `POST { endpoint: 'transcribe' }`.
Gemini returns the spoken text (diacritics, punctuation, "deseti šesti" → "10.6."), it lands in the input for a quick
look, then the normal capture → enrich pipeline runs. `src/services/ai/transcribe.ts` tries `audio/mp4` → `audio/aac`
→ `audio/m4a`. The button appears only when the proxy is configured; iOS keyboard dictation works regardless.

### Harness modes

```bash
npm run p0 -- --heuristic          # local baseline, no network
npm run p0 -- --proxy              # through the deployed worker (URL from .env), ~8 req/min; --rpm=N to change
GEMINI_KEY=... npm run p0          # direct Gemini
```
On 429 the harness waits the `retry in Xs` Google returns and retries (up to 4×). `p0-harness/report.md` is gitignored.

Bonus: swap the model or provider without an app update.

---

## 2. Enrich

### System prompt — `src/services/ai/prompt.ts` (`buildSystemPrompt`)

Shared verbatim with the harness. Context: today's date + weekday, timezone, known anchors, learned prefs.
The prompt itself is written in Croatian (the primary note language); the model answers in the note's language.

Rules (abridged; full text in code):
1. Always at least one semantic trigger with **synonyms and hypernyms**.
2. Ask ONLY what cannot be derived. Lead time NEVER.
3. Max 2 questions, 2–4 tap options; exception `kind: 'date'`.
4. Output language = note language.
5. `future_need` without a date → quiet `low` time fallback.
6. Unknown person → `needs_anchor`, DON'T invent a date.
7. `summary` ≤ 8 words, third person.
8. `category` snake_case key.
9. **Relative time is always resolved to a date, never asked**: "sljedeći tjedan" = next Monday 09:00, "krajem tjedna" = Friday 15:00,
   "za 2 tjedna" = today + 14 d, etc. If any time expression exists, a time trigger exists and a time question is forbidden.
10. **Intent definitions with examples** — gpt-oss needs them (harness went 57 % → see report): gift covers wants/likes/birthdays;
    future_need covers tradesmen/services even when written as a fact; contact only for bare contact details; idea for
    "might do someday"; fact for places/passwords/sizes.

### `responseSchema` — `enrichSchema`

Gemini `responseSchema` is a JSON Schema subset. **No `anyOf`/`oneOf`** — payload fields are flat and nullable:
`iso_datetime, keywords, anchor_person, anchor_kind, offset_days, place_query, person`.
`propertyOrdering` fixed. `temperature: 0.2`.

### Post-processing (mandatory) — `src/domain/enrich/ingest.ts`

The LLM output is a proposal, not truth. `ingest(raw, ctx)` does, tested:

1. Max 2 triggers with `certainty: low`.
2. `anchor_person` → existing `anchor.id` (case-insensitive) and `fire_at`; otherwise `needsAnchor` + pending triggers (`anchor_id NULL`, person in payload).
3. `place_query` is NOT a coordinate → skipped until geocoding (M5).
4. `iso_datetime` in the past → next year if that is in the future, otherwise dropped.
5. ⚠ **Never adds a trigger of a type the user edited by hand** (`user_edited`); old enrich-owned triggers go to `removeTriggerIds`.
6. `DEFAULT_CHAINS[intent]` fills the chain if the LLM didn't; learned `lead_time.<intent>` replaces the first step (and the LLM's default offset).
7. Always ≥ 1 semantic trigger (from entities/summary if needed).
8. `future_need` without time → quiet fallback (`auto_servis` 6 mo, default 6 mo) at 19:00.
9. Questions: drop lead-time questions; drop a "when?" options question once a real time trigger exists; drop the date
   question if the anchor exists or nobody can be attached to it; options ≥ 2; max 2; add "Kad je Anin rođendan?" when an
   anchor is needed. Date questions carry `person`/`anchorKind` so the answer can create the anchor on its own.
10. A date question with **no anchor trigger and no `needs_anchor`** (Groq does this) → derive the person from
    `entities.people[0]`, build the pending chain, keep the question. `answerAnchor()` also creates the default chain when
    the note has no anchor reminders yet — answering must always change something visible.
11. `status`: `needs_input` if there are questions/anchors, otherwise `enriched`.

### Policy layer before ingest — `src/domain/enrich/reconcile.ts`

Runs on every model answer (not on the heuristic, which *is* the rules). Full catalogue and rationale in
`docs/records/2026-08-25-enrichment-policy-layer.md`. Highlights that came straight from device bugs:

- **Places are never people** — `isLikelyPlace()`: capitalised word after u/na/iz/do/prema… or a known city stem
  ("u Zadru" produced "Kad je Zadruov godišnjica?").
- **Spoken dates** — `parseSpokenDate()`: "treći petog", "trećeg svibnja", "dvadeset trećeg drugog", "3. svibnja 2027"
  (dictation writes numbers as words; Whisper is also prompted to prefer digits).
- **Wedding anniversary** → pseudo-person `Brak` (`MARRIAGE_PERSON`): label "Godišnjica braka", question
  "Kad je godišnjica braka?", chain −14/−3. Never a guessed spouse or a place.
- **Stated occasion date wins** — model time triggers on other days are dropped as hallucinations; model anchors
  receive our `anchor_month_day` → `inferredAnchor`, no question.
- **Intent corrections need a signal** — service categories flip `fact/contact → future_need` only with a referral
  marker (name, price, "preporučio"); "lijek koji mi je pomogao" and "boja zida" stay `fact`.
- `anchorQuestion(person, kind, lang)` in `ingest.ts` is the single place the date question is worded; the clarify
  card's sheet title uses it too.

### Queue — `src/services/ai/queue.ts`

`capture()` → `kickEnrichQueue(50)`. The queue takes `pending` notes, 3 attempts, backoff 2s/8s/30s.
Retryable error (network/429/5xx) → the heuristic fills triggers **immediately**, status stays `pending` for a later remote upgrade.
Final failure → the heuristic is the answer. After a Gemini enrich → `embedNote()`.

---

## 3. Embeddings — `src/services/ai/embed.ts`

```ts
// document (note) — stored
{ model: 'models/gemini-embedding-001', content: {parts:[{text: `${summary}\n${rawText}\n${keywords}`}]},
  taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 }
// query (search / new note)
{ taskType: 'RETRIEVAL_QUERY', outputDimensionality: 768 }
```

⚠ **`taskType` must differ** for document and query. Embedding both as `RETRIEVAL_DOCUMENT` visibly degrades search quality.

Storage: `Float32Array` → BLOB (`toBlob/fromBlob`, `src/domain/search/cosine.ts`). Up to ~5000 notes plain JS cosine runs < 20 ms.
Semantic triggers are **not evaluated in the background**. Reactive only: search screen; new note (400 ms debounce, keyword chip "≋ već imaš nešto o ovome"); Today on open.

---

## 4. Edit chat — function calling (M7)

Not free text. The LLM emits **the same `Mutation` types** from `domain/types.ts`:
`set_time, shift_offset, add_trigger, remove_trigger, set_anchor, edit_summary, set_keywords`.

Context in the prompt — **without this "the day after tomorrow" does not work**: note, summary, today + weekday + TZ, anchors, list of triggers with IDs and resolved dates.

### Diff + confirmation, always

`describeMutation()` (`domain/mutations.ts`) yields the diff lines. `[Primijeni]` → `applyMutations(noteId, muts, 'ai_chat')`. Never a silent apply.

| User says | Mutations |
|---|---|
| "saw it at Müller for 199€" | `edit_summary` + `add_trigger` location |
| "I bought it" | `set_state done` × whole chain, note → archived |
| "not birthday, anniversary" | `set_anchor` with new kind |
| "move to the morning, always" | mutation **+** `prefs.hour.default` |

Offline: chat locked with a clear empty state. **Manual is the baseline, AI is the accelerator.**

---

## 5. M0 harness — `p0-harness/`

```
p0-harness/
  fixtures/notes.jsonl     ← 50 REAL notes, written by the user (4 format examples inside)
  enrich.ts                ← same prompt + schema as the app; --heuristic baseline
  eval.ts                  ← metrics + report.md (gitignored)
```

Fixture fields: `text`, `expected{intent,triggers,needs_anchor}`, `acceptable_questions` (substrings; `[]` = none),
`answer` (correct option), `anchors` (context), `search_query` (how you'd search in 6 months → keyword proxy for recall).

Measures: `questions_per_note`, `zero_question_rate`, `unacceptable_question_rate`, `intent_accuracy`, `expected_trigger_types`,
`needs_anchor_accuracy`, `option_hit_rate`, `semantic_recall` (proxy), `schema_valid`, `latency_p50/p95`. Exit code 1 if the gate fails.

**Gate fails → iterate the prompt. Don't build UI.**
