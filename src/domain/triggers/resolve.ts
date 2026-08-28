import type { Clock } from '../clock';
import type { Anchor, AnchorPayload, TimePayload } from '../types';

export function parseMonthDay(monthDay: string): { month: number; day: number } | null {
  const m = /^(\d{2})-(\d{2})$/.exec(monthDay);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

export function formatMonthDay(month1: number, day: number): string {
  return `${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function startOfDay(t: number): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Next calendar occurrence of MM-DD, at local midnight. Today counts as "this year".
 * All math goes through the local calendar so DST never shifts the wall-clock hour.
 */
export function nextOccurrence(monthDay: string, clock: Clock): Date {
  const md = parseMonthDay(monthDay);
  if (!md) throw new Error(`Invalid monthDay: ${monthDay}`);
  const today = startOfDay(clock.now());
  let year = today.getFullYear();
  let candidate = new Date(year, md.month - 1, md.day); // ⚠ month − 1: JS months are 0-indexed
  if (candidate < today) candidate = new Date(++year, md.month - 1, md.day);
  return candidate;
}

function occurrenceInYear(monthDay: string, year: number): Date {
  const md = parseMonthDay(monthDay);
  if (!md) throw new Error(`Invalid monthDay: ${monthDay}`);
  return new Date(year, md.month - 1, md.day);
}

function applyOffset(target: Date, offsetDays: number, at: AnchorPayload): number {
  const fire = new Date(target);
  fire.setDate(fire.getDate() + offsetDays);
  fire.setHours(at.hour, at.minute, 0, 0);
  return fire.getTime();
}

/**
 * anchor + offset → fire_at (epoch ms). Recurring anchors always resolve to the
 * next FUTURE firing; one-offs return null once they are in the past.
 */
export function resolveAnchorTrigger(
  anchor: Anchor,
  offsetDays: number,
  at: AnchorPayload,
  clock: Clock,
): number | null {
  if (!anchor.monthDay) return null;
  const now = clock.now();

  if (anchor.kind === 'oneoff') {
    if (anchor.year == null) return null;
    const fire = applyOffset(occurrenceInYear(anchor.monthDay, anchor.year), offsetDays, at);
    return fire > now ? fire : null;
  }

  let target = nextOccurrence(anchor.monthDay, clock);
  let fire = applyOffset(target, offsetDays, at);
  if (fire <= now) {
    target = occurrenceInYear(anchor.monthDay, target.getFullYear() + 1);
    fire = applyOffset(target, offsetDays, at);
  }
  return fire;
}

/** Absolute time trigger → next future fire_at, or null when a one-off is already past. */
export function resolveTimeTrigger(p: TimePayload, clock: Clock): number | null {
  const base = Date.parse(p.iso);
  if (Number.isNaN(base)) return null;
  const now = clock.now();
  if (!p.recurring) return base > now ? base : null;

  const d = new Date(base);
  // Step through the local calendar until we are in the future (bounded loop).
  for (let i = 0; i < 10_000 && d.getTime() <= now; i++) {
    if (p.recurring === 'daily') d.setDate(d.getDate() + 1);
    else if (p.recurring === 'weekly') d.setDate(d.getDate() + 7);
    else d.setFullYear(d.getFullYear() + 1);
  }
  return d.getTime();
}

/** Default reminder chains per intent/kind when the LLM did not propose one. Days relative to anchor. */
export const DEFAULT_CHAINS: Record<string, number[]> = {
  gift: [-21, -7, -1],
  birthday: [-21, -7, -1],
  anniversary: [-14, -3],
  // A memorial needs remembering, not preparing for: one quiet nudge the week before, one the day before.
  memorial: [-7, -1],
  annual: [-30, -7],
  oneoff: [-7, -1],
};

export const DEFAULT_ANCHOR_TIME: AnchorPayload = { hour: 19, minute: 0 }; // when people shop

/** Human label for an offset, in the note's language. */
export function offsetLabel(days: number, lang: 'hr' | 'en' = 'hr'): string {
  const abs = Math.abs(days);
  const before = days < 0;
  if (lang === 'en') {
    const unit = abs % 7 === 0 && abs >= 7 ? `${abs / 7} week${abs / 7 > 1 ? 's' : ''}` : `${abs} day${abs !== 1 ? 's' : ''}`;
    if (abs === 0) return 'on the day';
    return before ? `${unit} before` : `${unit} after`;
  }
  if (abs === 0) return 'na dan';
  if (abs === 1) return before ? 'dan prije' : 'dan poslije';
  if (abs % 7 === 0) {
    const w = abs / 7;
    const unit = w === 1 ? 'tjedan' : w < 5 ? 'tjedna' : 'tjedana';
    return before ? `${w === 1 ? '' : w + ' '}${unit} prije` : `${w === 1 ? '' : w + ' '}${unit} poslije`;
  }
  return before ? `${abs} dana prije` : `${abs} dana poslije`;
}
