# 2026-08-25 — Device-testing session: dialect, "done", and the silent-failure class

## Context

A long device-testing session with Marko. Most reports had the same shape and it is worth naming, because it
decides how the rest of this project should be tested:

> The app produced a **correct-looking title and no reminder at all.**

That is the worst failure mode this product has. A visible error invites a retry; a note that looks filed but
schedules nothing is discovered months later, when the reminder does not arrive. Four separate bugs this
session were of exactly that class, and none of them would have shown up in a typecheck or a happy-path test.

## Decisions

### 1. Dialect is an input, not an edge case

"Nazvati kuma u sridu" parsed to no date: the weekday table only had ijekavica. People dictate the way they
speak and Whisper transcribes it faithfully, so `temporal.ts` and `heuristic.ts` now read ikavica and
kajkavian alongside the standard — `sridu`, `ponediljak`, `nedilju`, `prikosutra`, `misec`, `v sredu`,
`petek` — plus the everyday trade vocabulary (`auspuh`, `šoferšajba`, `kvačilo`, `bojler`, `šterika`).

Two pre-existing bugs surfaced while doing it, both affecting standard Croatian too:

- Category stems required the whole word, so `zubar` never matched **"zubara"** — "naručiti se kod zubara" got
  no category, hence the wrong fallback interval.
- `za 2 miseca` resolved to **2 days**, because the ikavica stem was missing from the unit dispatch.

Car makes and models (~75 of them) are now explicitly never people: "mali servis za Polo" used to offer to buy
Polo a birthday present.

### 2. Composed time expressions resolve period-first

`za N mjeseci + Nth weekday` must move N calendar months **first**, then find the occurrence inside that month.
The parser was finding the weekday first and dropping the month offset, so "za 2 mjeseca u prvu nedjelju"
landed on the coming September. Permanent regression test:
`resolves_weekday_occurrence_inside_relative_future_month`.

Month arithmetic now clamps rather than overflowing — `31 Jan + 1 month` was giving **3 March**, because
`setMonth` rolls through February.

### 3. "God" is the anniversary of a death

Dalmatian "god" ("babi je god") was read as a birthday, i.e. the app would cheerfully suggest **buying a
present for someone who had died**. It now has its own `AnchorKind: 'memorial'` with a quiet −7/−1 chain and
wording that never says "rođendan". Decided in `reconcile()` so no model can override it.

Guarded against over-matching: "god" only matches as a whole word, so "godina"/"godišnji"/"godišnjica braka"
are untouched.

### 4. "Riješeno" is one concept at two levels

The app had two unrelated meanings of done: a per-reminder state hidden in an Alert menu, and an "Arhiviraj"
action that the Sve tab displayed as "Riješeno". A note holds several errands, so:

- tick every reminder → the note archives itself
- mark the note done → the remaining reminders switch off

`src/domain/noteStatus.ts` holds the rules (11 tests). The **semantic trigger is excluded** from both: it is
what makes the note findable in six months, so it is never tickable, has no menu, and survives the note being
done. It is now shown as a plain "Pronalazi se po: …" row rather than a reminder you could pretend to finish.

### 5. Notification refill coalesces forward

`if (running) return running` handed an **in-flight** promise to callers who arrived after the data changed.
Ticking a reminder off and straight back on meant the second refill never ran: active in the database, absent
from the OS. `coalesce()` now queues one fresh run behind the current one.

### 6. Holidays match by stem

"Na Veliku Gospu" found nothing, because only "velika gospa" and "velike gospe" were listed. Matching by word
stem covers the whole paradigm in one entry. A holiday named in passing ("Božić je moj najdraži blagdan") no
longer sets a reminder — the copula divides describing from intending.

## Also decided

- **UI language follows the DEVICE**, never the note (`ui/theme/locale.ts`).
- **`temperature: 1`** for Gemini enrich: 3.x is trained to reason at 1, and lowering it degrades reasoning
  rather than making extraction safer. Determinism comes from the schema and `reconcile()`, not the sampler.
- **Model chain by quota, not by preference**: `3.5-flash-lite` (500/day) is primary, `3.5-flash` (**20/day**)
  is the fallback despite reasoning better. Voice stays on Whisper — `gemini-3.5-transcribe` rejects our
  request shape with 400 and is 25/day anyway.
- **Free text in the clarify flow**, as an escape only: a "Nešto drugo…" chip when every offered option misses.
  The typed answer is kept as a keyword rather than discarded. Hard rule 4 updated.
- **Palette**: olive-black ground, lime `#D7EC7C` accent. Lime is a LIGHT accent, so `onAccent` is dark —
  anything hardcoding white-on-accent breaks (two such places were found in `VoiceOrb`).

## Consequences

- Tests 116 → **481**, all green; zero native imports in `src/domain`.
- The failure class above is now the thing to test for: after any parser or enrich change, check that a note
  which *should* schedule something actually did — not just that the app did not crash.
- `p0` harness has not been re-run since the prompt shrank; its numbers are stale.

## Related

- `docs/records/2026-08-25-temporal-parser.md` — why time lives in TypeScript
- `docs/records/2026-08-25-enrichment-policy-layer.md` — why `reconcile()` decides
- `CLAUDE.md` hard rules 4, 12, 13
