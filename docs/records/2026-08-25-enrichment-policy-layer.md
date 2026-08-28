# 2026-08-25 — Enrichment policy layer (`reconcile`) and provider strategy

## Context

Device testing on 2026-08-25 showed the app's behaviour depended on which model happened to answer:

- "Uzeti majci poklon" → saved with only a semantic trigger, no birthday question (model returned `fact`).
- "Godišnjica braka je treći petog sljedeće godine … u Zadru" → question "Kad je **Zadruov** godišnjica?"
  (place taken as a person), spouse guessed as "Žena", a hallucinated time trigger on 15.01.2027, and the
  date in the text ("treći petog" = 3.5.) ignored.
- Groq gpt-oss-120b intent accuracy on the 59-note harness: 57 % raw; a date question without any anchor
  trigger left the clarify card with nothing to bind the answer to, so answering did nothing.

Marko's requirement: *"eksplicitno mu postavi sve edge caseove — gubi nam se smisao ako ovo popuštamo."*

## Decision

The model's output is a **proposal**. A deterministic policy layer, `src/domain/enrich/reconcile.ts`, runs on
every provider's answer (Groq, Gemini; the heuristic *is* the rules so it is exempt) before `ingest()`:

```
normalize()  → shape safety (arrays, enums, fallbacks)          src/domain/enrich/normalize.ts
reconcile()  → OUR edge-case rules, model-independent            src/domain/enrich/reconcile.ts
ingest()     → drafts, questions (≤ 2), anchors, status          src/domain/enrich/ingest.ts
```

The harness applies the identical chain, so gate metrics measure the app, not the raw model.

### Edge-case catalogue (each has a test in `reconcile.test.ts` / `heuristic.test.ts`)

| # | Situation | Rule |
|---|---|---|
| E1 | gift + person, no occasion word, no date | birthday anchor → ask "Kad je X rođendan?" unless the anchor is known |
| E2 | gift + person + anchor already known | 0 questions, default chain |
| E3 | gift + person + date in the text (digits **or spoken**: "treći petog", "3. svibnja") | anchor inferred, 0 questions |
| E4 | gift without a person | semantic only, no question |
| E5 | lowercase relation ("majci", "bratu", "sestri") | the person ("Mama", "Brat", "Sestra") |
| E6 | relative time in the text ("sljedeći tjedan", "krajem tjedna") | time trigger; a "when?" question is dropped |
| E7 | bare hour already passed today | tomorrow |
| E8 | tradesman / service / doctor written as a fact or contact | `future_need` — but only with a referral signal (name, price, "preporučio", …); "lijek koji mi je pomogao" stays `fact` |
| E9 | restaurant / café / bakery without task verb **and** time | `fact` |
| E10 | model asks "when?" while a real time exists | dropped |
| E11 | model asks a date with nobody to bind | person derived from entities, else question dropped |
| E12 | text without diacritics | identical handling (`fold()`) |
| E13 | brands next to a person ("neki Nikon ili Canon") | not people |
| E14 | task verb + time | `task` |
| E15 | tradesman written as a contact card | `future_need`, not `contact` |
| E16 | wedding anniversary | person = pseudo `Brak`; label "Godišnjica braka"; question "Kad je godišnjica braka?"; chain −14/−3 |
| E17 | occasion date stated in the text | model time triggers on any *other* day are dropped (hallucinations); model anchors get our `anchor_month_day` |
| — | capitalised word after u/na/iz/do/prema… or a known city stem | a place, never a person (`isLikelyPlace`) |

Supporting changes: `EnrichQuestion.person/anchorKind` so an answer can create the anchor even when no pending
trigger exists; `answerAnchor()` creates the default chain when the note has none; the clarify card hides
optimistically on answer.

### Provider strategy (same day)

- Gemini free tier is **5 RPM per model**, shared with the `burin-summary` worker; `gemini-2.5-flash` returned
  404 "no longer available to new users". → Worker primary is **Groq `openai/gpt-oss-120b`** (30 RPM / 1000 RPD),
  failover Gemini `gemini-3.5-flash` → `-lite` on 429/5xx. Voice: **Groq Whisper large-v3-turbo** with
  `language: hr` pinned (auto-detect produced Slovenian/Czech) and the note-so-far as prompt.
- The app always sends/reads the Gemini request/response shape; the worker translates. Provider or model
  changes never touch the app (`worker/wrangler.toml [vars]`).

## Alternatives considered

- **Better prompts only.** Improved intent 57 % → 85 %, but cannot make behaviour provider-independent and
  cannot be unit-tested. Kept as a complement (rules 9/10 in the system prompt), not as the mechanism.
- **Gemini structured output with strict schema everywhere.** Groq JSON mode has no hard schema; Gemini lite
  rejected `thinkingConfig`; both still omitted arrays. `normalize()` makes shape a non-issue.
- **Switching models.** Quality varied per note, not per model. The layer fixes the class of problem.

## Consequences

- Any new mis-classification is fixed by adding a rule + test in `reconcile.ts`, then re-running the harness.
  Do **not** add a rule for a single fixture (e.g. "Marko iz Ericssona … React Native developere" is left alone).
- Harness after the layer: 0 errors, schema 100 %, trigger types 100 %, recall 100 %, questions 0.15/note,
  intent 86 % (gate 90 % — remaining misses are genuinely fuzzy fact/idea/future_need boundaries).
- Latency p95 fails only because 429 retry waits are counted; irrelevant for the app (queue backoff).

## Related

- `docs/02-AI-LAYER.md` — provider layer, prompt rules, edge-case list (kept in sync with this record)
- `CLAUDE.md` hard rule 11
