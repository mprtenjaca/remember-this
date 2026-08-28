# 2026-08-28 — A long UI session: honest labels, two views of "Sve", and the welcome

## Context

A device-driven session with Marko. Nothing here came from a plan: every item started as "this looks wrong"
while using the app, and several turned out to be real bugs hiding behind plausible-looking screens. The
session's through-line is the same one this project keeps rediscovering — **a screen that looks right is not
evidence that it is right**, and the failures worth chasing are the ones that leave no error behind.

Tests went 559 → 578; typecheck clean throughout. Nothing committed (Marko commits).

---

## 1. Silent failures found by using the app

Four bugs, none of which produced an error message.

### "Dolazi" could not see past 90 days

`loadToday()` looked ahead `startOfDay(now) + 90 * DAY_MS`. A yearly anchor resolves to its NEXT occurrence,
which is routinely 10+ months out — so a reminder for February 2027 existed in the database, was correctly
scheduled, and **appeared nowhere on screen**. The horizon is now 3 years (`UPCOMING_HORIZON_DAYS`), and the
list groups itself so distance costs a heading rather than a wall of rows.

### A surfacing dated in the future was open forever

`openToday(since)` had only a lower bound. `shown_at >= now - 3d` is trivially true for a row stamped in
January, so a surfacing written during dev time travel sat on Today every day until reacted to — which is
exactly how Marko saw a January reminder on an August screen. Now bounded at both ends (`isOpenOnToday()`,
7 tests).

The same trip left worse paperwork behind: time travel calls `markFired` **for real**, bumping `fire_count`,
flipping one-offs to `fired` and rolling yearly anchors a year forward. Restoring only the clock left those
reminders permanently spent. `reset` in the debug timeline now undoes both
(`surfacingsRepo.removeAfter`, `triggersRepo.rewindFiringsAfter`).

### Capture could file a note AND keep it as a draft

`saved.current = true` was set *after* `await capture(...)`, but the sheet unmounts the moment it closes. When
capture outlived the dismissal, the unmount cleanup asked "was this saved?", got `false`, and wrote a draft
for words that had already been filed. The flag is now claimed before the await — with a `catch` that hands
the text back to a draft if the write actually fails, so the fix cannot lose anything.

### A year word was parsed and then discarded

`"sljedeće godine u rujnu"` resolved to **this** September. `parseTemporal` read the month and dropped the
year, returning `{ fireAt: null, text: "9. mjesec" }` — identical to bare `"u rujnu"`. So a note about next
year became a note about next month. `NEXT_YEAR_QUALIFIER` now binds a year word to the month beside it, and
covers `dogodine` / `nagodinu` / `iduće godine`.

Writing the tests for that found a second one: **`"verzija 2.10"` became 2 October.** An identifier word
before a number (`verzija`, `model`, `broj`, `polica`, `soba`…) now blocks the date reading.
`temporalReal.test.ts` (33 tests) holds both, plus fragments, dialect, emoji, and two invariants over the
whole corpus: never schedule into the past, never throw.

---

## 2. Labels must not outlive the thing they describe

A reminder labelled "30 dana prije" kept that label after the user moved its date by hand, and sat next to the
new date contradicting it. Same for the guessed "za ~6 mjeseci".

The rule (`describesTiming()` in `domain/mutations.ts`): a label that states **WHEN** is dropped on a manual
date change; one that states **WHAT** ("Kupiti poklon") survives. The row then falls back to the date, which
is always true.

This forced a second correction. Both `set_time` and `shift_offset` had short inverses that restore only the
time — so undo brought the date back but left the label deleted. They now emit the FULL inverse (remove +
re-add) whenever the label changed, because undo must return *exactly* the previous state.

Related, same principle: a hand-made reminder is labelled "Podsjetnik", never "ručno" — how it was made is the
app's business, and the row already shows the date.

---

## 3. What the app is unsure about, said honestly

A low-certainty reminder used to say "tiho", then "nisam siguran". Both described a *feeling*; neither told
the user anything actionable. It is now a **sparkles icon** — already the app's sign for "I came up with this"
(orb, surfacing card, capture) — and it **disappears once `user_edited` is set**. Once the date is theirs,
whose guess it started as is history, and a doubt badge on a date you chose reads as the app doubting you.
The pencil badge went entirely: "you edited this" was never news to the person who edited it.

Marko's question during this — *"does a low-certainty reminder still push?"* — corrected an earlier claim of
mine. **It does.** `certainty` never gated delivery; it only orders competing reminders on the same day and
carries weight 0.2 in surfacing score.

### Guessing out loud

`ingest()` rule 5 invents a deadline when a `future_need` note has no time at all. That is a fair assumption
for a car service (6 months) and a coin toss for "veliki pregled kod oftalmologa". Now: the guess is **written
either way**, and a one-tap correction is offered *only* when the category has no rhythm
(`fallbackNeedsAsking`). Skipping the question must never leave a note that looks filed with nothing
scheduled.

Two details that cost time:

- An **interval is its own question kind**. `answerOption` keeps an answer as a keyword and moves no trigger,
  so offering "za 3 mjeseca" as a plain option would clear the question and change nothing.
- `ROUTINE_HEALTH` matches only words the **user** writes ("kontrola", "redovni"). Adding practitioner names
  ("zubar") silenced every health note, because the heuristic seeds its own category keywords into its output
  — including for the oftalmolog note that must ask.

