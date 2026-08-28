import { describe, it, expect } from 'vitest';
import { draftOutcome } from './draftPolicy';

describe('draftOutcome', () => {
  it('keeps text when the user chose to save it as unfinished', () => {
    expect(draftOutcome(false, true, 'keep', false)).toBe('keep');
  });

  it('discards nothing when the user discarded a never-saved draft', () => {
    expect(draftOutcome(false, true, 'discard', false)).toBe('none');
  });

  it('removes the existing draft row when the user discards', () => {
    expect(draftOutcome(false, true, 'discard', true)).toBe('discard');
  });

  // Swipe-back never reaches the dialog. Losing words is worse than an extra row in "Nedovršeno".
  it('keeps text when the dialog never resolved', () => {
    expect(draftOutcome(false, true, 'ask', false)).toBe('keep');
  });

  it('clears the source draft once the note is saved', () => {
    expect(draftOutcome(true, true, 'ask', true)).toBe('discard');
  });

  it('does nothing when a fresh capture was saved', () => {
    expect(draftOutcome(true, true, 'ask', false)).toBe('none');
  });

  it('does nothing when an empty box is closed', () => {
    expect(draftOutcome(false, false, 'ask', false)).toBe('none');
  });

  it('deletes the draft when its text was emptied by hand', () => {
    expect(draftOutcome(false, false, 'ask', true)).toBe('discard');
  });

  // A save that failed resets `saved`, so the words must come back as a draft rather than vanish.
  it('keeps text when a failed save handed it back', () => {
    expect(draftOutcome(false, true, 'ask', true)).toBe('keep');
  });
});
