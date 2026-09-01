# 2026-08-28 (second session) — the parser's blind spots, the first-run pass, and M4

## Context

The day's second device session, straight after `2026-08-28-ui-session-and-onboarding.md`. Same shape as the
first: Marko used the app and reported what looked wrong; almost every report turned out to be a real bug in OUR
deterministic code, not in the model. The session ended with M4 (notifications) implemented but not yet seen
deliver — that needs the dev build.

Tests 578 → **655**, typecheck clean throughout. Nothing committed except the first push of the repo itself
(Marko asked for it explicitly; see "The repo is on GitHub now").

---

## 1. The silent-failure class, again — six parser bugs

Every one of these produced a correct-looking title and a wrong (or missing) reminder. Rule 13 says time is never
the model's job, so each was a gap in `temporal.ts` / `heuristic.ts` / `reconcile.ts`.

| What Marko wrote | What happened | Root cause |
|---|---|---|
| "u 10 misecu u prvu sridu" | 2.9. at 10:00 | a month by number needed the ordinal dot; dictation never writes one, so "10" was read as an hour |
| "Branki je rođendan u subotu" | asked "Kad je rođendan?" and threw the Saturday away | the occasion anchor only accepted an EXPLICIT day-month; a relative date is a date too |
| "za 2 tjedna u subotu" | Friday 11.9. (today + 14) | the two signals never met; and "za **dva** tjedna" was not a number at all |
| "danas je rođendan u 10", written at 17:00 | an invented 18:00 | the morning ten had passed, the resolver rolled it to tomorrow, and E23 then made up "the next full hour" |
| "u pola 9" / "u 9 i 30" | 09:00 | spoken half-hours were not parsed |
| "rođendan u 8 u petak" (no name) | asked for the date | the heuristic builds an anchor only when a PERSON is named, so nothing carried the Friday to `reconcile` |

The fixes are rules with tests, never one-off patches: `statedOccasionDate()`, `weeksAhead` on the weekday
signal, `numberWords()`, the evening reading of a passed bare hour, `parseClock`'s half-hour forms, and
`reconcile` reading the text's date itself when nobody is named.

**The habit that came out of it:** `device-2026-08-28.test.ts` now ends with a table of odd everyday Croatian
sentences → the day each must land on. When a dictation lands wrong, it goes there first.

---

## 2. Two rules about reminders

**Same day → exactly two.** A birthday "večeras u 8" produced FOUR: the −21/−7/−1 chain rolled into 2027 and
"na dan" sat at the default 09:00, already past. Now (E23) a moment today gets an hour before and the moment
itself, for occasions and tasks alike — the chain is for things ahead, not for tonight. A stated hour that has
genuinely passed produces nothing: an 18:00 nobody asked for is worse than no reminder.

**The occasion's own day is bound to the anchor** (E22, offset 0 "na dan"), never a free time trigger. It used to
be free, so moving the birthday moved three reminders and left the fourth behind. The same rule now applies to a
hand-made date change: `domain/sameDay.ts` collapses the chain when the new date is today, in the same mutation
batch, so one undo restores everything.

Left open on purpose: the default chain is **3** (−21/−7/−1) and the day-of makes it 4 only when the date came
from the text or a time was chosen. Marko has not yet said whether it should be 4 everywhere.

---

## 3. The first ten minutes

A code-side UX audit, then Marko picked what to change.

- **One word for "saved": Zapisano.** "Zapamćeno" and "Spremljena" are gone; every button says "Zapiši".
- **The "Zapisano" card**: the words just filed, a lime hairline, a rail that drains over its 8 seconds so the
  wait is visible, and the whole card opens the note. Answering a clarify question shows it again as
  "Podsjetnik postavljen" — but only once the save's own card has gone (`showToastIfGone`).
- **Question exits say their consequence**: "Bez podsjetnika" on the date question (there is something to lose),
  "Preskoči pitanje" on the rest (there is not).
- **"Sve" ⇄ "Kronologija" swapped.** A *chronology* is the order things happen, so that is the reminder view;
  the default "Sve" is by date written, the list you scroll to find something. The count line now says which
  ordering is on, because the icon alone was invisible.
- **Never ask WHO a person is.** An options answer becomes a keyword and moves no reminder, so "Čiji je
  rođendan?" was a tap with no effect. `WHO_QUESTION` drops it, and the prompt says not to produce it.
- **"Novo" on Today**: built, narrowed to notes with no other place on the screen, then **parked**
  (`SHOW_NOVO = false`). It was a fourth block on a screen whose point is the resurface moment. The code stays
  wired. "Iz kontakata" is parked the same way — a permission prompt inside the first question was one step too
  many.
- The row in "Danas još" now shows the **event**, not its herald: "20:00 … sat prije u 19:00" (`domain/herald.ts`).
- Reminders list by **when they happen** (`domain/reminderOrder.ts`). The repo sorts by `fire_at`, which
  `markFired` clears — so a fired one-off sank to the bottom regardless of its time.
