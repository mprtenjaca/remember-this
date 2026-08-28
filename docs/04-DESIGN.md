# Design

## The tension to acknowledge

The ask is "awwwards animations" **and** "feels like a native app". Partly contradictory —
awwwards rewards custom, native feel comes from the *absence* of custom.

Resolution: **native chrome, signature content.**

| Layer | Rule |
|---|---|
| Navigation stack, sheets, inputs, gestures, pickers, alerts | 100% platform-native. Never custom. |
| Cards, dock, orb, resurface moment | All the character lives here. |

Boldness is spent in **one place**: the orb. Everything around it is quiet glass.

History: v1 ("Stratum" — cold paper, Departure Mono time marks) was replaced on 2026-08-25 after Marko brought
references he loved: deep-blue liquid-glass dashboards with a single glowing orb. The brief's words win.

---

## Direction: *Deep*

A night field of one blue. The screen is a dark ink-blue gradient with a soft light source at the top; content
sits on frosted glass (translucent fill, 1 px light border, a brighter hairline on the top edge that reads as a
reflection). One object glows: the orb you talk to.

### Colour — `src/ui/theme/tokens.ts`

Everything derives from **#1532DA** (hue ≈ 228°). Lighter tints keep the hue — no violet drift.

| Token | Value | Role |
|---|---|---|
| `accent` | `#1532DA` | the blue — buttons, active states, orb core, glows |
| `ion` | `#6F86FF` | lighter tint for accent text, rims, icons |
| `bgTop → bg → bgBottom` | `#0B1C7A → #050A2A → #02040F` | page gradient, light at the top |
| `glass` / `glassBorder` / `glassHighlight` | `rgba(120,150,255,.09)` / `rgba(160,180,255,.16)` / `rgba(200,214,255,.40)` | the liquid-glass recipe |
| `fg` / `fg2` / `muted` | `#EEF2FF` / 74% / 48% | text |
| `signal` | `#F5B23D` | **amber — ONLY when a memory surfaces** |
| `danger` | `#FF6B6B` | destructive, recording stop |

**The rule that carries the design:** amber appears **exclusively** on the surfacing card (hairline + badge + label).
Never in navigation, never on a button that is not a resurface. Warm on a blue field, it is unmistakable.

Themes: `deep` (default, regardless of OS), `paper` (light glass, opt-in), `system`. Picker in settings → M8.

### Typography — `src/ui/theme/fonts.ts`, `components/Txt.tsx`

| Role | Font | Component | Use |
|---|---|---|---|
| Display | **Manrope** 500/600/700 | `<Display>` | note titles, big numbers, empty states, capture input |
| Body | **Inter** 400/500/600 | `<Body>`, `<BodyMedium>`, `<BodySemibold>`, `<Label>` | UI, descriptions, buttons, section labels |
| Meta | **Inter Medium, tabular figures** | `<Mono>` / `<Meta>` | every date, time, offset and countdown |

Departure Mono is retired (read as a typewriter). Time still gets its own treatment — tabular figures so columns of dates
align — just not its own typeface. Type scale `T`: 11 / 13 / 15 / 17 / 22 / 34 / 48.

### Icons

Ionicons (`@expo/vector-icons`) everywhere — mic, stop, sparkles, sunny/layers/search for the dock, gift/time/location/person
for reminder kinds. No glyph characters, no emoji as icons.

---

## Signature: *the orb* — `components/VoiceOrb.tsx`

