// Hard rule #1: capture never waits for the LLM. SQLite write → return in < 100 ms.

import { db } from '@/db';
import { notesRepo } from '@/db/repositories/notes';
import { clock } from '@/domain/clock';
import { newId } from '@/lib/ids';
import type { Note } from '@/domain/types';
import { kickEnrichQueue } from './ai/queue';

export async function capture(rawText: string, source: Note['source'] = 'typed'): Promise<string> {
  const text = rawText.trim();
  if (!text) throw new Error('empty');
  const id = newId();
  await notesRepo.insert(db(), { id, rawText: text, source, now: clock.now() });
  kickEnrichQueue(50); // after the sheet has closed
  return id;
}
