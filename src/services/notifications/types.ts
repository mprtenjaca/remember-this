// Scheduler adapter. Domain code never imports expo-notifications directly.

export interface ScheduledNotification {
  triggerId: string;
  noteId: string;
  fireAt: number;
  title: string;
  body: string;
  /**
   * Intended for 'gift' → "Kupljeno ✓" / "+7 dana" notification actions. NOT WIRED YET: no category is
   * registered with setNotificationCategoryAsync and runtime.ts ignores actionIdentifier, so a notification
   * carrying this shows no buttons. The value is passed through so the day the actions land, refill needs no
   * change. Set from `domain/notificationCategory.ts`, and omitted entirely when absent — passing it as
   * undefined is what crashed the first dev build; see the note in expo.ts.
   */
  category?: string;
}

export interface ScheduledInfo {
  osId: string;
  triggerId: string;
  fireAt: number;
}

export interface Scheduler {
  readonly kind: 'mock' | 'expo';
  schedule(n: ScheduledNotification): Promise<string>; // returns osNotificationId
  cancel(osId: string): Promise<void>;
  cancelAll(): Promise<void>;
  listScheduled(): Promise<ScheduledInfo[]>;
  capacity(): number; // iOS 64, Android ~500 — simulate iOS everywhere
}
