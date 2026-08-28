// What happens to the words in the capture box when the sheet closes.
//
// Two failure modes bound this, and they pull in opposite directions:
//   - Filing every abandoned capture turned "Nedovršeno" into a bin nobody emptied. Discarding is a real
//     intention, so it has to be offerable.
//   - Losing typed words is unrecoverable. So anything that is NOT an explicit discard keeps the text —
//     including a swipe-back, which dismisses the sheet without ever reaching the dialog.

/** What the dismiss dialog decided, if it was shown at all. */
export type DraftChoice = 'ask' | 'keep' | 'discard';

export type DraftOutcome = 'keep' | 'discard' | 'none';

/**
 * @param saved   the text was already filed as a note
 * @param hasText there are non-whitespace words in the box
 * @param choice  what the user picked; 'ask' means the dialog never resolved (swipe-back, killed sheet)
 * @param hadDraft this capture was opened from an existing draft, so there is a row to clean up
 */
export function draftOutcome(saved: boolean, hasText: boolean, choice: DraftChoice, hadDraft: boolean): DraftOutcome {
  // Filed as a note: the draft it came from has served its purpose.
  if (saved) return hadDraft ? 'discard' : 'none';
  if (choice === 'discard') return hadDraft ? 'discard' : 'none';
  if (hasText) return 'keep';
  // Emptied the box of a draft that existed → the user deleted it deliberately.
  return hadDraft ? 'discard' : 'none';
}
