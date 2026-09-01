import { describe, it, expect } from 'vitest';
import { faceOf, HOUR_MS } from './herald';

const T = 1_700_000_000_000;
const r = (fireAt: number, label: string | null) => ({ fireAt, label });

describe('faceOf — the event, not its herald, fronts the row', () => {
  it('"sat prije" + the moment an hour later → the moment, with heraldAt', () => {
    const f = faceOf([r(T, 'sat prije'), r(T + HOUR_MS, 'u to vrijeme')]);
    expect(f?.trigger.fireAt).toBe(T + HOUR_MS);
    expect(f?.heraldAt).toBe(T);
  });

  it('the English label pairs the same way', () => {
    const f = faceOf([r(T, 'an hour before'), r(T + HOUR_MS, 'at the time')]);
    expect(f?.trigger.fireAt).toBe(T + HOUR_MS);
  });

  it('a "sat prije" with nothing exactly an hour after it is just the soonest reminder', () => {
    expect(faceOf([r(T, 'sat prije'), r(T + 2 * HOUR_MS, 'x')])?.heraldAt).toBeNull();
    expect(faceOf([r(T, 'sat prije')])?.trigger.fireAt).toBe(T);
  });

  it('an ordinary soonest reminder is the face; an empty list has none', () => {
    expect(faceOf([r(T, 'danas'), r(T + HOUR_MS, 'sutra')])?.trigger.label).toBe('danas');
    expect(faceOf([])).toBeNull();
  });
});
