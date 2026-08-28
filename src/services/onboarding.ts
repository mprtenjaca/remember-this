// Has the user been through the three welcome screens?
//
// Same shape as explainer.ts: one prefs row, so it survives a restart. `PREF.onboarded` was reserved in the
// schema from the start; this is the first thing to read it.

import { db } from '@/db';
import { prefsRepo, PREF } from '@/db/repositories/prefs';
import { clock } from '@/domain/clock';

export async function hasOnboarded(): Promise<boolean> {
  try {
    return (await prefsRepo.get(db(), PREF.onboarded)) === '1';
  } catch {
    // If the DB is not readable, assume they HAVE — a missed welcome is a smaller failure than one that
    // greets a user who has been here for weeks.
    return true;
  }
}

export async function markOnboarded(): Promise<void> {
  await prefsRepo.set(db(), PREF.onboarded, '1', clock.now());
}

/** DEV: see the welcome again on the next launch. */
export async function resetOnboarding(): Promise<void> {
  await prefsRepo.set(db(), PREF.onboarded, '0', clock.now());
}
