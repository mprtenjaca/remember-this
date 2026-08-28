// Embeddings: 100% local storage, forever. Only the text goes to the model; vectors never leave the device.

import { aiConfigured, callProxy } from './client';
import { buildEmbedBody, extractEmbedding, EMBED_DIM } from './prompt';

export async function embedDocument(text: string): Promise<Float32Array | null> {
  if (!aiConfigured()) return null;
  const resp = await callProxy<unknown>('embed', buildEmbedBody(text, 'RETRIEVAL_DOCUMENT'));
  return new Float32Array(extractEmbedding(resp));
}

export async function embedQuery(text: string): Promise<Float32Array | null> {
  if (!aiConfigured()) return null;
  const resp = await callProxy<unknown>('embed', buildEmbedBody(text, 'RETRIEVAL_QUERY'), 6_000);
  return new Float32Array(extractEmbedding(resp));
}

export function documentText(summary: string | null, rawText: string, keywords: string[]): string {
  return [summary ?? '', rawText, keywords.join(' ')].filter(Boolean).join('\n');
}

export { EMBED_DIM };
