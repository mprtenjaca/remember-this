import { describe, it, expect } from 'vitest';
import { FakeClock } from '../clock';
import {
  nextOccurrence,
  resolveAnchorTrigger,
  resolveTimeTrigger,
  DEFAULT_CHAINS,
  parseMonthDay,
} from './resolve';
import type { Anchor } from '../types';

const anchor = (monthDay: string, kind: Anchor['kind'] = 'birthday', year: number | null = null): Anchor => ({
  id: 'a1',
  label: 'Anin rođendan',
  person: 'Ana',
  kind,
  monthDay,
  year,
  contactId: null,
  source: 'user',
  createdAt: 0,
  updatedAt: 0,
});

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('nextOccurrence', () => {
  it('returns this year when the date is still ahead', () => {
    const c = new FakeClock(local(2026, 1, 10, 12));
    const n = nextOccurrence('03-14', c);
    expect(n.getFullYear()).toBe(2026);
    expect(n.getMonth()).toBe(2); // March, 0-indexed
    expect(n.getDate()).toBe(14);
  });

  it('rolls to next year when the date already passed', () => {
    const c = new FakeClock(local(2026, 8, 25, 14, 32));
    const n = nextOccurrence('03-14', c);
    expect(n.getFullYear()).toBe(2027);
  });

  it('treats today as this year (not already passed)', () => {
    const c = new FakeClock(local(2026, 3, 14, 15));
    const n = nextOccurrence('03-14', c);
    expect(n.getFullYear()).toBe(2026);
  });

  it('parses MM-DD strictly', () => {
    expect(parseMonthDay('03-14')).toEqual({ month: 3, day: 14 });
    expect(parseMonthDay('13-40')).toBeNull();
    expect(parseMonthDay('3-1')).toBeNull();
  });
});

describe('resolveAnchorTrigger', () => {
  it('birthday 14.03., offset −21 → 21.02. 19:00 local', () => {
    const c = new FakeClock(local(2026, 1, 10));
    const fire = resolveAnchorTrigger(anchor('03-14'), -21, { hour: 19, minute: 0 }, c);
    const d = new Date(fire!);
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 2, 21, 19, 0,
    ]);
  });

  it('birthday already passed this year → next year', () => {
    const c = new FakeClock(local(2026, 8, 25, 14));
    const fire = resolveAnchorTrigger(anchor('03-14'), -21, { hour: 19, minute: 0 }, c);
    expect(new Date(fire!).getFullYear()).toBe(2027);
  });

  it('anchor still ahead but the offset already passed → next year', () => {
    // Birthday 14.03., today is 01.03. → −21d would be 21.02. (past) → 2027
    const c = new FakeClock(local(2026, 3, 1, 10));
    const fire = resolveAnchorTrigger(anchor('03-14'), -21, { hour: 19, minute: 0 }, c);
    expect(new Date(fire!).getFullYear()).toBe(2027);
    // but −7d (07.03.) is still ahead → 2026
    const fire7 = resolveAnchorTrigger(anchor('03-14'), -7, { hour: 19, minute: 0 }, c);
    expect(new Date(fire7!).getFullYear()).toBe(2026);
  });

  it('DST transition does not move the wall-clock hour', () => {
    // Europe DST starts 29.03.2026. Anchor 05.04., offset −14 → 22.03. (before DST). Hour must stay 19.
    const c = new FakeClock(local(2026, 1, 10));
    const before = resolveAnchorTrigger(anchor('04-05'), -14, { hour: 19, minute: 0 }, c);
    const after = resolveAnchorTrigger(anchor('04-05'), -1, { hour: 19, minute: 0 }, c);
    expect(new Date(before!).getHours()).toBe(19);
    expect(new Date(after!).getHours()).toBe(19);
    expect(new Date(before!).getDate()).toBe(22);
    expect(new Date(after!).getDate()).toBe(4);
  });

  it('oneoff anchor in the past returns null', () => {
    const c = new FakeClock(local(2026, 8, 25));
    const fire = resolveAnchorTrigger(anchor('06-01', 'oneoff', 2026), -7, { hour: 9, minute: 0 }, c);
    expect(fire).toBeNull();
  });

  it('oneoff anchor in the future resolves once', () => {
    const c = new FakeClock(local(2026, 8, 25));
    const fire = resolveAnchorTrigger(anchor('12-24', 'oneoff', 2026), -3, { hour: 9, minute: 30 }, c);
    const d = new Date(fire!);
    expect([d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([12, 21, 9, 30]);
  });

  it('12 months of FakeClock advance yield a monotonically increasing chain', () => {
    const c = new FakeClock(local(2026, 1, 1));
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      seen.push(resolveAnchorTrigger(anchor('03-14'), -21, { hour: 19, minute: 0 }, c)!);
      c.advanceDays(30);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(new Set(seen).size).toBe(2); // 2026 and 2027 occurrences only
  });
});

describe('resolveTimeTrigger', () => {
  it('returns the absolute time for a one-off ISO', () => {
    const c = new FakeClock(local(2026, 8, 25, 10));
    expect(resolveTimeTrigger({ iso: '2026-08-25T15:00:00' }, c)).toBe(local(2026, 8, 25, 15));
  });

  it('returns null for a past one-off', () => {
    const c = new FakeClock(local(2026, 8, 25, 16));
    expect(resolveTimeTrigger({ iso: '2026-08-25T15:00:00' }, c)).toBeNull();
  });

  it('advances recurring daily/weekly/yearly to the next future slot', () => {
    const c = new FakeClock(local(2026, 8, 25, 16));
    expect(resolveTimeTrigger({ iso: '2026-08-20T15:00:00', recurring: 'daily' }, c)).toBe(local(2026, 8, 26, 15));
    expect(resolveTimeTrigger({ iso: '2026-08-20T15:00:00', recurring: 'weekly' }, c)).toBe(local(2026, 8, 27, 15));
    expect(resolveTimeTrigger({ iso: '2025-08-20T15:00:00', recurring: 'yearly' }, c)).toBe(local(2027, 8, 20, 15));
  });
});

describe('DEFAULT_CHAINS', () => {
  it('gift chain is 3 weeks / 1 week / 1 day before', () => {
    expect(DEFAULT_CHAINS.gift).toEqual([-21, -7, -1]);
  });
});
