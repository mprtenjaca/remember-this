// Date formatting for the UI. Every timestamp in the app goes through here (and is set in mono).

import type { Language } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** 21.02.2026 */
export function fmtDate(t: number): string {
  const d = new Date(t);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** 21.02. */
export function fmtDayMonth(t: number): string {
  const d = new Date(t);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}

/** 19:00 */
export function fmtTime(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 21.02.2026 19:00 */
export function fmtDateTime(t: number): string {
  return `${fmtDate(t)} ${fmtTime(t)}`;
}

/** 'MM-DD' → 14.03. */
export function fmtMonthDay(monthDay: string): string {
  const [m, d] = monthDay.split('-');
  return `${d}.${m}.`;
}

const HR_MONTHS = ['sij', 'velj', 'ožu', 'tra', 'svi', 'lip', 'srp', 'kol', 'ruj', 'lis', 'stu', 'pro'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "velj" — the month alone, for date columns that stack the day above it. */
export function fmtMonthAbbr(t: number, lang: Language = 'hr'): string {
  return (lang === 'en' ? EN_MONTHS : HR_MONTHS)[new Date(t).getMonth()]!;
}

/** 21. velj */
export function fmtShort(t: number, lang: Language = 'hr'): string {
  const d = new Date(t);
  const months = lang === 'en' ? EN_MONTHS : HR_MONTHS;
  return lang === 'en' ? `${months[d.getMonth()]} ${d.getDate()}` : `${d.getDate()}. ${months[d.getMonth()]}`;
}

/** "prije 6 mjeseci" / "za 3 tjedna" / "danas" — relative to `now`. */
export function fmtRelative(t: number, now: number, lang: Language = 'hr'): string {
  const diff = t - now;
  const abs = Math.abs(diff);
  const future = diff > 0;
  const min = Math.round(abs / 60_000);
  const h = Math.round(abs / 3_600_000);
  const d = Math.round(abs / 86_400_000);
  const w = Math.round(d / 7);
  const mo = Math.round(d / 30);
  const y = Math.round(d / 365);

  if (lang === 'en') {
    const unit =
      min < 1 ? 'now' : min < 60 ? `${min} min` : h < 24 ? `${h} h` : d < 7 ? `${d} d` : d < 30 ? `${w} wk` : d < 365 ? `${mo} mo` : `${y} y`;
    if (unit === 'now') return 'now';
    return future ? `in ${unit}` : `${unit} ago`;
  }

  if (min < 1) return 'sada';
  let unit: string;
  if (min < 60) unit = `${min} min`;
  else if (h < 24) unit = h === 1 ? '1 sat' : h < 5 ? `${h} sata` : `${h} sati`;
  else if (d === 1) return future ? 'sutra' : 'jučer';
  else if (d < 7) unit = `${d} dana`;
  // "dana" on the singular forms: "Božić je za tjedan" reads as a sentence someone stopped writing halfway,
  // and this string lands in notification copy, not just in a compact list column.
  else if (d < 30) unit = w === 1 ? 'tjedan dana' : w < 5 ? `${w} tjedna` : `${w} tjedana`;
  else if (d < 365) unit = mo === 1 ? 'mjesec dana' : mo < 5 ? `${mo} mjeseca` : `${mo} mjeseci`;
  else unit = y === 1 ? 'godinu dana' : y < 5 ? `${y} godine` : `${y} godina`;
  return future ? `za ${unit}` : `prije ${unit}`;
}

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(t: number): number {
  return startOfDay(t) + 86_400_000 - 1;
}

/** Local-time ISO without timezone suffix: 2026-08-25T15:00:00 */
export function toLocalIso(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export const WEEKDAYS_HR = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];
export const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function weekdayName(t: number, lang: Language = 'hr'): string {
  return (lang === 'en' ? WEEKDAYS_EN : WEEKDAYS_HR)[new Date(t).getDay()]!;
}
