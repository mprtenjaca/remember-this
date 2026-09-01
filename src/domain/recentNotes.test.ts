import { describe, it, expect } from 'vitest';
import { pickRecent, RECENT_MAX, RECENT_WINDOW_MS } from './recentNotes';

const NOW = 1_700_000_000_000;
const H = 60 * 60 * 1000;
const n = (id: string, agoMs: number) => ({ id, createdAt: NOW - agoMs });

describe('pickRecent — the "Novo" section', () => {
  it('keeps notes from the last 24 h, newest first, and drops older ones', () => {
    const out = pickRecent([n('old', 30 * H), n('a', 5 * H), n('b', 1 * H)], { now: NOW });
    expect(out.map((x) => x.id)).toEqual(['b', 'a']);
  });

  it('the window edge is inclusive at 24 h and nothing from the future counts', () => {
    const out = pickRecent([n('edge', RECENT_WINDOW_MS), n('future', -1)], { now: NOW });
    expect(out.map((x) => x.id)).toEqual(['edge']);
  });

  it(`never more than ${RECENT_MAX}`, () => {
    const many = Array.from({ length: 6 }, (_, i) => n(`n${i}`, i * H));
    expect(pickRecent(many, { now: NOW }).map((x) => x.id)).toEqual(['n0', 'n1', 'n2']);
  });

  it('a note that already has its own card (question, reading, failed) is not repeated', () => {
    const out = pickRecent([n('asking', 1 * H), n('plain', 2 * H)], { now: NOW, excludeIds: ['asking'] });
    expect(out.map((x) => x.id)).toEqual(['plain']);
  });

  it('empty when nothing is recent', () => {
    expect(pickRecent([n('old', 48 * H)], { now: NOW })).toEqual([]);
  });
});
