// A payload key must never be PRESENT with an undefined value.
//
// The first iOS dev build (2026-09-01) threw on every ordinary reminder:
//
//   Failed to schedule notification, Cannot cast 'nil' for field 'categoryIdentifier'
//   of type Optional<String> → Caused by: Cannot cast 'Optional(nil)' to String
//
// refill built `category: note.intent === 'gift' ? 'gift' : undefined`, so for every note that is not a gift
// the key existed holding undefined. expo-notifications forwarded it to the native iOS side, which cannot cast
// nil into its non-optional String field. The device log showed the shape exactly: a gift note scheduled fine
// ("1 triggers"), the next ordinary one crashed.
//
// This is the project's characteristic failure in a new place — note and trigger row were both correct in the
// DB, and only the OS-facing edge broke, so nothing on screen looked wrong. expo.ts now spreads the key in
// only when there is a value.

import { describe, it, expect } from 'vitest';
import { notificationCategory } from './notificationCategory';
import type { Intent } from './types';

const ALL_INTENTS: Intent[] = ['future_need', 'task', 'fact', 'idea', 'gift', 'contact'];

describe('notificationCategory', () => {
  it("is 'gift' for a gift note", () => {
    expect(notificationCategory({ intent: 'gift' })).toBe('gift');
  });

  it('is undefined for every other intent', () => {
    for (const intent of ALL_INTENTS.filter((i) => i !== 'gift')) {
      expect(notificationCategory({ intent })).toBeUndefined();
    }
  });

  it('never returns a value that would reach iOS as nil', () => {
    // The crash was not about WHICH value — it was a key that exists holding nothing. So: every result is
    // either a non-empty string or a plain undefined the caller is obliged to omit. An empty string would
    // pass the `n.category ?` guard in expo.ts as falsy and be omitted too, but it would be a lie in the
    // payload, so it must not occur.
    for (const intent of ALL_INTENTS) {
      const c = notificationCategory({ intent });
      expect(c === undefined || (typeof c === 'string' && c.length > 0)).toBe(true);
      expect(c).not.toBe('');
    }
  });
});

describe('notificationCategory — an unenriched note', () => {
  it('has no category when intent is still null', () => {
    // Capture never waits for the LLM (hard rule 1), so a note can have a scheduled reminder before it has an
    // intent. The old inline `note.intent === 'gift'` handled this by accident; the signature now says it.
    expect(notificationCategory({ intent: null })).toBeUndefined();
  });
});
