// UI language = the DEVICE language, decided once at startup.
//
// It used to follow the note: enrich stored whatever language the model claimed (or our detector guessed) and
// every label was written in it, so a Croatian phone showed "next Friday" inside a Croatian note. Marko's rule
// (2026-08-25): if the system is Croatian, everything is Croatian; if the system is English, everything is English.
// The note's own language is still stored — it is what the model reads back and what dictation is pinned to —
// but it never decides UI copy.
//
// Kept out of src/domain (native import). Domain functions take `lang` as an argument; the app passes uiLang().

import { getLocales } from 'expo-localization';
import type { Language } from '@/domain/types';

let cached: Language | null = null;

/** 'hr' unless the device's first locale is English. Croatian is the product language, so it is the fallback. */
export function uiLang(): Language {
  if (cached) return cached;
  let code: string | undefined;
  try {
    code = getLocales()[0]?.languageCode ?? undefined;
  } catch {
    code = undefined;
  }
  cached = code?.toLowerCase().startsWith('en') ? 'en' : 'hr';
  return cached;
}

/** True when the UI is Croatian — the shorthand every screen uses. */
export function isHr(): boolean {
  return uiLang() === 'hr';
}
