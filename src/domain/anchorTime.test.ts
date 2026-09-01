import { describe, it, expect } from 'vitest';
import { dayOfTimeMutations } from './anchorTime';
import { FakeClock } from './clock';
import type { Anchor, Trigger } from './types';

const local = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const NOW = local(2026, 8, 28, 12, 0);
const clock = new FakeClock(NOW);
const anchor = { id: 'a1', person: 'Branki', kind: 'birthday', monthDay: '11-30', year: null, label: 'Rođendan · Branki', source: 'user', createdAt: NOW, updatedAt: NOW } as unknown as Anchor;
const trig = (id: string, offsetDays: number, hour = 19): Trigger =>
  ({ id, noteId: 'n1', type: 'anchor', state: 'active', anchorId: 'a1', offsetDays, payload: { hour, minute: 0 }, label: `${offsetDays}`, certainty: 0.6, fireAt: 1, fireCount: 0, lastFiredAt: null, userEdited: false, createdAt: NOW, updatedAt: NOW }) as unknown as Trigger;

describe('a chosen time re-times only the day-of reminder', () => {
  it('replaces the existing "na dan" reminder with one at the chosen hour, leaving the leads alone', () => {
    const muts = dayOfTimeMutations([trig('t21', -21), trig('t0', 0)], anchor, { hour: 20, minute: 30 }, clock);
    expect(muts.map((m) => m.op)).toEqual(['remove_trigger', 'add_trigger']);
    expect((muts[0] as { triggerId: string }).triggerId).toBe('t0');
    const added = (muts[1] as { trigger: { payload: { hour: number; minute: number }; fireAt?: number | null; offsetDays?: number | null } }).trigger;
    expect(added.payload).toEqual({ hour: 20, minute: 30 });
    expect(added.offsetDays).toBe(0);
    expect(new Date(added.fireAt!).getHours()).toBe(20);
    expect(new Date(added.fireAt!).getDate()).toBe(30);
  });

  it('creates the day-of reminder when the chain had none', () => {
    const muts = dayOfTimeMutations([trig('t21', -21), trig('t7', -7)], anchor, { hour: 18, minute: 0 }, clock);
    expect(muts.map((m) => m.op)).toEqual(['add_trigger']);
    expect((muts[0] as { trigger: { label: string | null } }).trigger.label).toBe('na dan');
  });

  it('ignores a done day-of reminder and another anchor', () => {
    const done = { ...trig('d0', 0), state: 'done' } as Trigger;
    const other = { ...trig('o0', 0), anchorId: 'a2' } as Trigger;
    expect(dayOfTimeMutations([done, other], anchor, { hour: 18, minute: 0 }, clock).map((m) => m.op)).toEqual(['add_trigger']);
  });
});
