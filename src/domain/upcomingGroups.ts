// Section headings for the "Dolazi" list.
//
// The list spans anything from a few days to several years, so one flat run of dates stops being readable
// somewhere past the first month. The grouping adapts to what is actually there rather than always slicing
// the same way:
//
//   this month        → "Ovaj mjesec"     (no month name: "Dolazi" already said when)
//   later this year   → the month name    ("Listopad", "Prosinac")
//   next year onwards → the year          ("2027")
//
// A year heading deliberately does NOT break down into months. Something 14 months away is remembered as
// "sometime in 2027", and eleven near-empty month headings would bury the two rows that matter.

import type { Language } from './types';

const MONTHS_HR = ['Siječanj', 'Veljača', 'Ožujak', 'Travanj', 'Svibanj', 'Lipanj', 'Srpanj', 'Kolovoz', 'Rujan', 'Listopad', 'Studeni', 'Prosinac'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface UpcomingGroup<T> {
  /** Stable key for React and for tests — `m:2026-10`, `y:2027`. Never the display title. */
  key: string;
  title: string;
  /** True for the "Ovaj mjesec" group. The UI drops that heading when it would only restate "Dolazi". */
  isCurrentMonth: boolean;
  items: T[];
}

/**
 * Group items by when they fire, relative to `now`. Input must already be sorted ascending by fireAt;
 * the output preserves that order both between groups and inside them.
 */
export function groupUpcoming<T>(items: T[], fireAtOf: (item: T) => number, now: number, lang: Language = 'hr'): UpcomingGroup<T>[] {
  const months = lang === 'en' ? MONTHS_EN : MONTHS_HR;
  const nowDate = new Date(now);
  const nowYear = nowDate.getFullYear();
  const nowMonth = nowDate.getMonth();

  const groups: UpcomingGroup<T>[] = [];
  for (const item of items) {
    const d = new Date(fireAtOf(item));
    const year = d.getFullYear();
    const month = d.getMonth();

    // A later year collapses to the year alone; within this year we group by month.
    const sameYear = year === nowYear;
    const isCurrentMonth = sameYear && month === nowMonth;
    const key = sameYear ? `m:${year}-${String(month + 1).padStart(2, '0')}` : `y:${year}`;
    const title = sameYear ? (isCurrentMonth ? (lang === 'en' ? 'This month' : 'Ovaj mjesec') : months[month]!) : String(year);

    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, title, isCurrentMonth, items: [item] });
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// "Sve" — the archive list, which groups by a different question than "Dolazi" does.

export interface TimelineGroup<T> {
  key: string;
  title: string;
  /** These notes have no reminder; they are grouped by when they were written. */
  undated: boolean;
  items: T[];
}

/**
 * Group notes by WHEN THEY HAPPEN — the next reminder's month. Notes with no reminder collect under one
 * "Kad zatreba" section at the end, in the same words the card already uses for them.
 *
 * They are NOT grouped by their own month. A month heading answers "when does this happen", and a note
 * written in August that happens whenever you next need it does not belong under August — that heading read
 * as an ordinary month sitting oddly below November, when it actually meant something else entirely.
 *
 * The dated groups always come first: mixing both orders in one run would put a note written today above a
 * reminder due tomorrow, and the reminder is the only thing on that screen that is actually coming.
 *
 * Undated notes are not an afterthought — "kad zatreba" notes are the point of the app, which is why they
 * keep a real section rather than being dropped or merged into a dated month.
 */
export function groupTimeline<T>(
  items: T[],
  fireAtOf: (item: T) => number | null,
  createdAtOf: (item: T) => number,
  lang: Language = 'hr',
): TimelineGroup<T>[] {
  const months = lang === 'en' ? MONTHS_EN : MONTHS_HR;
  const label = (t: number) => {
    const d = new Date(t);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, title: `${months[d.getMonth()]!} ${d.getFullYear()}` };
  };

  const dated: T[] = [];
  const undated: T[] = [];
  for (const item of items) (fireAtOf(item) != null ? dated : undated).push(item);

  // Soonest reminder first; among undated ones, most recently written first.
  dated.sort((a, b) => fireAtOf(a)! - fireAtOf(b)!);
  undated.sort((a, b) => createdAtOf(b) - createdAtOf(a));

  const groups: TimelineGroup<T>[] = [];
  const push = (key: string, title: string, item: T, isUndated: boolean) => {
    const last = groups[groups.length - 1];
    if (last && last.key === key && last.undated === isUndated) last.items.push(item);
    else groups.push({ key, title, undated: isUndated, items: [item] });
  };

  for (const item of dated) {
    const { key, title } = label(fireAtOf(item)!);
    push(`d:${key}`, title, item, false);
  }
  const whenNeeded = lang === 'en' ? 'When needed' : 'Kad zatreba';
  for (const item of undated) push('u:none', whenNeeded, item, true);
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filters for the "Sve" list.

/** What a note is filtered by: everything, only ones with a reminder, only "kad zatreba" ones. */
export type TimelineKind = 'all' | 'dated' | 'undated';

/**
 * Years offered as filter chips — only the ones that actually hold notes, ascending.
 *
 * A note counts under the year it is FILED under on screen: its reminder's year when it has one, otherwise
 * the year it was written. Offering a year with nothing behind it produces an empty list and reads as a bug.
 */
export function timelineYears<T>(items: T[], fireAtOf: (item: T) => number | null, createdAtOf: (item: T) => number): number[] {
  const years = new Set<number>();
  for (const item of items) years.add(new Date(fireAtOf(item) ?? createdAtOf(item)).getFullYear());
  return [...years].sort((a, b) => a - b);
}

/** Apply the kind and year filters. `year: null` means every year. */
export function filterTimeline<T>(
  items: T[],
  fireAtOf: (item: T) => number | null,
  createdAtOf: (item: T) => number,
  kind: TimelineKind,
  year: number | null,
): T[] {
  return items.filter((item) => {
    const fireAt = fireAtOf(item);
    if (kind === 'dated' && fireAt == null) return false;
    if (kind === 'undated' && fireAt != null) return false;
    // Same rule as timelineYears, or a chip could hide the very notes it offers.
    return year == null || new Date(fireAt ?? createdAtOf(item)).getFullYear() === year;
  });
}
