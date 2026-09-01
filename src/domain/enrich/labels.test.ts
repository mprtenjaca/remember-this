// Titles and date-question wording. Marko's rule after seeing "Marti: Marti" and "Martiov rođendan"
// on the device: never inflect a name, and never let the title repeat the person as its own object.

import { describe, it, expect } from 'vitest';
import { anchorQuestion, kindNoun, MARRIAGE_PERSON } from './ingest';
import { makeTitle } from './heuristic';
import { anchorLabelFor } from './labels';

describe('names are never inflected', () => {
  // Croatian possessives of foreign/short names are a losing game: Marti → "Martiov", Luka → "Lukin",
  // Nikola → "Nikolin". Asking generally is always correct and never looks broken.
  const names = ['Marti', 'Ana', 'Marko', 'Luka', 'Nikola', 'Sarah', 'Ivo', 'Đurđa', 'Matea'];

  it('the date question names the person without declension', () => {
    for (const n of names) {
      const q = anchorQuestion(n, 'birthday', 'hr');
      expect(q, `question for ${n}`).toBe(`Kad je rođendan?`);
      expect(q).not.toMatch(/ov rođendan|in rođendan/);
    }
  });

  it('the anniversary question reads the same way', () => {
    expect(anchorQuestion('Marti', 'anniversary', 'hr')).toBe('Kad je godišnjica?');
  });

  it('a wedding anniversary still has its own wording', () => {
    expect(anchorQuestion(MARRIAGE_PERSON, 'anniversary', 'hr')).toBe('Kad je godišnjica braka?');
  });

  it('English keeps the natural possessive', () => {
    expect(anchorQuestion('Sarah', 'birthday', 'en')).toBe("When is Sarah's birthday?");
  });

  it('anchor labels name the person plainly', () => {
    for (const n of names) {
      const label = anchorLabelFor(n, 'birthday', 'hr');
      expect(label, `label for ${n}`).toBe(`Rođendan · ${n}`);
      expect(label).not.toMatch(/ov |in /);
    }
    expect(anchorLabelFor(MARRIAGE_PERSON, 'anniversary', 'hr')).toBe('Godišnjica braka');
    expect(anchorLabelFor('Sarah', 'birthday', 'en')).toBe("Sarah's birthday");
  });

  it('kindNoun is unchanged (used inside the new wording)', () => {
    expect(kindNoun('birthday', 'hr')).toBe('rođendan');
    expect(kindNoun('anniversary', 'hr')).toBe('godišnjica');
  });
});

describe('the title never repeats the person as its own gift', () => {
  const gift = (text: string, people: string[]) => makeTitle(text, { intent: 'gift', category: 'poklon', people, language: 'hr' });

  it('"Poklon Marti za rođendan" does not become "Marti: Marti"', () => {
    const title = gift('Poklon Marti za rođendan', ['Marti']);
    expect(title).not.toBe('Marti: Marti');
    expect(title).toBe('Poklon za Marti');
  });

  it('a real object still makes it into the title', () => {
    expect(gift('Ana želi Dyson fen za rođendan', ['Ana'])).toBe('Ana: Dyson fen');
  });

  it('an object that is only the person is dropped, whatever the case', () => {
    expect(gift('Poklon Ani za rođendan', ['Ana'])).toBe('Poklon za Ana');
    expect(gift('Bratu poklon za rođendan', ['Brat'])).toBe('Poklon za Brat');
  });

  it('a gift with no person named falls back to plain words', () => {
    const title = makeTitle('Kupiti poklon', { intent: 'gift', category: 'poklon', people: [], language: 'hr' });
    expect(title.length).toBeGreaterThan(0);
    expect(title).not.toContain('undefined');
  });
});
