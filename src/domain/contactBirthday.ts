// ⚠ expo-contacts months are 0-indexed (2 = March). Classic source of "reminder a month early" bugs.

import { formatMonthDay } from './triggers/resolve';

export interface RawBirthday {
  month?: number;
  day?: number;
  year?: number;
}

export function birthdayToMonthDay(b: RawBirthday | undefined | null): { monthDay: string; year: number | null } | null {
  if (!b || b.month == null || b.day == null) return null;
  const m = b.month + 1; // 0-indexed → 1-indexed
  if (m < 1 || m > 12 || b.day < 1 || b.day > 31) return null;
  return { monthDay: formatMonthDay(m, b.day), year: b.year ?? null };
}
