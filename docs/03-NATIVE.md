# Native constraints

Read this before coding. Three things in here are sources of bugs that
**don't show in development** but three weeks later on the user's phone.

---

## 1. Expo Go matrix (SDK 54)

| Module | Expo Go | Note |
|---|---|---|
| `expo-sqlite` | ✅ | use this, not `op-sqlite` (native module) |
| `expo-router` | ✅ | v6 |
| `react-native-reanimated` 4 + `react-native-worklets` | ✅ | babel-preset-expo adds the worklets plugin itself |
| `react-native-gesture-handler` | ✅ | |
| `expo-haptics` | ✅ | |
| `expo-blur` | ✅ | |
| `expo-contacts` | ✅ | anchor lookup works already in Phase A |
| `expo-location` foreground | ✅ | |
| `@react-native-community/datetimepicker` | ✅ | native time pickers |
| **`expo-notifications`** | ❌ | push removed from Expo Go since SDK 53; local ones unreliable |
| **geofencing / background location** | ❌ | |
| **`expo-background-task`** | ❌ | |
| **`@shopify/react-native-skia`** | ❌ | |
| **`op-sqlite`** | ❌ | native, comes later if needed |
| speech recognition | ❌ | 3rd-party native |
| share extension / widget / Siri | ❌ | needs native configuration |

> **Expo Go supports up to SDK 54.** Do not raise `expo` above `~54` until a dev build exists.
> Rule: if a module is not in the Expo Go SDK bundle, it needs a dev build.

**Conclusion:** M0–M3 of the plan works 100% in Expo Go. No bottleneck.

---

## 2. You don't have to wait 7 days

| You have | Command | EAS credits |
|---|---|---|
| Mac + Xcode | `npx expo run:ios` | **0** |
| Android Studio | `npx expo run:android` | **0** |
| Nothing | `eas build -p ios --profile development` | 1 |

A local build is unlimited. An iOS **simulator** build needs no Apple Developer account.

What works in the simulator/emulator: ✅ local scheduled notifications · ✅ geofencing (Xcode → Debug → Simulate Location;
Android emulator → Extended controls → Location) · ✅ notification categories and actions · ⚠️ remote push in the iOS simulator
via an `.apns` file · ❌ real background behaviour under battery pressure — needs a physical device.

### Burn list — install everything before the first EAS build

```bash
npx expo install \
  expo-notifications expo-location expo-background-task expo-task-manager \
  expo-symbols @shopify/react-native-skia @gorhom/bottom-sheet
# already installed: expo-contacts expo-haptics expo-blur expo-device expo-application expo-localization
#                    @react-native-community/datetimepicker react-native-screens react-native-safe-area-context
```

Plus the `app.json` plugin configuration (background modes, permission strings, notification icon) — **all before the build**,
because changing an `app.json` plugin means a new build.

---

## 3. Adapter pattern — how to work without native modules

Domain code never imports `expo-notifications` directly.

`src/services/notifications/types.ts`:
```ts
export interface Scheduler {
  kind: 'mock' | 'expo';
  schedule(n: ScheduledNotification): Promise<string>;   // returns osNotificationId
  cancel(osId: string): Promise<void>;
  cancelAll(): Promise<void>;
  listScheduled(): Promise<ScheduledInfo[]>;
  capacity(): number;                                    // iOS 64 — simulate NOW
}
```

`mock.ts` writes to `debug_scheduled` (PHASE A). `index.ts` exports `scheduler` — when the dev build exists,
this becomes `Constants.appOwnership === 'expo' ? MockScheduler : ExpoScheduler`. Same for `Geofence` (M5).
`Contacts` needs no mock — works in Expo Go.

### Debug timeline screen — `app/_debug/timeline.tsx`

The stand-in test device: swaps in a `FakeClock` (`setClock()`), emits `dbEvents 'clock'` → every `useLiveQuery` hook
re-fetches; "Evaluiraj Today" runs `loadToday()` (fire + fatigue); shows the next 90 days, OS slots (mock) / 64,
waiting in DB, surfacings, anchors; "Seed 4 primjera" inserts the canonical notes and Ana's birthday 14.03.

