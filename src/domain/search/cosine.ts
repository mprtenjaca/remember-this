// Pure-JS vector search. Up to ~5000 notes this runs < 20 ms; sqlite-vec is premature.

/** Gemini returns normalised vectors → dot product == cosine. Falls back to full cosine otherwise. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error(`dim mismatch ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export interface Scored<T> {
  item: T;
  score: number;
}

export function topK<T>(query: Float32Array, docs: Array<{ item: T; vector: Float32Array }>, k: number, minScore = -1): Scored<T>[] {
  const out: Scored<T>[] = [];
  for (const d of docs) {
    const s = cosine(query, d.vector);
    if (s >= minScore) out.push({ item: d.item, score: s });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, k);
}

export function toBlob(vec: ArrayLike<number>): Uint8Array {
  return new Uint8Array(new Float32Array(vec).buffer);
}

export function fromBlob(blob: Uint8Array): Float32Array {
  // Copy to guarantee 4-byte alignment regardless of the source buffer offset.
  const copy = new Uint8Array(blob.byteLength);
  copy.set(blob);
  return new Float32Array(copy.buffer);
}