A radial-gradient sphere (ion → #1532DA → deep) with a wide soft glow, sitting on the right of the dock. It **breathes**
idle (scale 1 → 1.04 over 3.6 s). Tap → the capture sheet opens in voice mode already listening:

- **Listening**: two rings roll outward from the orb (1.6 s, staggered), the core swells with your voice (mic metering
  from `expo-audio`, 80 ms), and a 25-bar **waveform** under it follows the level — each bar with its own phase so the
  cluster breathes instead of moving as one block (`components/Waveform.tsx`).
- **Thinking** (transcribing): a thin bright arc spins around the orb; the icon becomes sparkles.
- Result lands in the field to check, then **Spremi**. A pencil in the dock opens the same sheet for typing.
- Capture is a native **modal** card (pull down to close), header has only ✕. The orb stage shows while there is no text
  or while recording/transcribing; "Radije tipkam" under the orb switches to the editor; the footer mic appends another
  dictation — the transcriber gets the text so far as context so the second take continues the sentence. Clips under
  0.8 s are dropped (Whisper hallucinates on silence). The footer pads itself by the keyboard height, so Spremi is never covered.
- Leaving the sheet with words in it never loses them: the text becomes a **draft** (AsyncStorage, max 10), shown on Today
  as "Nedovršeno" with a one-tap resume (`/capture?draft=<id>`) and an ✕ to discard; saving the note clears it.
- Note detail actions are one glass list (icon · what it does · why): Pročitaj ponovno / Arhiviraj / Obriši — not three
  stacked buttons. The clarify card hides the moment an answer is committed (optimistic), and reappears only if the write failed.
- Note detail draws its own small glass back button (native header drew a solid band above the gradient and iOS 26's
  glass back pill fought the design); swipe-back stays native.

Reduced motion: no breathing, no rings; the orb is static and the level still drives bar height (no motion loops).

### The surfacing (unchanged in spirit) — `components/SurfacingCard.tsx`

Glass card with an amber-tinted border springs up from the bottom (damping 14, stiffness 120); a 2 px amber hairline
fades over 600 ms; the date rolls from the note's day to today; one light haptic tick when the roll starts.
The only animation > 300 ms besides the orb, and the only place amber lives.

### Dock — `components/TabBar.tsx`

Floating glass pill (Danas / Sve / Traži / ✎) bottom-left, the orb bottom-right. Active tab = solid light circle with a dark
icon (like the reference). Scroll views pad their bottom by `DOCK_HEIGHT`.

### Glass — `components/Glass.tsx`

Real `BlurView` blur on iOS; Android gets the translucent fill only (Expo Go blur there is costly and looks worse than none).
Variants: `soft` (cards on the field) and `strong` (dock, sheets over content). `borderColor` for meaning: accent = question,
amber = surfacing, danger = failed.

---

## Copy

Active voice, sentence case, no filler. The user manages **reminders** (podsjetnici), not "triggers" — `trigger` never appears in UI.
UI copy is Croatian-first and follows the note's language (`hr`/`en`).

| Screen | Copy (HR) |
|---|---|
| Today, empty (0 notes) | *Ništa još. Zapiši nešto — vratit ću ti kad zatreba.* |
| Today, empty | *Danas ništa. Bolje propustiti nego lažno pozvati.* |
| Timeline, empty | *Prva bilješka. Piši kako govoriš, ostalo je moj posao.* |
| Search, empty | *Što ti je trebalo prije pola godine?* |
| Capture, voice idle | *Reci što želiš zapamtiti* · *npr. „Ana želi Dyson fen za rođendan”* |
| Capture, listening | *Slušam…* · `0:07 · tapni za kraj` |
| Enrich failed | *Nisam uspio pročitati ovu bilješku. Spremljena je. [Pokušaj ponovno]* |

**The resurface copy is the most important text in the app.** It must say *why now* (`notificationCopy()` in `refill.ts`):
✅ *Anin rođendan je za 3 tjedna. — Ana želi Dyson fen.* ❌ *Podsjetnik: Ana Dyson fen.*

---

## Quality floor

- Dynamic type up to 200%: `maxFontSizeMultiplier` 2 (display/body), 1.6 (meta/buttons)
- Contrast ≥ 4.5:1: `fg2` on glass over the gradient is fine; `muted` (48%) is for metadata only, never for essential copy
- Reduced motion respected (orb, surfacing, waveform loops)
- All tap targets ≥ 44 pt (dock tabs 48, orb 62, buttons 48, chips 40 + padding)
- Screen reader labels on the surfacing card include the **reason**; the orb announces "Zapiši glasom" / "Zaustavi snimanje"
- Both themes tested, not just deep

## What makes the app "necessary"

Not the animation. Decisive is **the first correct resurface.** Onboarding (M8) must produce that moment within the first 5 minutes:
import 3 old notes (or seed) and **immediately** show one that is relevant today, with the full surfacing moment.
