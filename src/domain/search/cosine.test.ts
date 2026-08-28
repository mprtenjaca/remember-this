import { describe, it, expect } from 'vitest';
import { cosine, topK, toBlob, fromBlob } from './cosine';

describe('cosine', () => {
  it('identical → 1, orthogonal → 0, opposite → −1', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosine(a, a)).toBeCloseTo(1);
    expect(cosine(a, b)).toBeCloseTo(0);
    expect(cosine(a, new Float32Array([-1, 0, 0]))).toBeCloseTo(-1);
  });
  it('is scale invariant', () => {
    expect(cosine(new Float32Array([2, 2]), new Float32Array([1, 1]))).toBeCloseTo(1);
  });
});

describe('topK', () => {
  it('ranks by similarity and honours minScore', () => {
    const q = new Float32Array([1, 0]);
    const docs = [
      { item: 'a', vector: new Float32Array([0, 1]) },
      { item: 'b', vector: new Float32Array([1, 0.1]) },
      { item: 'c', vector: new Float32Array([1, 1]) },
    ];
    expect(topK(q, docs, 2).map((s) => s.item)).toEqual(['b', 'c']);
    expect(topK(q, docs, 5, 0.5).map((s) => s.item)).toEqual(['b', 'c']);
  });
});

describe('blob round trip', () => {
  it('survives SQLite BLOB storage with an offset view', () => {
    const v = new Float32Array([0.1, -0.5, 3.25]);
    const blob = toBlob(v);
    expect(blob.byteLength).toBe(12);
    // simulate a misaligned view like a driver might hand back
    const wrapped = new Uint8Array(blob.byteLength + 1);
    wrapped.set(blob, 1);
    const back = fromBlob(wrapped.subarray(1));
    expect(Array.from(back)).toEqual(Array.from(v));
  });
});
