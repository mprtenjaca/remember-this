// Unsaved capture text. Leaving the sheet with words in it must never lose them: the text becomes a draft,
// shown on Today as "Nedovršeno", and reopens in the capture sheet with one tap. Saving the note removes it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { newId } from '@/lib/ids';
import { clock } from '@/domain/clock';
import { notifyChange } from '@/lib/events';

const KEY = 'capture.drafts';
const MAX = 10;

export interface Draft {
  id: string;
  text: string;
  updatedAt: number;
}

export async function listDrafts(): Promise<Draft[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as Draft[]) : [];
    return arr.filter((d) => d && typeof d.text === 'string' && d.text.trim()).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

async function write(drafts: Draft[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(drafts.slice(0, MAX)));
  notifyChange('drafts');
}

/** Upsert. Returns the draft id (new or existing). Empty text deletes. */
export async function saveDraft(text: string, id?: string | null): Promise<string | null> {
  const drafts = await listDrafts();
  const clean = text.trim();
  if (!clean) {
    if (id) await write(drafts.filter((d) => d.id !== id));
    return null;
  }
  const existing = id ? drafts.find((d) => d.id === id) : drafts.find((d) => d.text === clean);
  const draft: Draft = { id: existing?.id ?? newId(), text: clean, updatedAt: clock.now() };
  await write([draft, ...drafts.filter((d) => d.id !== draft.id)]);
  return draft.id;
}

export async function getDraft(id: string): Promise<Draft | null> {
  return (await listDrafts()).find((d) => d.id === id) ?? null;
}

export async function deleteDraft(id: string) {
  await write((await listDrafts()).filter((d) => d.id !== id));
}
