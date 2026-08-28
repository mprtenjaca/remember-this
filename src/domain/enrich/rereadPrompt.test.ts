// Editing the note may invalidate the reasoning behind its reminders — but a typo fix must not nag.

import { describe, it, expect } from 'vitest';
import { shouldOfferReread, textDistance } from './rereadPrompt';

describe('trivial edits are left alone', () => {
  const quiet = [
    ['Nazvati Marka', 'Nazvati Marka'],
    ['Nazvati Marka', 'Nazvati marka'], // case only
    ['Konoba Mare ima odlican brudet', 'Konoba Mare ima odličan brudet'], // diacritics
    ['Mehaničar Dario, klima', 'Mehaničar Dario — klima'], // punctuation
  ];
  for (const [a, b] of quiet) {
    it(`"${a}" → "${b}" does not ask`, () => {
      expect(shouldOfferReread(a!, b!).ask).toBe(false);
    });
  }
});

describe('substantial rewrites ask', () => {
  it('a completely different note asks', () => {
    const d = shouldOfferReread('Mehaničar Dario popravio klimu', 'Zubar dr. Kovač, kontrola za pola godine');
    expect(d.ask).toBe(true);
  });

  it('rewriting most of the words asks', () => {
    expect(shouldOfferReread('Ana želi Dyson fen', 'Ana bi voljela neki dobar usisavač').ask).toBe(true);
  });
});

describe('a small edit that changes the MEANING still asks', () => {
  it('adding a time to a note that had none', () => {
    const d = shouldOfferReread('Nazvati Marka', 'Nazvati Marka sutra');
    expect(d.ask).toBe(true);
    expect(d.reason).toBe('meaning-words-changed');
  });

  it('removing the date', () => {
    expect(shouldOfferReread('Nazvati Marka sutra', 'Nazvati Marka').ask).toBe(true);
  });

  it('changing which day', () => {
    expect(shouldOfferReread('Nazvati kuma u srijedu', 'Nazvati kuma u petak').ask).toBe(true);
  });

  it('turning a note into a birthday note', () => {
    expect(shouldOfferReread('Marta voli lavandu', 'Marta voli lavandu, rođendan 10.6.').ask).toBe(true);
  });

  it('changing the date itself', () => {
    expect(shouldOfferReread('Rođendan 10.6.', 'Rođendan 12.8.').ask).toBe(true);
  });
});

describe('textDistance', () => {
  it('is 0 for identical text and 1 for nothing in common', () => {
    expect(textDistance('a b c', 'a b c')).toBe(0);
    expect(textDistance('a b c', 'x y z')).toBe(1);
  });

  it('is symmetric enough and scales with the change', () => {
    const small = textDistance('jedan dva tri cetiri pet', 'jedan dva tri cetiri sest');
    const big = textDistance('jedan dva tri cetiri pet', 'sest sedam osam devet deset');
    expect(small).toBeLessThan(big);
    expect(small).toBeLessThan(0.34);
  });

  it('handles empty strings without dividing by zero', () => {
    expect(textDistance('', '')).toBe(0);
    expect(textDistance('', 'nesto')).toBe(1);
  });
});
