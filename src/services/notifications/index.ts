// FAZA A: always the mock. When the dev build exists, swap in ExpoScheduler here
// (Constants.appOwnership === 'expo' ? MockScheduler : ExpoScheduler). Domain code stays untouched.

import { MockScheduler } from './mock';
import type { Scheduler } from './types';

export const scheduler: Scheduler = MockScheduler;

export type { Scheduler, ScheduledNotification, ScheduledInfo } from './types';
