import { describe, it, expect } from 'vitest';
import { groupUpcoming, groupTimeline, timelineYears, filterTimeline } from './upcomingGroups';

const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h, 0, 0, 0).getTime();
const NOW = at(2026, 8, 28); // 28 Aug 2026, matching the app's test clock era
const group = (times: number[], now = NOW, lang: 'hr' | 'en' = 'hr') => groupUpcoming(times, (t) => t, now, lang);

describe('groupUpcoming', () => {
  it('calls the current month "Ovaj mjesec" rather than naming it', () => {
    const g = group([at(2026, 8, 30)]);
    expect(g).toHaveLength(1);
    expect(g[0]!.title).toBe('Ovaj mjesec');
    expect(g[0]!.key).toBe('m:2026-08');
  });

  it('names later months in the current year', () => {
    const g = group([at(2026, 10, 4), at(2026, 12, 25)]);
    expect(g.map((x) => x.title)).toEqual(['Listopad', 'Prosinac']);
  });

  it('collapses a later year to the year alone, not to its months', () => {
    const g = group([at(2027, 2, 21), at(2027, 11, 3)]);
    expect(g).toHaveLength(1);
    expect(g[0]!.title).toBe('2027');
    expect(g[0]!.items).toHaveLength(2);
  });

  it('separates different future years', () => {
    const g = group([at(2027, 5, 1), at(2028, 1, 9)]);
    expect(g.map((x) => x.title)).toEqual(['2027', '2028']);
  });

  it('keeps this-month, later-month and next-year in chronological order', () => {
    const g = group([at(2026, 8, 30), at(2026, 10, 4), at(2027, 2, 21)]);
    expect(g.map((x) => x.title)).toEqual(['Ovaj mjesec', 'Listopad', '2027']);
  });

  it('preserves input order inside a group', () => {
    const a = at(2027, 2, 21);
    const b = at(2027, 2, 22);
    expect(group([a, b])[0]!.items).toEqual([a, b]);
  });

  it('returns no groups for no items', () => {
    expect(group([])).toEqual([]);
  });

  // A December "now" is the case where naive month-only grouping silently merges two different Decembers.
  it('does not merge next January into the current month', () => {
    const now = at(2026, 12, 5);
    const g = group([at(2026, 12, 20), at(2027, 1, 8)], now);
    expect(g.map((x) => x.title)).toEqual(['Ovaj mjesec', '2027']);
  });

  it('speaks English when asked', () => {
    const g = group([at(2026, 8, 30), at(2026, 10, 4)], NOW, 'en');
    expect(g.map((x) => x.title)).toEqual(['This month', 'October']);
  });
});

describe('isCurrentMonth', () => {
  it('marks only the current-month group', () => {
    const g = group([at(2026, 8, 30), at(2026, 10, 4), at(2027, 2, 21)]);
    expect(g.map((x) => x.isCurrentMonth)).toEqual([true, false, false]);
  });

  // The UI hides the first heading only when it is the current month; a list that starts in 2027 must keep
  // its "2027" heading, or the year is never stated anywhere on screen.
  it('is false for a first group that is not the current month', () => {
    expect(group([at(2027, 2, 21)])[0]!.isCurrentMonth).toBe(false);
  });
});