- Title/text edits **cancel on a tap outside**; ✨ next to the text offers a re-read without scrolling; and the
  re-read is offered on **any changed word** now, not past a 34 % threshold. Case, punctuation and diacritics
  stay quiet.
- The date question takes an **optional time**, greyed until it is actually set, and it re-times only the day-of
  reminder (`domain/anchorTime.ts`) — the leads keep their hour.

---

## 4. Voice: the prompt was the problem, not the provider

"Prepoznavanje glasa na hrvatskom radi očajno."

Whisper's `prompt` parameter is **not an instruction** — it is a sample of text whose style and vocabulary the
decoder imitates. The worker was forwarding whatever text parts the app sent, and the app sends a five-line
Croatian instruction block ("Transkribiraj govor DOSLOVNO…"). Whisper imitated its wording and register, and
Croatian came out garbled.

Now only a part explicitly marked `voicePrompt: true` (the note text so far) reaches it, behind a short
natural-sounding Croatian example whose dates show the format. The instructions still go to Gemini, which does
read them. Recording dropped to mono — Whisper downmixes anyway, so the second channel only doubled the upload.

Worth remembering: the provider was never at fault. `GEMINI_TRANSCRIBE = ""` meant transcription had been going
to Whisper all along.

---

## 5. M4 — implemented, not yet seen

`ExpoScheduler` sits behind the existing `Scheduler` interface, so no domain code changed and Vitest never
touches a native module. Expo Go keeps the mock (`inExpoGo`).

- Sound `assets/sound/ding.wav`, Android channel `reminders-v1`. **A channel's sound is frozen at creation** —
  changing the sound means a new channel id, never an edit.
- `notification-icon.png` is a white silhouette (Android masks it), generated by the same `render.mjs`.
- iOS `timeSensitive` for same-day reminders only.
- **Permissions are asked once, when the capture sheet closes for the first time — written or not.** Not at
  launch (a prompt in front of an empty app is the easiest "Don't allow" there is) and not mid-recording, which
  is what the mic used to do. Each is behind our own explanation, and "Ne sada" does not spend the OS's single
  prompt.
- Tap opens the note, including from a cold start. Every launch rebuilds the OS queue from the DB (hard rule 2).
- The debug timeline gained "Test obavijest (10 s)" — the one thing no unit test can answer.

**Nothing has been seen deliver.** That needs the dev build.

### The build itself

Validated locally first, so the free tier's build quota was not spent on a config error: `npx expo prebuild
--platform android` (iOS prebuild needs macOS, but the plugins are the same) put `notification_icon.png` in all
five densities, `ding.wav` in `res/raw`, `#D7EC7C` in colors.xml and the `reminders-v1` channel in the manifest;
`npx expo export --platform ios` bundled 5 MB with no import errors. The generated `android/` folder was deleted
afterwards — it is gitignored, and prebuild had also rewritten the `android`/`ios` npm scripts to `expo run:*`,
which had to be put back (we build through EAS).

Then `npx eas build --profile development --platform ios`. EAS added `expo-dev-client` (how the installed app
attaches to Metro) and, with it, `expo-updates` + `runtimeVersion` + an `updates.url`; it also duplicated and
padded `android.permissions`, which was trimmed back to what the app uses. Two things worth remembering: the
encryption question is answered **yes** (standard/exempt — HTTPS only; revisit at M6's E2E encryption), and the
`development` EAS environment has **no env vars**, so a build launched without Metro has no proxy URL and runs
offline on the heuristic. Connected to `npm start` it reads the local `.env`.

---

## 6. Brand assets, and the repo is on GitHub now

`scripts/brand/render.mjs` holds one bulb glyph and produces icon, adaptive icon, splash lockup, favicon and the
notification icon. A hand-drawn set drifts the moment the palette moves. Lime on both platforms: the launcher is
the one place the app is seen next to everything else.

Marko asked for the first push, so the repo now lives at `github.com/mprtenjaca/remember-this` (branch `main`).
The standing rule is unchanged — **do not commit unless he asks**.

---

## Consequences

- Tests 578 → **655**; typecheck clean; the 54 temporal tests never regressed.
- Four new pure domain modules, each with tests: `sameDay.ts`, `anchorTime.ts`, `herald.ts`, `reminderOrder.ts`,
  plus `recentNotes.ts` for the parked "Novo".
- A sweep of ~65 everyday sentences through the whole chain found **15 more defects** that are still open — see
  the Next Step in `CLAUDE.md`. The worst are silent: "Verzija 2.10" schedules 2 October, "Platit kaznu u roku 8
  dana" schedules nothing, "svakih godinu dana" is ignored, "u ponoć" is not a time.

## Related

- `docs/records/2026-08-28-ui-session-and-onboarding.md` — the first half of the same day
- `docs/records/2026-08-25-temporal-parser.md` — why every one of section 1's bugs belonged in TS, not the prompt
- `CLAUDE.md` hard rules 5 (ask only what cannot be derived), 11 (`reconcile()` decides), 13 (time is never the
  model's job)
