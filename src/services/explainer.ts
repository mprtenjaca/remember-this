// Has the user seen the "what happens next" explanation?
//
// Shown once, with the very first note, and dismissable with an X. After that it is not in the way — the 💡
// in the Today header brings it back on demand. A prefs row rather than component state so it survives a
// restart (an explanation that reappears every launch is the same nuisance as one that never goes away).

import { db } from '@/db';
import { prefsRepo, PREF } from '@/db/repositories/prefs';
import { clock } from '@/domain/clock';

export async function explainerSeen(): Promise<boolean> {
  try {
    return (await prefsRepo.get(db(), PREF.explainerSeen)) === '1';
  } catch {
    // Before the DB is open, assume it HAS been seen: a missed explainer is better than one that flashes
    // onto a screen the user has already learned.
    return true;
  }
}

export async function markExplainerSeen(): Promise<void> {
  await prefsRepo.set(db(), PREF.explainerSeen, '1', clock.now());
}
