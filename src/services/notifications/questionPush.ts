// "Imam jedno pitanje" — a local notification when enrichment ends in a question and the user has already
// left (Marko's call, 2026-09-01).
//
// The one flow this covers: dictate a note, pocket the phone. Enrichment finishes a few seconds later inside
// iOS's background grace period; without this the question sits invisibly on Danas until the next open, and
// the reminder it is blocking (usually a birthday date) silently does not exist yet. Tapping the notification
// lands on Danas, where the ClarifyCard is waiting at the top.
//
// What this deliberately is NOT:
//  - not a reminder: hard rule 2 (a trigger row behind every OS notification) is about reminders surviving a
//    reinstall. A question push is transient — its durable form IS the `needs_input` status, which Danas
//    already renders. If this notification is lost, nothing is lost.
//  - not anti-fatigue traffic: the max-2-a-day budget (hard rule 6) guards SPONTANEOUS resurfacing. This is a
//    direct response to something the user wrote seconds ago, the same category as the capture toast.
//  - never shown while the app is ACTIVE — the ClarifyCard is already on screen there, and a banner over it
//    would announce the thing you are looking at.
//
// Presented immediately (Android via a ChannelAwareTrigger, iOS via a null trigger) rather than scheduled a
// few seconds out: refill wipes the OS queue with cancelAll() on every mutation, and a scheduled-but-not-yet-
// delivered push would lose that race whenever two notes enrich back to back. A PRESENTED notification is
// untouchable by cancelAll.

import { AppState, Platform } from 'react-native';
import { inExpoGo } from './index';

/** Delivered question pushes by note, so answering in the app clears the tray entry. Module-level and
 *  transient on purpose: after a cold start the map is gone, and a stale tray entry merely opens Danas. */
const delivered = new Map<string, string>();

export interface QuestionPushInput {
  noteId: string;
  /** The question text, e.g. "Kad je rođendan?" — the notification's title, so the ask is the headline. */
  question: string;
  /** The note's own words, so the user knows which note is asking. */
  summary: string;
  hr: boolean;
}

/** Fire the push if the app is in the background. Safe to call always; it decides for itself. */
export async function maybeNotifyQuestion(input: QuestionPushInput): Promise<void> {
  if (inExpoGo) {
    if (__DEV__) console.log(`[questionPush] (expo go, skipped) ${input.question}`);
    return;
  }
  // 'active' → the ClarifyCard is already on screen. 'background'/'inactive' → the user is gone; notify.
  if (AppState.currentState === 'active') return;

  try {
    // Imported lazily so this module stays loadable in Expo Go (index.ts picks the mock there, but an eager
    // native import at module scope would still evaluate).
    const Notifications = await import('expo-notifications');
    const { CHANNEL_ID } = await import('./expo');
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: input.question,
        body: `${input.hr ? 'Jedno pitanje o' : 'One question about'}: ${input.summary}`,
        sound: 'ding.wav',
        data: { noteId: input.noteId, kind: 'question' },
      },
      // Immediate presentation. On Android the channel-only trigger presents now ON our channel (a null
      // trigger would land on the fallback channel with no sound); on iOS null means "present now".
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
    delivered.set(input.noteId, id);
  } catch {
    // No permission, or the OS said no — the question still waits on Danas, which is the durable path.
  }
}

/** The question was answered (or dismissed) in the app — clear the tray entry so it does not ask twice. */
export async function dismissQuestionPush(noteId: string): Promise<void> {
  const id = delivered.get(noteId);
  if (!id) return;
  delivered.delete(noteId);
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.dismissNotificationAsync(id);
  } catch {
    // Already gone, or Expo Go — either way there is nothing to clear.
  }
}
