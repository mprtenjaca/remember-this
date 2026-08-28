// Harness enrich: same prompt + schema as the app, called directly against Gemini
// (the key is fine here — this is a local Node CLI, never shipped).
//   GEMINI_KEY=... npm run p0            → Gemini
//   npm run p0 -- --heuristic            → local heuristic baseline (no key needed)

import { buildEnrichBody, extractJsonText, type PromptContext } from '../src/services/ai/prompt';
import { heuristicEnrich } from '../src/domain/enrich/heuristic';
import type { Anchor, EnrichResult } from '../src/domain/types';

// Direct mode only (GEMINI_KEY set). The app itself never picks a model — the worker does (worker/wrangler.toml [vars]).
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash';

/** Free tier: 5 requests/min per model. On 429 Google says "Please retry in 4.2s" — honour it, up to 4 times. */
export async function fetchWithQuotaRetry(url: string, init: RequestInit, attempts = 4): Promise<Response> {
  let res = await fetch(url, init);
  for (let i = 0; i < attempts && res.status === 429; i++) {
    const text = await res.clone().text();
    const m = /retry in ([\d.]+)s/i.exec(text);
    const waitMs = Math.ceil((m ? Number(m[1]) : 12) * 1000) + 500;
    process.stdout.write(`(429 → ${Math.round(waitMs / 1000)}s)`);
    await new Promise((r) => setTimeout(r, waitMs));
    res = await fetch(url, init);
  }
  return res;
}

export interface HarnessContext {
  now: number;
  timezone: string;
  anchors: Anchor[];
  prefs: Record<string, string>;
}

export interface HarnessOutcome {
  result: EnrichResult | null;
  raw: string;
  ms: number;
  error?: string;
}

const WEEKDAYS = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];

export async function enrichWithGemini(text: string, ctx: HarnessContext): Promise<HarnessOutcome> {
  const key = process.env.GEMINI_KEY;
  if (!key) throw new Error('GEMINI_KEY missing (or run with --heuristic)');
  const d = new Date(ctx.now);
  const pctx: PromptContext = {
    todayIso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    weekday: WEEKDAYS[d.getDay()]!,
    timezone: ctx.timezone,
    anchors: ctx.anchors.map((a) => ({ person: a.person, kind: a.kind, monthDay: a.monthDay })),
    prefs: ctx.prefs,
  };
  const t0 = performance.now();
  try {
    const res = await fetchWithQuotaRetry(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(buildEnrichBody(text, pctx)),
    });
    const ms = performance.now() - t0;
    if (!res.ok) return { result: null, raw: await res.text(), ms, error: `HTTP ${res.status}` };
    const raw = extractJsonText(await res.json());
    try {
      return { result: JSON.parse(raw) as EnrichResult, raw, ms };
    } catch (e) {
      return { result: null, raw, ms, error: `invalid JSON: ${(e as Error).message}` };
    }
  } catch (e) {
    return { result: null, raw: '', ms: performance.now() - t0, error: (e as Error).message };
  }
}

/** Through the deployed Cloudflare Worker — exactly the path the app takes. No local key needed. */
export async function enrichViaProxy(text: string, ctx: HarnessContext, proxyUrl: string): Promise<HarnessOutcome> {
  const d = new Date(ctx.now);
  const pctx: PromptContext = {
    todayIso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    weekday: WEEKDAYS[d.getDay()]!,
    timezone: ctx.timezone,
    anchors: ctx.anchors.map((a) => ({ person: a.person, kind: a.kind, monthDay: a.monthDay })),
    prefs: ctx.prefs,
  };
  const t0 = performance.now();
  try {
    const res = await fetchWithQuotaRetry(`${proxyUrl.replace(/\/$/, '')}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-device-id': 'p0-harness' },
      body: JSON.stringify({ endpoint: 'enrich', body: buildEnrichBody(text, pctx) }),
    });
    const ms = performance.now() - t0;
    if (!res.ok) return { result: null, raw: await res.text(), ms, error: `HTTP ${res.status}` };
    const raw = extractJsonText(await res.json());
    try {
      return { result: JSON.parse(raw) as EnrichResult, raw, ms };
    } catch (e) {
      return { result: null, raw, ms, error: `invalid JSON: ${(e as Error).message}` };
    }
  } catch (e) {
    return { result: null, raw: '', ms: performance.now() - t0, error: (e as Error).message };
  }
}

export async function enrichWithHeuristic(text: string, ctx: HarnessContext): Promise<HarnessOutcome> {
  const t0 = performance.now();
  const result = heuristicEnrich(text, { now: ctx.now, anchors: ctx.anchors });
  return { result, raw: JSON.stringify(result), ms: performance.now() - t0 };
}
