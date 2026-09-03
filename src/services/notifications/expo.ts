// M4 — the real OS scheduler. Needs a dev build: expo-notifications does not deliver in Expo Go (Android since
// SDK 53, iOS partially), which is why MockScheduler existed at all.
//
// Everything domain-facing stays in `types.ts`; this file is the only place that knows about expo-notifications.
//
// Traps this file exists to respect (docs/03-NATIVE.md):
//  - **An Android channel's sound is frozen when the channel is created.** Changing SOUND_FILE later does nothing
//    unless the channelId changes too — hence CHANNEL_ID carries a version suffix. Bump it, never edit in place.
//  - iOS silently drops the 65th pending notification. `capacity()` reports 64 and refill.ts keeps a reserve.
//  - A date-trigger in the past never fires and iOS rejects it — we skip those rather than let them vanish silently.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ScheduledInfo, ScheduledNotification, Scheduler } from './types';

/**
 * Bump the suffix whenever the sound or the channel's importance changes — Android freezes both at creation and
 * a user who installed the old build would keep the old sound forever.
 */
export const CHANNEL_ID = 'reminders-v1';
/** Bundled under assets/sound/, and declared in app.json's expo-notifications plugin so it lands in the build. */
const SOUND_FILE = 'ding.wav';

/** Data we hand back to ourselves when the user taps a notification (see handleNotificationTap). */
export interface NotificationData {
  triggerId: string;
  noteId: string;
  /** 'question' → an enrich question push (questionPush.ts): tap lands on Danas, where the ClarifyCard is. */
  kind?: 'question';
}

let channelReady = false;

/** Create the Android channel once per launch. No-op on iOS. */
async function ensureChannel() {
  if (Platform.OS !== 'android' || channelReady) return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Podsjetnici',
    importance: Notifications.AndroidImportance.HIGH,
    sound: SOUND_FILE,
    vibrationPattern: [0, 200, 120, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    enableVibrate: true,
  });
  channelReady = true;
}

export const ExpoScheduler: Scheduler = {
  kind: 'expo',

  async schedule(n: ScheduledNotification) {
    await ensureChannel();
    // The OS refuses a date in the past, and a silent refusal here would mean a reminder that exists in the DB and
    // nowhere else — this project's characteristic failure. The trigger row stays active either way.
    if (n.fireAt <= Date.now()) return '';
    return Notifications.scheduleNotificationAsync({
      content: {
        title: n.title,
        body: n.body,
        sound: SOUND_FILE,
        data: { triggerId: n.triggerId, noteId: n.noteId } satisfies NotificationData,
        // The key must be ABSENT, not undefined. expo-notifications forwards a present-but-undefined
        // categoryIdentifier to iOS, which cannot cast nil into its non-optional String field and throws
        // "Cannot cast 'nil' for field 'categoryIdentifier'". refill.ts sets it to undefined for every note
        // that is not a gift — so this crashed on every ordinary reminder.
        ...(n.category ? { categoryIdentifier: n.category } : {}),
        // Same-day reminders are the ones worth interrupting a Focus for; the rest wait their turn.
        interruptionLevel: isToday(n.fireAt) ? 'timeSensitive' : 'active',
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(n.fireAt),
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
    });
  },

  async cancel(osId: string) {
    if (!osId) return;
    await Notifications.cancelScheduledNotificationAsync(osId).catch(() => undefined);
  },

  async cancelAll() {
    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
  },

  async listScheduled(): Promise<ScheduledInfo[]> {
    const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
    const out: ScheduledInfo[] = [];
    for (const r of all) {
      const data = r.content.data as Partial<NotificationData> | undefined;
      if (!data?.triggerId) continue;
      const t = r.trigger as { type?: string; date?: number | string } | null;
      const fireAt = t && t.date != null ? new Date(t.date).getTime() : 0;
      out.push({ osId: r.identifier, triggerId: data.triggerId, fireAt });
    }
    return out.sort((a, b) => a.fireAt - b.fireAt);
  },

  // iOS drops the 65th pending notification without an error. Android allows far more, but one number keeps the
  // rotating window's behaviour identical on both platforms — and the window is what makes 500 reminders work.
  capacity: () => 64,
};

function isToday(t: number): boolean {
  const a = new Date(t);
  const b = new Date();
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
