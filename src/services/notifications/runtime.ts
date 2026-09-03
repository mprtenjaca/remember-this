// Wiring the OS notification runtime into the app: how a notification looks while the app is open, what happens
// when the user taps one, and putting the OS back in step with the DB after a restart.
//
// Hard rule 2: the `triggers` table is the source of truth and `os_notification_id` is only a cache. A new phone,
// a reinstall or an OS that quietly dropped its queue must never cost a reminder — so on every launch we rebuild
// the OS schedule from the DB (refillScheduledWindow) rather than trusting what the OS says it has.

import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { refillScheduledWindow } from '@/services/scheduling/refill';
import { inExpoGo } from './index';
import type { NotificationData } from './expo';

/**
 * How a notification behaves while the app is in the foreground: it shows AND it dings (Marko, 2026-09-01).
 *
 * A reminder that arrives while you happen to be in the app is not less true, and a silent banner reads as a
 * bug — you cannot tell a working notification from a broken one. The known cost is that this ding can land on
 * top of the app's own completion ding (services/sound); the arriving reminder is the more important of the two.
 */
export function configureNotificationHandler() {
  if (inExpoGo) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Open what a notification is about. Safe to call before navigation is ready — expo-router queues it. */
function openFromNotification(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data as Partial<NotificationData> | undefined;
  if (!data?.noteId) return;
  // A question push lands on Danas, not on the note: the ClarifyCard (with its tap-to-answer chips) lives
  // there, and the note detail has no question UI at all.
  if (data.kind === 'question') {
    router.navigate('/');
    return;
  }
  router.push({ pathname: '/note/[id]', params: { id: data.noteId } });
}

/**
 * Tap handling + rehydration, mounted once from the root layout.
 *
 * `getLastNotificationResponseAsync` covers the cold start: the app was killed, the user tapped a notification,
 * and the listener below would never have fired for it.
 */
export function useNotificationRuntime(ready: boolean) {
  useEffect(() => {
    if (inExpoGo || !ready) return undefined;

    // The OS keeps its own queue across restarts, but ours is the DB. Rebuild rather than trust.
    void refillScheduledWindow();

    let alive = true;
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (alive && r) openFromNotification(r);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    // A notification that fires while the app is open has already been "delivered" — the trigger it belongs to may
    // now be spent, so the window needs refilling to bring the next one in.
    const received = Notifications.addNotificationReceivedListener(() => void refillScheduledWindow());
    return () => {
      alive = false;
      sub.remove();
      received.remove();
    };
  }, [ready]);
}
