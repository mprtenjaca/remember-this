import { describe, it, expect } from 'vitest';
import { FakeClock, DAY_MS } from '../clock';
import { dueInWindow, clampToWakingHours, canSurfaceNote, pushesOnDay, planSurfacings, isOpenOnToday } from './evaluate';
import { FATIGUE } from './scoring';
import type { Trigger, Surfacing } from '../types';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

const trig = (over: Partial<Trigger>): Trigger => ({
  id: 't',
  noteId: 'n',
  type: 'time',
  payload: { iso: '' },
  label: null,
  certainty: 0.6,
  anchorId: null,
  offsetDays: null,
  fireAt: null,
  nextEvalAt: null,
  osNotificationId: null,
  state: 'active',
  fireCount: 0,
  lastFiredAt: null,
  userEdited: false,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const surf = (over: Partial<Surfacing>): Surfacing => ({
  id: 's',
  noteId: 'n',
  triggerId: null,
  channel: 'notification',
  score: null,
  shownAt: 0,
  reaction: null,
  reactedAt: null,
  ...over,
});

describe('dueInWindow', () => {
  it('returns active triggers with fireAt in (from, to], sorted', () => {
    const t1 = trig({ id: 'a', fireAt: 100 });
    const t2 = trig({ id: 'b', fireAt: 50 });
    const t3 = trig({ id: 'c', fireAt: 200, state: 'done' });
    const t4 = trig({ id: 'd', fireAt: 0 });
    expect(dueInWindow([t1, t2, t3, t4], 0, 200).map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('clampToWakingHours', () => {
  it('moves 22:30 to 08:00 next day', () => {
    const out = clampToWakingHours(local(2026, 8, 25, 22, 30));
    const d = new Date(out);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([26, 8, 0]);
  });
  it('moves 06:15 to 08:00 same day', () => {
    const d = new Date(clampToWakingHours(local(2026, 8, 25, 6, 15)));
    expect([d.getDate(), d.getHours()]).toEqual([25, 8]);
  });
  it('leaves 19:00 alone', () => {
    const t = local(2026, 8, 25, 19);
    expect(clampToWakingHours(t)).toBe(t);
  });
  it('21:00 exactly is quiet', () => {
    const d = new Date(clampToWakingHours(local(2026, 8, 25, 21, 0)));
    expect([d.getDate(), d.getHours()]).toEqual([26, 8]);
  });
});

describe('canSurfaceNote (per-note fatigue)', () => {
  const now = local(2026, 8, 25, 12);
  it('never shown → ok', () => {
    expect(canSurfaceNote([], now)).toBe(true);
  });
  it('shown once 3 days ago → cooldown 7d blocks', () => {
    expect(canSurfaceNote([surf({ shownAt: now - 3 * DAY_MS })], now)).toBe(false);
  });
  it('shown once 8 days ago → ok', () => {
    expect(canSurfaceNote([surf({ shownAt: now - 8 * DAY_MS })], now)).toBe(true);
  });
  it('shown twice, last 20 days ago → cooldown 30d blocks', () => {
    expect(canSurfaceNote([surf({ shownAt: now - 60 * DAY_MS }), surf({ shownAt: now - 20 * DAY_MS })], now)).toBe(false);
  });
  it('shown 3 times → never again', () => {
    const s = [1, 2, 3].map((i) => surf({ shownAt: now - i * 100 * DAY_MS }));
    expect(canSurfaceNote(s, now)).toBe(false);
  });
  it('only notification/today channels count, inline_search does not', () => {
    const s = [1, 2, 3].map((i) => surf({ shownAt: now - i * DAY_MS, channel: 'inline_search' }));
    expect(canSurfaceNote(s, now)).toBe(true);
  });
});

describe('pushesOnDay', () => {
  it('counts notification surfacings on the same local day', () => {
    const now = local(2026, 8, 25, 12);
    const s = [
      surf({ shownAt: local(2026, 8, 25, 8) }),
      surf({ shownAt: local(2026, 8, 25, 20) }),
      surf({ shownAt: local(2026, 8, 24, 23) }),
      surf({ shownAt: local(2026, 8, 25, 9), channel: 'today' }),
    ];
    expect(pushesOnDay(s, now)).toBe(2);
  });
});

describe('planSurfacings', () => {
  it('respects max 2 per day, per-note cooldown, and prefers higher certainty', () => {
    const now = local(2026, 8, 25, 12);
    const c = new FakeClock(now);
    const triggers = [
      trig({ id: 'a', noteId: 'n1', fireAt: now + 1000, certainty: 0.3 }),
      trig({ id: 'b', noteId: 'n2', fireAt: now + 2000, certainty: 0.9 }),
      trig({ id: 'c', noteId: 'n3', fireAt: now + 3000, certainty: 0.6 }),
      trig({ id: 'd', noteId: 'n4', fireAt: now + 4000, certainty: 0.95 }),
    ];
    const history: Surfacing[] = [surf({ noteId: 'n4', shownAt: now - DAY_MS })]; // n4 in cooldown
    const plan = planSurfacings(triggers, history, c, now + DAY_MS);
    expect(plan.map((t) => t.id)).toEqual(['b', 'c']);
    expect(plan.length).toBeLessThanOrEqual(FATIGUE.maxPushPerDay);
  });

  it('daily cap already spent → nothing', () => {
    const now = local(2026, 8, 25, 12);
    const c = new FakeClock(now);
    const history = [surf({ noteId: 'x', shownAt: now - 3600_000 }), surf({ noteId: 'y', shownAt: now - 7200_000 })];
    const plan = planSurfacings([trig({ id: 'a', noteId: 'n1', fireAt: now + 10 })], history, c, now + DAY_MS);
    expect(plan).toEqual([]);
  });
});

describe('isOpenOnToday', () => {
  const DAY = 86_400_000;
  const now = new Date(2026, 7, 28, 12, 0, 0).getTime(); // 28 Aug 2026, midday
  const since = now - 3 * DAY;
  const until = new Date(2026, 7, 28, 23, 59, 59, 999).getTime();

  it('keeps an un-reacted surfacing from earlier today', () => {
    expect(isOpenOnToday(now - 3600_000, false, since, until)).toBe(true);
  });

  it('keeps one from within the last three days', () => {
    expect(isOpenOnToday(now - 2 * DAY, false, since, until)).toBe(true);
  });

  it('drops one older than the window', () => {
    expect(isOpenOnToday(now - 5 * DAY, false, since, until)).toBe(false);
  });

  it('drops a reacted one', () => {
    expect(isOpenOnToday(now - 3600_000, true, since, until)).toBe(false);
  });

  // The regression: time travel writes surfacings dated ahead of now. They must not leak back onto Today.
  it('drops a surfacing stamped in the future', () => {
    expect(isOpenOnToday(now + 90 * DAY, false, since, until)).toBe(false);
  });

  it('drops one stamped tomorrow', () => {
    expect(isOpenOnToday(now + DAY, false, since, until)).toBe(false);
  });

  it('still keeps one stamped late tonight', () => {
    expect(isOpenOnToday(until - 1000, false, since, until)).toBe(true);
  });
});
