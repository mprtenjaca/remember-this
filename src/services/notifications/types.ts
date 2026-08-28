// Scheduler adapter. Domain code never imports expo-notifications directly.

export interface ScheduledNotification {
  triggerId: string;
  noteId: string;
  fireAt: number;
  title: string;
  body: string;
  category?: string; // 'gift' → "Kupljeno ✓" / "+7 dana" actions (M4)
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
