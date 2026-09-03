// Which notification category a note's reminders carry — pure, so it can be tested without a native module.
//
// It lives in domain rather than beside refill.ts because `services/scheduling/refill.ts` imports the
// scheduler, and that reaches react-native: importing it from Vitest fails to parse. The rule itself is
// policy, not plumbing, so domain is where it belongs anyway.

import type { Intent } from './types';

/**
 * The category identifier for a note, or undefined when it has none.
 *
 * NOT WIRED YET: no category is registered with setNotificationCategoryAsync and the tap handler ignores
 * actionIdentifier, so a notification carrying 'gift' shows no buttons. It is passed through so that the day
 * "Kupljeno ✓" / "+7 dana" land, refill needs no change.
 *
 * The contract that matters to the caller: when this returns undefined the payload key must be OMITTED, never
 * set to undefined. See notificationCategory.test.ts for what that cost on the first dev build.
 *
 * `intent` is nullable because a note that has not been enriched yet has none — capture never waits for the
 * LLM (hard rule 1), so a reminder can be scheduled before any intent exists. That note gets no category.
 */
export function notificationCategory(note: { intent: Intent | null }): string | undefined {
  return note.intent === 'gift' ? 'gift' : undefined;
}