---

## 4. OS limits — the three that will bite

### iOS: max 64 pending scheduled notifications

The 65th is **silently dropped**. No error. 20 anchors × 3 reminders = 60 slots → you're full before you started.

Solution — a rotating window, `src/services/scheduling/refill.ts`: `cancelAll()` → the next `capacity − RESERVE(14)`
active triggers by `fire_at` → `schedule()` (with `clampToWakingHours`) → `os_notification_id` into the DB.
Called: after every mutation, on app foreground, after enrich, and (M4) in the daily background task.

### iOS: max 20 monitored geofence regions

**Rotating pool** (M5): all location triggers in the DB; monitor the **19 nearest + 1 re-eval region** (20 km);
exiting the big region → recompute → re-register. Android has no such limit (~100), but the same logic saves battery.

### Contacts: the month is 0-indexed

```ts
const b = contact.birthday;   // { month: 2, day: 14 }  ⟵ 2 = MARCH
```
`src/domain/contactBirthday.ts` → `birthdayToMonthDay()` does the `+1`; a unit test with a hard-coded contact exists
(`contactBirthday.test.ts`). Verify on both OSes before release.

---

## 5. Other traps

- **Android 13+** — runtime `POST_NOTIFICATIONS`. Ask in onboarding with an explanation, **never on cold start**.
- **Android 14+** — `SCHEDULE_EXACT_ALARM` is restricted. Inexact is enough for this app.
- **Doze mode** can delay 15–30 min. For "at 15:00" use `CalendarTrigger` with `allowWhileIdle`.
- **`READ_CONTACTS` is heavy.** Realistically 15–25% of contacts have a birthday. Hence: **P1 = date picker** (one tap, zero permissions),
  **P2 = onboarding import**. Contacts are a bonus, not a dependency. (Implemented that way in `ClarifyCard`.)
- **Silent push on iOS is throttled.** An optimisation, never a dependency — the fallback is the same refill on foreground.
- **Timezone and DST.** All `fire_at` values are epoch ms; the computation goes through the local calendar (`setDate/setHours`).
  A DST transition test exists (`resolve.test.ts`).

---

## 6. Changing phones

**Yes, all scheduled notifications die.** They live in that device's OS, not in your DB.

| What is lost | iCloud / Android backup |
|---|---|
| Scheduled OS notifications | ❌ never restored |
| SQLite database | ⚠️ *maybe* |
| iOS ↔ Android switch | ❌ nothing |

**Push doesn't solve this.** The token is per-install. What survives is **a server that has the data** — hence sync in M6.

### `rehydrateNotifications()` — M4, ~30 lines

On every launch: compare `Application.getAndroidId()` / `getIosIdForVendorAsync()` with the stored `install_id`
(`prefs`). Same → `refillScheduledWindow()`. Different → `cancelAll()`, `os_notification_id = NULL` for active,
refill from `triggers`, store the new id. Works **only because `triggers` is the source of truth**.

---

## 7. Notifications: three layers

Local scheduled and push look **identical** to the user. For "remind me in 3 weeks" local is technically better —
offline, no server, OS guarantees delivery, zero cost.

```
LAYER 1 — local scheduled (M4)   baseline, always set, offline
LAYER 2 — silent push (M8)       content-available, refresh text + 64-slot refill
LAYER 3 — visible push (M8)      ONLY what local cannot do: digest, cross-device, re-engagement
```

**Rule against duplicate notifications:** one trigger = exactly one channel. Anchor and time → layer 1; digest → layer 3.

### Notification categories (M4)

```ts
await Notifications.setNotificationCategoryAsync('gift', [
  { identifier: 'bought', buttonTitle: 'Kupljeno ✓' },
  { identifier: 'plus7',  buttonTitle: '+7 dana' },
  { identifier: 'open',   buttonTitle: 'Uredi', options: { opensAppToForeground: true } },
]);
```
`bought` → `set_state done` for the rest of the chain + archive (already implemented as the `done` reaction in `services/today.ts`).
`plus7` → `applyMutations([{op:'shift_offset', days:7}])`. Both in the background handler, without opening the app.