---

## 4. "Sve" answers two different questions

Grouping the archive by creation date answered a question nobody asks. But grouping purely by reminder would
drop the "kad zatreba" notes, which are the point of the app.

So: two views behind an icon right of the heading, **and the title is the state** — **Sve** (by reminder's
month) ⇄ **Kronologija** (by date written). Undated notes collect under one **"Kad zatreba"** section at the
end, never under their own month: a month heading answers "when does this happen", so "Kolovoz 2026" sitting
below "Studeni" read as a month out of order rather than as a different axis.

Filters (kind + year) live behind **one icon-only button** that opens a `Sheet`, with an accent dot when
active. A permanent chip rack crowded the screen the list is the point of. Year chips come from the
**unfiltered** list — offering a year that filters to nothing reads as a bug, and a test asserts every offered
year yields at least one note.

---

> **Swapped later the same day.** Using it, Marko read "Kronologija" as *the order things happen* — which is the
> reminder view, not the date-written view. So now **Sve** (default) is by date written, the list you scroll to
> find something, and **Kronologija** is by the reminder's month. Same two views, names the other way round;
> the "Kad zatreba" section belongs to Kronologija.

## 5. Motion, sized to what changed

The Sve ⇄ Kronologija switch was first built as a full-screen lime wipe. It looked right on paper and was
wrong twice over: too big a gesture for a change of list order, and a disc sized to cover the screen from any
corner is several screenfuls of fill — translating that stuttered visibly on device.

It is now `FlipIcon`: the **button alone** spins, fills solid lime with a dark glyph, and swaps the glyph at
the half-turn where it is edge-on. **The list changes on the tap**, with the spin running alongside — gating
the list behind the animation made the button feel like it had missed the press. An animation is a flourish on
a change that already happened, never a gate in front of it.

Both bottom sheets (`Sheet`, `DatePickerSheet`) now drag down to dismiss and sit edge-to-edge with square
bottom corners. The undo toast became glass: it painted `t.c.fg`, a white slab across the olive-black ground,
the one element in the app ignoring its own palette.

---

## 6. Sound

`playDing()` — one cached `AudioPlayer`, created lazily so Vitest never touches the native module. It fires on
**every "riješeno"** (reminder tick, its menu, "Kupljeno ✓", whole note done), exactly once per tap, and never
on capture, edit or reopen. `playsInSilentMode: false` is deliberate: a phone on silent stays silent, and the
haptic still lands.

Custom notification sound is written into the M4 plan with its trap: an **Android channel's sound is frozen at
creation**, so changing it later needs a new `channelId`, not an edit.

---

## 7. The welcome, and two navigation traps

Three pages that SHOW rather than describe — a cursor typing a real note, the note card reading (pulsing dots)
then asking "Kad je rođendan?", and a surfaced card in the amber it earns only there. The last button opens
**capture**, not an empty Today: `docs/04-DESIGN.md` says the decisive moment is the first correct resurface,
so the user leaves the welcome with something written.

No orb anywhere. The orb means "speak", and the product wants people to **write** — voice is the weaker path.

Two traps cost most of the session's debugging, and both produced the same symptom: a blinking screen with
scheduler logs pouring out.

1. **`initialRouteName` does not pick the first route in expo-router.** It only sorts the stack's children
   (`sortRoutesWithInitial`); linking still resolves to the tabs. A reset appeared to do nothing.
2. **`useRootNavigationState()` throws when called from the root layout** — it assumes a route *inside* the
   Stack. The throw hit the error boundary, which remounted `Boot`, which re-ran `openDb()` → `refill`, in a
   loop. Readiness in a layout comes from `useNavigationContainerRef().isReady()`.

And the actual cause of the loop that survived both fixes: **`FirstLaunchGate` listened for `'state'`, which
its own `replace()` emits.** The guard lived in a ref inside the effect, so any re-created effect replaced
onto the route it was already on, remounting the welcome, emitting `'state'` again. Fixed by polling
`isReady()` instead of subscribing, with the sent-flag at **module level** so it outlives remounts.

Marko's observation — *"from dev it works, as the start screen it blinks"* — is what isolated it. That single
sentence ruled out the typewriter and pointed at the gate, because the debug preview path never goes through
it.

> A separate, real problem found on the way: the onboarding typewriter (`setShown` ~25×/s) inside a `FlatList`
> with an **inline `renderItem`** re-created that function every tick, re-rendering all pages, remounting the
> typewriter, restarting its timer. Few fixed pages → plain `ScrollView` + `React.memo`.

---

## Consequences

- Tests 559 → **578**, all green. Zero regressions in the 54 temporal tests.
- Two existing tests were rewritten rather than deleted: `normalize.test.ts` ("Zubar dr. Kovač" now legitimately
  reaches `needs_input`) and a mutations test that looked up a trigger by list position, which a full inverse
  moves to the end.
- The debug timeline gained an onboarding **preview** (`?preview=1`, closes with back, touches no flag) beside
  the real **reset**.

## Related

- `docs/records/2026-08-25-device-session-ux.md` — the silent-failure class this session kept meeting
- `docs/records/2026-08-25-temporal-parser.md` — why the year bug belonged in `temporal.ts` and not the prompt
- `CLAUDE.md` hard rules 3 (`user_edited` is sacred), 4 (max 2 questions), 5 (ask only what cannot be derived)
