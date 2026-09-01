// Asking for the two OS permissions the app wants: notifications and the microphone.
//
// NOT on first launch: a permission sheet in front of an empty app is the easiest "Don't allow" a user ever taps,
// and the app has not yet shown what it would use them for. Both are asked once the user has been through the
// welcome and closed the capture sheet — written or not (askStartupPermissions below).

import * as Notifications from "expo-notifications";
import { AudioModule } from "expo-audio";
import { Alert } from "react-native";
import { uiLang } from "@/ui/theme/locale";
import { prefsRepo } from "@/db/repositories/prefs";
import { db } from "@/db";
import { clock } from "@/domain/clock";
import { scheduler } from "./index";

const PREF_ASKED = "notifications.asked";
const PREF_MIC_ASKED = "mic.asked";

export interface PermissionOutcome {
  granted: boolean;
  /** True when the OS prompt was actually shown by this call. */
  asked: boolean;
}

/** Already granted? Cheap enough to call on any screen. */
export async function notificationsGranted(): Promise<boolean> {
  if (scheduler.kind === "mock") return false;
  const { granted } = await Notifications.getPermissionsAsync();
  return granted;
}

/**
 * Ask once, at the right moment. Returns immediately when running on the mock (Expo Go), when the user has
 * already answered, or when the OS has already granted.
 */
export async function ensureNotificationPermission(): Promise<PermissionOutcome> {
  if (scheduler.kind === "mock") return { granted: false, asked: false };
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return { granted: true, asked: false };
  // The OS shows its prompt only once per install; asking again silently returns the old answer, so we remember
  // having asked and stop pestering. `canAskAgain === false` means only Settings can change it now.
  const d = db();
  const asked = await prefsRepo.get(d, PREF_ASKED);
  if (asked || !current.canAskAgain) return { granted: false, asked: false };
  await prefsRepo.set(d, PREF_ASKED, "1", clock.now(), true);
  const res = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return { granted: res.granted, asked: true };
}

/** Our own question first, so the OS dialog never arrives cold. Resolves false on dismiss. */
function ask(title: string, body: string, yes: string, no: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: no, style: "cancel", onPress: () => resolve(false) },
        { text: yes, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * The permission pass: notifications, then the microphone. Run once, when the capture sheet closes for the first
 * time — whether or not a note was written (Marko, 2026-08-28). By then the user has seen the welcome and the
 * sheet, which is the context both prompts need; asking mid-recording, as the mic used to, interrupts the very
 * thing being attempted.
 *
 * "Ne sada" is not an answer to the OS — the flag stays unset so the offer can come back later. Only an actual
 * OS prompt is remembered.
 */
export async function askStartupPermissions(): Promise<void> {
  const hr = uiLang() === "hr";
  const d = db();

  // 1. Notifications — the product's whole promise ("vratit ću ti kad zatreba") depends on this one.
  if (scheduler.kind !== "mock" && !(await prefsRepo.get(d, PREF_ASKED))) {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) {
      const yes = await ask(
        hr ? "Da te podsjetim kad zatreba?" : "Shall I remind you when it matters?",
        hr
          ? "Javljam se samo kad je nešto stvarno na redu — najviše dvaput dnevno, nikad noću."
          : "I only speak up when something is actually due — at most twice a day, never at night.",
        hr ? "Može" : "Yes",
        hr ? "Ne sada" : "Not now",
      );
      if (yes) await ensureNotificationPermission();
    }
  }

  // 2. Microphone — optional by design: writing is the app's main verb, speaking is the shortcut.
  if (!(await prefsRepo.get(d, PREF_MIC_ASKED))) {
    const current = await AudioModule.getRecordingPermissionsAsync().catch(() => null);
    if (current && !current.granted && current.canAskAgain) {
      const yes = await ask(
        hr ? "Želiš li diktirati bilješke?" : "Want to dictate your notes?",
        hr
          ? "Možeš izgovoriti bilješku umjesto tipkati. Snimka se prepiše u tekst i ne sprema se."
          : "You can speak a note instead of typing it. The recording is transcribed and never stored.",
        hr ? "Uključi mikrofon" : "Enable the microphone",
        hr ? "Ne treba" : "No thanks",
      );
      if (yes) {
        await prefsRepo.set(d, PREF_MIC_ASKED, "1", clock.now(), true);
        await AudioModule.requestRecordingPermissionsAsync().catch(() => undefined);
      }
    }
  }
}
