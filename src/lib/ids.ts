// ID generation with an injectable source so domain code never imports expo-crypto.

type IdGen = () => string;

function fallback(): string {
  // RFC4122-ish v4 without crypto — only used if no better source was injected.
  let s = '';
  for (let i = 0; i < 32; i++) {
    const r = (Math.random() * 16) | 0;
    if (i === 8 || i === 12 || i === 16 || i === 20) s += '-';
    s += (i === 12 ? 4 : i === 16 ? (r & 3) | 8 : r).toString(16);
  }
  return s;
}

let gen: IdGen =
  typeof globalThis.crypto?.randomUUID === 'function'
    ? () => globalThis.crypto.randomUUID()
    : fallback;

export function setIdGenerator(g: IdGen) {
  gen = g;
}

export function newId(): string {
  return gen();
}
