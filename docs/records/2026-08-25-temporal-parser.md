# 2026-08-25 — Time belongs to TypeScript, meaning belongs to the model

## Context

Device testing produced a run of date bugs that all had the same shape: the model dated a note it had no
business dating. "Godišnjica, trebam rezervirati restoran" came back with a confident time trigger in
January 2027. "Mehaničar u Zadru" produced `future_need_mechanic` as a category. A note with no time at all
picked up "~6 months from now" as though it were a real date.

Two hard constraints came out of the same session:

- **Tokens are the budget, not requests.** Groq's free tier caps at 200k tokens/day. The full system prompt
  plus response schema cost ~2.5k input tokens per note, i.e. ~77 notes/day — and an afternoon of testing
  exhausted it (`Limit 200000, Used 199172`).
- **A big prompt made the model slower, not smarter.** `gpt-oss-120b` stalled on the full prompt until
  Cloudflare killed the request at ~125 s (524), while the same model answered a short prompt in 0.44 s.

Marko's proposal was to split the pipeline and treat the long prompt as a *specification* rather than as a
system prompt, keeping every rule but moving the computable ones into code.

## Decision

```
text ──parseTemporal (TS)──► TemporalSignal[]    dates, offsets, recurrence, deadlines, defaults, certainty
     ──LLM─────────────────► intent, category, semantic keywords, anchor person, summary, questions
     ──reconcile (TS)──────► final truth: our signals OVERRULE the model's
```

`src/domain/enrich/temporal.ts` owns every temporal rule, with 54 tests beside it:

| Class | Examples |
|---|---|
| absolute | `10.6.`, `10.6.2027`, `10. lipnja`, `u listopadu` |
| clock | `u 15h`, `15:30`, `at 3pm`; today if the hour is ahead, else tomorrow |
| relative | `sutra`, `prekosutra`/`preksutra`, `za 2 dana`, `za tjedan dana`, `sljedeći tjedan/mjesec` |
| weekday | `u petak`, `sljedeći petak`, `ove subote`, `za vikend` |
| parts | `krajem tjedna` (pet 15:00), `sredinom mjeseca` (15., 10:00), `krajem godine`, `pred kraj tjedna` |
| day parts | `ujutro` 09, `podne` 12, `popodne` 15, `navečer` 19, `noću` 21 |
| deadline | `do petka`, `do 15.9.`, `najkasnije`, `prije petka`, `rok` — outranks every other signal |
| after | `nakon petka` → the day after (explicitly *not* a deadline) |
| offset | `2 dana prije`, `tjedan dana prije`, `dan poslije` → `offsetDays`, never a date |
| recurring | `svakih 6 mjeseci`, `svaki ponedjeljak`, `svake godine`, `jednom godišnje` |
| season | `prije ljeta`, `oko Božića` → low certainty, **no** date |
| contextual | `kad budem u Zagrebu`, `kad budem mijenjao gume`, `ako se opet pokvari` → phrase only |

Two invariants run through all of it:

1. **Never invent.** An offset with no known occasion, a season, a conditional → `fireAt: null`. The phrase is
   still returned so it can become search keywords.
2. **Never return the past.** A day-month that has passed rolls to next year; an explicitly past year drops.

`reconcile()` now discards the model's time triggers outright (E21) and substitutes the parsed signal. The
model is no longer even asked for `iso_datetime`, offsets or recurrence: the schema shrank to
`summary / language / intent / category / keywords / anchor / needs_anchor / questions`, and the request carries
a pre-resolved `TEMPORAL` line ("sutra 09:00", "rok → 15.09.2026 09:00") with the instruction not to touch it.

## What stayed with the model

Only what a language model is actually better at: intent boundaries (the `gift` / `future_need` / `fact`
distinctions), category, **semantic keywords** (synonyms and superordinates a regex will never produce),
the anchor *person*, conditional understanding, and the summary. All the long-form rules remain written
down — in `docs/02-AI-LAYER.md` as the specification, not as prompt payload.

## Consequences

- Prompt 4767 → 3633 chars, schema 2458 → 2195. **~2578 → ~1961 tokens/note (−24%): ~77 → ~101 notes/day.**
- Dates are unit-testable for the first time: 54 temporal tests + 12 authority tests ("a model-invented date
  never survives"). Suite 116 → 227 tests.
- Behaviour no longer varies with the provider *or* with the model's mood about arithmetic.
- Output tokens drop too — the model returns a flat object with no time fields, which also cuts latency.
- `normalize()` accepts both the slim and the legacy `triggers[]` shape, so cached/stale answers keep working.
- The heuristic path benefits identically: it and the model both feed the same parser.

## Related

- `src/domain/enrich/temporal.ts`, `temporal.test.ts`, `authority.test.ts`
- `docs/02-AI-LAYER.md` — the full rule specification
- `docs/records/2026-08-25-enrichment-policy-layer.md` — the earlier `reconcile()` decision this extends
- `CLAUDE.md` hard rule 11 ("the model proposes, `reconcile()` decides") — now also true of time
