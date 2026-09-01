import { describe, it, expect } from 'vitest';
import { sortByWhen } from './reminderOrder';

const r = (id: string, fireAt: number | null, lastFiredAt: number | null = null, createdAt = 0) => ({ id, fireAt, lastFiredAt, createdAt });

describe('reminders list in the order they happen', () => {
  it('upcoming and already-fired ones interleave by time — a fired one is not shoved to the end', () => {
    const out = sortByWhen([r('sep5', 5000), r('firedJul', null, 1000), r('sep4', 4000), r('hand', 4500)]);
    expect(out.map((x) => x.id)).toEqual(['firedJul', 'sep4', 'hand', 'sep5']);
  });

  it('reminders with no time at all go last, oldest first', () => {
    const out = sortByWhen([r('b', null, null, 2), r('dated', 10), r('a', null, null, 1)]);
    expect(out.map((x) => x.id)).toEqual(['dated', 'a', 'b']);
  });

  it('same moment → creation order; input is not mutated', () => {
    const input = [r('later', 10, null, 2), r('earlier', 10, null, 1)];
    const out = sortByWhen(input);
    expect(out.map((x) => x.id)).toEqual(['earlier', 'later']);
    expect(input[0]!.id).toBe('later');
  });
});
