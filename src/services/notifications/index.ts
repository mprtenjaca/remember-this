// Which scheduler the app runs on.
//
// Expo Go cannot deliver notifications (expo-notifications is unsupported there since SDK 53), so it keeps the
// mock, which writes what WOULD be scheduled into debug_scheduled for the debug timeline. A dev build or a real
// build gets the OS scheduler. Domain code imports `scheduler` and never knows the difference.

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { MockScheduler } from './mock';
import { ExpoScheduler } from './expo';
import type { Scheduler } from './types';

/** True in Expo Go, where notifications are not delivered at all. */
export const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const scheduler: Scheduler = inExpoGo ? MockScheduler : ExpoScheduler;

export type { Scheduler, ScheduledNotification, ScheduledInfo } from './types';
export { CHANNEL_ID } from './expo';
