import { describe, it, expect } from 'vitest';
import { TOAST_VISIBLE_MS, showToast, showToastIfGone, toastVisible, toastRemaining } from './toastHold';

const T0 = 1_000_000;

describe('capture toast lifetime', () => {
  it('a new save shows the toast for that note', () => {
    const s = showToast(null, 'n1', T0);
    expect(s).toEqual({ id: 'n1', shownAt: T0, text: '', kind: 'saved' });
    expect(toastVisible(s, T0)).toBe(true);
  });

  it('a second save replaces the first — the bar always points at the newest note', () => {
    const s = showToast(showToast(null, 'n1', T0), 'n2', T0 + 500);
    expect(s.id).toBe('n2');
    expect(s.shownAt).toBe(T0 + 500);
  });

  it('stays up for the whole window and is gone at its end', () => {
    const s = showToast(null, 'n1', T0);
    expect(toastVisible(s, T0 + TOAST_VISIBLE_MS - 1)).toBe(true);
    expect(toastVisible(s, T0 + TOAST_VISIBLE_MS)).toBe(false);
    expect(toastVisible(null, T0)).toBe(false);
  });

  it('remaining time counts down to zero and never below', () => {
    const s = showToast(null, 'n1', T0);
    expect(toastRemaining(s, T0)).toBe(TOAST_VISIBLE_MS);
    expect(toastRemaining(s, T0 + 1500)).toBe(TOAST_VISIBLE_MS - 1500);
    expect(toastRemaining(s, T0 + TOAST_VISIBLE_MS + 99)).toBe(0);
  });
});

describe('answering a question shows the card only once the first one is gone', () => {
  it('while the "saved" card for the same note is still up, the answer does not restart it', () => {
    const first = showToast(null, 'n1', T0, 'Branki je rođendan');
    expect(showToastIfGone(first, 'n1', T0 + 3000, 'Branki je rođendan')).toBe(first);
  });

  it('once it has gone, the answer shows an "answered" card', () => {
    const first = showToast(null, 'n1', T0);
    const s = showToastIfGone(first, 'n1', T0 + TOAST_VISIBLE_MS + 1, 'Branki je rođendan');
    expect(s.kind).toBe('answered');
    expect(s.shownAt).toBe(T0 + TOAST_VISIBLE_MS + 1);
  });

  it('a card for a DIFFERENT note is replaced as usual', () => {
    const other = showToast(null, 'n2', T0);
    expect(showToastIfGone(other, 'n1', T0 + 10).id).toBe('n1');
  });
});