describe('groupTimeline', () => {
  type N = { id: string; fireAt: number | null; createdAt: number };
  const n = (id: string, fireAt: number | null, createdAt: number): N => ({ id, fireAt, createdAt });
  const g = (items: N[], lang: 'hr' | 'en' = 'hr') => groupTimeline(items, (x) => x.fireAt, (x) => x.createdAt, lang);
  const ids = (items: N[]) => items.map((x) => x.id);

  it('groups a note by its reminder month, not by when it was written', () => {
    const note = n('a', at(2026, 11, 25), at(2026, 8, 25));
    expect(g([note]).map((x) => x.title)).toEqual(['Studeni 2026']);
  });

  // Not "Kolovoz 2026": a month heading answers "when does this happen", and these happen whenever you next
  // need them. Labelled as a month it read as an ordinary month sitting oddly below November.
  it('collects undated notes under one "Kad zatreba" section', () => {
    const out = g([n('a', null, at(2026, 8, 25)), n('b', null, at(2026, 6, 2))]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Kad zatreba');
    expect(out[0]!.undated).toBe(true);
  });

  // Otherwise a note about next September outranks one about tomorrow.
  it('puts every dated group before the undated ones', () => {
    const out = g([n('undated', null, at(2026, 8, 27)), n('dated', at(2026, 9, 3), at(2026, 8, 20))]);
    expect(out.map((x) => x.undated)).toEqual([false, true]);
  });

  it('orders dated notes by the soonest reminder', () => {
    const out = g([n('later', at(2027, 2, 1), at(2026, 8, 1)), n('sooner', at(2026, 9, 3), at(2026, 8, 2))]);
    expect(out.flatMap((x) => ids(x.items))).toEqual(['sooner', 'later']);
  });

  it('orders undated notes newest-written first', () => {
    const out = g([n('old', null, at(2026, 7, 1)), n('new', null, at(2026, 8, 20))]);
    expect(out.flatMap((x) => ids(x.items))).toEqual(['new', 'old']);
  });

  // A note written in September and one happening in September are different answers; the undated one is
  // never absorbed into the month group just because the dates coincide.
  it('keeps an undated note out of a dated month of the same name', () => {
    const out = g([n('happens', at(2026, 9, 10), at(2026, 1, 1)), n('written', null, at(2026, 9, 20))]);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.title)).toEqual(['Rujan 2026', 'Kad zatreba']);
    expect(out.map((x) => x.key)).toEqual(['d:2026-09', 'u:none']);
  });

  it('collects several notes sharing a month into one group', () => {
    const out = g([n('a', at(2026, 9, 3), 0), n('b', at(2026, 9, 20), 0)]);
    expect(out).toHaveLength(1);
    expect(ids(out[0]!.items)).toEqual(['a', 'b']);
  });

  it('returns nothing for no notes', () => {
    expect(g([])).toEqual([]);
  });

  it('speaks English when asked', () => {
    expect(g([n('a', at(2026, 11, 25), 0)], 'en').map((x) => x.title)).toEqual(['November 2026']);
    expect(g([n('a', null, at(2026, 8, 1))], 'en').map((x) => x.title)).toEqual(['When needed']);
  });

  // The current month sits at the top when something actually happens in it — "Kad zatreba" below it is a
  // different axis, not a month that fell out of order.
  it('puts the current month first and "Kad zatreba" last', () => {
    const out = g([n('undated', null, at(2026, 8, 27)), n('thisMonth', at(2026, 8, 30), at(2026, 1, 1)), n('later', at(2026, 11, 2), at(2026, 1, 1))]);
    expect(out.map((x) => x.title)).toEqual(['Kolovoz 2026', 'Studeni 2026', 'Kad zatreba']);
  });
});

describe('timeline filters', () => {
  type N = { id: string; fireAt: number | null; createdAt: number };
  const n = (id: string, fireAt: number | null, createdAt: number): N => ({ id, fireAt, createdAt });
  const fire = (x: N) => x.fireAt;
  const made = (x: N) => x.createdAt;
  const ids = (items: N[]) => items.map((x) => x.id);

  const notes = [
    n('soon', at(2026, 9, 3), at(2026, 8, 1)),
    n('nextYear', at(2027, 2, 1), at(2026, 8, 2)),
    n('undated26', null, at(2026, 7, 4)),
    n('undated25', null, at(2025, 5, 9)),
  ];

  it('offers only years that actually hold notes, ascending', () => {
    expect(timelineYears(notes, fire, made)).toEqual([2025, 2026, 2027]);
  });

  // An undated note belongs to the year it was written; a dated one to its reminder's year. Anything else
  // and a chip offers a year whose list comes back empty.
  it('files each note under the year it is shown by', () => {
    expect(timelineYears([n('a', at(2027, 1, 1), at(2026, 1, 1))], fire, made)).toEqual([2027]);
    expect(timelineYears([n('a', null, at(2026, 1, 1))], fire, made)).toEqual([2026]);
  });

  it('returns everything when nothing is selected', () => {
    expect(ids(filterTimeline(notes, fire, made, 'all', null))).toEqual(['soon', 'nextYear', 'undated26', 'undated25']);
  });

  it('filters by kind', () => {
    expect(ids(filterTimeline(notes, fire, made, 'dated', null))).toEqual(['soon', 'nextYear']);
    expect(ids(filterTimeline(notes, fire, made, 'undated', null))).toEqual(['undated26', 'undated25']);
  });

  it('filters by year across both kinds', () => {
    expect(ids(filterTimeline(notes, fire, made, 'all', 2026))).toEqual(['soon', 'undated26']);
    expect(ids(filterTimeline(notes, fire, made, 'all', 2027))).toEqual(['nextYear']);
  });

  it('combines kind and year', () => {
    expect(ids(filterTimeline(notes, fire, made, 'dated', 2026))).toEqual(['soon']);
    expect(ids(filterTimeline(notes, fire, made, 'undated', 2026))).toEqual(['undated26']);
  });

  it('returns nothing for a year with no notes of that kind', () => {
    expect(filterTimeline(notes, fire, made, 'dated', 2025)).toEqual([]);
  });

  // Every year chip must yield at least one note, or the filter contradicts what it offers.
  it('never offers a year that filters to nothing', () => {
    for (const y of timelineYears(notes, fire, made)) {
      expect(filterTimeline(notes, fire, made, 'all', y).length, `year ${y} came back empty`).toBeGreaterThan(0);
    }
  });
});
