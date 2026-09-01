import { describe, it, expect } from 'vitest';
import { collapseAnchorToSameDay } from './sameDay';
import type { Trigger } from './types';

const local = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const NOW = local(2026, 8, 28, 12, 0);

const anchorTrigger = (id: string, offsetDays: number, hour = 9): Trigger =>
  ({
    id,
    noteId: 'n1',
    type: 'anchor',
    state: 'active',
    anchorId: 'a1',
    offsetDays,
    payload: { hour, minute: 0 },
    label: `${offsetDays}`,
    certainty: 1,
    fireAt: local(2026, 11, 30 + offsetDays, hour),
    fireCount: 0,
    lastFiredAt: null,
    userEdited: false,
    createdAt: NOW,
    updatedAt: NOW,
  }) as unknown as Trigger;

const chain = [anchorTrigger('t21', -21), anchorTrigger('t7', -7), anchorTrigger('t1', -1), anchorTrigger('t0', 0, 18)];

describe('moving an occasion onto today collapses its chain to the same-day pair', () => {
  it('30.11 → today: the four chain reminders go, "sat prije" and "u to vrijeme" come', () => {
    const { mutations, moment } = collapseAnchorToSameDay(chain, 'a1', NOW, NOW);
    expect(mutations.filter((m) => m.op === 'remove_trigger').map((m) => (m as { triggerId: string }).triggerId)).toEqual(['t21', 't7', 't1', 't0']);
    const added = mutations.filter((m) => m.op === 'add_trigger') as Array<{ trigger: { label: string | null; fireAt?: number | null } }>;
    expect(added.map((a) => a.trigger.label)).toEqual(['sat prije', 'u to vrijeme']);
    expect(moment).toBe(local(2026, 8, 28, 18)); // the chain's own hour, today
    expect(added[0]!.trigger.fireAt).toBe(local(2026, 8, 28, 17));
  });

  it('the hour already passed today → next full hour, and no "sat prije"', () => {
    const early = [anchorTrigger('t0', 0, 9)];
    const { mutations, moment } = collapseAnchorToSameDay(early, 'a1', NOW, NOW);
    expect(moment).toBe(local(2026, 8, 28, 13));
    expect(mutations.filter((m) => m.op === 'add_trigger')).toHaveLength(1);
  });

  it('too late in the evening → reminders removed, nothing invented', () => {
    const late = local(2026, 8, 28, 21, 30);
    const { mutations, moment } = collapseAnchorToSameDay([anchorTrigger('t0', 0, 9)], 'a1', late, late);
    expect(moment).toBeNull();
    expect(mutations.every((m) => m.op === 'remove_trigger')).toBe(true);
  });

  it('a date that is not today changes nothing here — the chain just moves', () => {
    expect(collapseAnchorToSameDay(chain, 'a1', local(2026, 12, 24), NOW).mutations).toEqual([]);
  });

  it('only this anchor, only active ones', () => {
    const other = { ...anchorTrigger('x', -7), anchorId: 'a2' } as Trigger;
    const done = { ...anchorTrigger('d', -1), state: 'done' } as Trigger;
    const { mutations } = collapseAnchorToSameDay([...chain, other, done], 'a1', NOW, NOW);
    const removed = mutations.filter((m) => m.op === 'remove_trigger').map((m) => (m as { triggerId: string }).triggerId);
    expect(removed).not.toContain('x');
    expect(removed).not.toContain('d');
  });
});
