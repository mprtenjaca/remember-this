// Cloudflare Worker — AI proxy for Remember This. Holds the provider keys; the RN app never sees them.
// The app and the p0 harness always speak the GEMINI request/response shape; this worker translates
// for other providers and fails over between them. Swap models/providers here without an app update.
//
//   POST /            { endpoint: 'enrich'|'edit'|'transcribe'|'embed', body: <Gemini-shaped request> }
//                     → Gemini-shaped response: { candidates:[{content:{parts:[{text}]}}] } (or {embedding:{values}})
//   GET  /health      which providers/models are configured and callable
//
// Providers
//   groq   — openai/gpt-oss-120b for enrich/edit (30 RPM, 1000 RPD free), whisper-large-v3-turbo for transcribe
//   gemini — gemini-3.5-flash (5 RPM free, per model), gemini-embedding-001 for embed (Groq has no embeddings)
//
// Secrets:  npx wrangler secret put GROQ_API_KEY      npx wrangler secret put GEMINI_API_KEY
// Optional KV binding RL for a per-device daily budget — without it the worker still works.

export interface Env {
  GEMINI_API_KEY?: string;
  GEMINI_KEY?: string;
  GROQ_API_KEY?: string;
  RL?: KVNamespace;
  DAILY_LIMIT?: string;
  ENRICH_PROVIDER?: 'groq' | 'gemini';
  ENRICH_MODEL?: string; // gemini
  FALLBACK_MODEL?: string; // gemini lite, used once when ENRICH_MODEL returns 429
  EMBED_MODEL?: string;
  GROQ_MODEL?: string;
  GROQ_WHISPER?: string;
  /** gpt-oss reasoning depth: low | medium | high. Follows the prompt — see groqChat(). */
  GROQ_REASONING?: string;
  /** Gemini speech-to-text model. Free tier is only 25/day, so Whisper stays as the automatic fallback. */
  GEMINI_TRANSCRIBE?: string;
}

type Endpoint = 'enrich' | 'embed' | 'edit' | 'transcribe';
type Provider = 'groq' | 'gemini';
const ALLOWED: ReadonlySet<string> = new Set(['enrich', 'embed', 'edit', 'transcribe']);

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ = 'https://api.groq.com/openai/v1';

function cfg(env: Env) {
  return {
    geminiKey: env.GEMINI_API_KEY || env.GEMINI_KEY || null,
    groqKey: env.GROQ_API_KEY || null,
    geminiChat: env.ENRICH_MODEL || 'gemini-3.5-flash',
    geminiLite: env.FALLBACK_MODEL || 'gemini-3.5-flash-lite',
    geminiEmbed: env.EMBED_MODEL || 'gemini-embedding-001',
    // Empty string means "off" — `||` would silently resurrect the default, so the check is explicit.
    geminiTranscribe: env.GEMINI_TRANSCRIBE === undefined ? '' : env.GEMINI_TRANSCRIBE,
    groqChat: env.GROQ_MODEL || 'openai/gpt-oss-120b',
    groqWhisper: env.GROQ_WHISPER || 'whisper-large-v3-turbo',
    groqReasoning: (['low', 'medium', 'high'].includes(env.GROQ_REASONING ?? '') ? env.GROQ_REASONING : 'medium') as 'low' | 'medium' | 'high',
    provider: (env.ENRICH_PROVIDER === 'gemini' ? 'gemini' : 'groq') as Provider,
  };
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
}

function geminiShaped(text: string, provider: string, model: string): Response {
  return json({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }], provider, model }, 200, { 'x-provider': provider, 'x-model-used': model });
}

async function rateLimit(env: Env, deviceId: string): Promise<boolean> {
  if (!env.RL) return true;
  const limit = Number(env.DAILY_LIMIT ?? 200);
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${day}:${deviceId}`;
  const used = Number((await env.RL.get(key)) ?? 0);
  if (used >= limit) return false;
  await env.RL.put(key, String(used + 1), { expirationTtl: 86_400 });
  return true;
}

// ───────────────────────────────────────────── Gemini request shape helpers

type Part = { text?: string; inlineData?: { mimeType: string; data: string } };
type GeminiBody = {
  contents?: Array<{ role?: string; parts?: Part[] }>;
  systemInstruction?: { parts?: Part[] };
  generationConfig?: Record<string, unknown> & { responseSchema?: unknown; responseMimeType?: string; temperature?: number; maxOutputTokens?: number };
};

function textOf(parts: Part[] | undefined): string {
  return (parts ?? []).map((p) => p.text ?? '').join('\n').trim();
}

/** Gemini's OpenAPI-flavoured schema → plain JSON Schema (nullable → type union, drop propertyOrdering). */
function toJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (!node || typeof node !== 'object') return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === 'propertyOrdering' || k === 'nullable') continue;
    out[k] = toJsonSchema(v);
  }
  if (src.nullable === true && typeof out.type === 'string') out.type = [out.type, 'null'];
  return out;
}

// ───────────────────────────────────────────── Providers

// A hanging upstream used to burn the whole request: no fetch here had a deadline, so when Groq stalled the worker
// waited until Cloudflare killed it at ~125 s with a 524 — and the Gemini failover never ran, because failover is
// triggered by a 429/5xx STATUS and a hung request never produces one. Every upstream call is now bounded, and a
// timeout is reported as 504 (retryable) so the next provider in `order` gets its turn.
const UPSTREAM_TIMEOUT_MS = 20_000;
const WHISPER_TIMEOUT_MS = 45_000; // audio upload + transcription is legitimately slower

async function withDeadline(label: string, ms: number, run: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } catch (e) {
    const aborted = ctrl.signal.aborted;
    return json({ error: `${label}: ${aborted ? `timed out after ${ms} ms` : e instanceof Error ? e.message : 'upstream error'}` }, aborted ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(model: string, action: string, body: Record<string, unknown>, key: string): Promise<Response> {
  // "-lite" models have no thinking and reject thinkingConfig with 400 "invalid argument" — strip it for them.
  let b = body;
  const gc = body.generationConfig as Record<string, unknown> | undefined;
  if (/lite/i.test(model) && gc && 'thinkingConfig' in gc) {
    const { thinkingConfig: _t, ...rest } = gc;
    b = { ...body, generationConfig: rest };
  }
  return withDeadline(`gemini ${model}`, UPSTREAM_TIMEOUT_MS, (signal) =>
    fetch(`${GEMINI}/models/${model}:${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(b),
      signal,
    }),
  );
}

/** Gemini generateContent body → Groq chat completion (JSON mode, schema embedded in the system prompt). */
async function groqChat(body: GeminiBody, model: string, key: string, effort: 'low' | 'medium' | 'high' = 'medium'): Promise<Response> {
  const system = textOf(body.systemInstruction?.parts);
  const user = textOf(body.contents?.[0]?.parts);
  const gc = body.generationConfig ?? {};
  const wantsJson = gc.responseMimeType === 'application/json' || !!gc.responseSchema;
  const schemaNote = gc.responseSchema
    ? `\n\nODGOVOR: isključivo jedan valjani JSON objekt (bez markdowna, bez komentara) koji odgovara ovoj JSON shemi. Polja koja ne znaš stavi na null ili prazan niz; "questions" i "triggers" su uvijek nizovi.\n${JSON.stringify(toJsonSchema(gc.responseSchema))}`
    : wantsJson
      ? '\n\nODGOVOR: isključivo valjani JSON, bez markdowna.'
      : '';
  const payload: Record<string, unknown> = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system + schemaNote }] : []),
      { role: 'user', content: user || ' ' },
    ],
    // Extraction into a fixed schema, not open generation: low temperature on purpose. Groq's own sample uses 1,
    // which is right for chat and wrong here — we want the same note to classify the same way every time.
    temperature: typeof gc.temperature === 'number' ? gc.temperature : 0.2,
    max_completion_tokens: typeof gc.maxOutputTokens === 'number' ? Math.max(gc.maxOutputTokens, 800) : 1500,
    // gpt-oss is a reasoning model. Tunable from wrangler.toml because the right setting follows the prompt:
    // "low" was needed when the system prompt was ~4 KB, but now that time parsing moved into temporal.ts the
    // remaining work is genuine judgement (intent boundaries), which is where thinking actually pays.
    reasoning_effort: effort,
  };
  if (wantsJson) payload.response_format = { type: 'json_object' };
  return withDeadline(`groq ${model}`, UPSTREAM_TIMEOUT_MS, (signal) =>
    fetch(`${GROQ}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal,
    }),
  );
}

/** Gemini inlineData audio → Groq Whisper transcription. */
async function groqWhisper(body: GeminiBody, model: string, key: string): Promise<Response> {
  const audio = body.contents?.[0]?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!audio) return json({ error: 'no audio' }, 400);
  const bin = Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0));
  const ext = /wav/.test(audio.mimeType) ? 'wav' : /mp3|mpeg/.test(audio.mimeType) ? 'mp3' : /ogg/.test(audio.mimeType) ? 'ogg' : 'm4a';
  const form = new FormData();
  form.append('file', new Blob([bin], { type: audio.mimeType }), `voice.${ext}`);
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  // Pin the language: Whisper's auto-detect turns short Croatian clips into Slovenian/Serbian/Czech.
  const lang = typeof (body as { language?: unknown }).language === 'string' ? (body as { language: string }).language.toLowerCase() : 'hr';
  form.append('language', /^[a-z]{2}$/.test(lang) ? lang : 'hr');
  // Whisper's prompt = vocabulary + continuity. The app sends the note text so far as a text part; feeding its tail
  // back makes a second dictation continue in the same style (and keeps Croatian, not Czech).
  const context = textOf(body.contents?.[0]?.parts?.filter((p) => p.text)).slice(-600);
  const hint = 'Kratka osobna bilješka na hrvatskom. Datume piši znamenkama: 3.5., 10.6.2027. Imena, rođendan, godišnjica, servis, restoran, podsjetnik.';
  form.append('prompt', context ? `${hint} Dosad: ${context}` : hint);
  return withDeadline(`whisper ${model}`, WHISPER_TIMEOUT_MS, (signal) =>
    fetch(`${GROQ}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal }),
  );
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

// ───────────────────────────────────────────── Router

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const c = cfg(env);
    const url = new URL(req.url);

    if (req.method === 'GET' && (url.pathname === '/models' || url.pathname === '/health')) {
      const out: Record<string, unknown> = {
        ok: !!(c.geminiKey || c.groqKey),
        provider: c.provider,
        groq: c.groqKey ? { chat: c.groqChat, whisper: c.groqWhisper } : 'GROQ_API_KEY not set',
        gemini: c.geminiKey ? { chat: c.geminiChat, lite: c.geminiLite, embed: c.geminiEmbed, transcribe: c.geminiTranscribe } : 'GEMINI_API_KEY not set',
      };
      if (c.geminiKey) {
        const res = await fetch(`${GEMINI}/models`, { headers: { 'x-goog-api-key': c.geminiKey } });
        const body = (await res.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
        out.geminiModels = (body.models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name);
      }
      return json(out);
    }

    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (!c.geminiKey && !c.groqKey) return json({ error: 'no provider key set (GROQ_API_KEY / GEMINI_API_KEY)' }, 500);

    const deviceId = req.headers.get('x-device-id');
    if (!deviceId || deviceId.length > 128) return json({ error: 'missing device id' }, 401);
    if (!(await rateLimit(env, deviceId))) return json({ error: 'rate limited' }, 429);

    let payload: { endpoint?: string; body?: unknown };
    try {
      payload = (await req.json()) as { endpoint?: string; body?: unknown };
    } catch {
      return json({ error: 'bad json' }, 400);
    }
    const endpoint = payload.endpoint as Endpoint | undefined;
    if (!endpoint || !ALLOWED.has(endpoint) || payload.body == null) return json({ error: 'bad endpoint' }, 400);
    const body = payload.body as GeminiBody & Record<string, unknown>;

    // Diagnostics: `x-model: gemini-…` or `x-provider: groq|gemini` forces a path.
    const forcedProvider = req.headers.get('x-provider') as Provider | null;
    const override = req.headers.get('x-model');
    const forcedModel = override && /^[a-z0-9./_-]+$/i.test(override) ? override : null;

    // ── embed: Gemini only
    if (endpoint === 'embed') {
      if (!c.geminiKey) return json({ error: 'embeddings need GEMINI_API_KEY' }, 501);
      body.model = `models/${c.geminiEmbed}`;
      const r = await callGemini(c.geminiEmbed, 'embedContent', body, c.geminiKey);
      return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'x-provider': 'gemini', 'x-model-used': c.geminiEmbed } });
    }

    // ── provider order: configured primary first, the other as failover on 429/5xx
    const order: Provider[] = forcedProvider ? [forcedProvider] : c.provider === 'groq' ? ['groq', 'gemini'] : ['gemini', 'groq'];
    let last: Response | null = null;

    for (const p of order) {
      if (p === 'groq') {
        if (!c.groqKey) continue;
        if (endpoint === 'transcribe') {
          const r = await groqWhisper(body, forcedModel ?? c.groqWhisper, c.groqKey);
          if (r.ok) {
            const j = (await r.json()) as { text?: string };
            return geminiShaped((j.text ?? '').trim(), 'groq', c.groqWhisper);
          }
          last = r;
          if (!retryable(r.status)) break;
          continue;
        }
        const model = forcedModel ?? c.groqChat;
        const r = await groqChat(body, model, c.groqKey, c.groqReasoning);
        if (r.ok) {
          const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const text = j.choices?.[0]?.message?.content ?? '';
          if (text.trim()) return geminiShaped(text, 'groq', model);
          last = json({ error: 'groq: empty completion' }, 502);
          continue;
        }
        last = r;
        if (!retryable(r.status)) break;
        continue;
      }

      // gemini
      if (!c.geminiKey) continue;

      // Transcription goes to a dedicated model, not to the chat one. Gemini takes the audio as inlineData in
      // an ordinary generateContent call, so the app's existing body shape already fits; we only pick the model
      // and pull the plain text back out. On 429 (25/day on the free tier) the loop falls through to Whisper.
      if (endpoint === 'transcribe') {
        if (!c.geminiTranscribe) continue; // disabled → straight to Whisper
        const r = await callGemini(forcedModel ?? c.geminiTranscribe, 'generateContent', body, c.geminiKey);
        if (r.ok) {
          const j = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
          const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
          if (text) return geminiShaped(text, 'gemini', c.geminiTranscribe);
        } else {
          last = r;
        }
        // ALWAYS fall through to the next provider, whatever went wrong. Transcription is not like chat: a
        // failure here means the user watched their words vanish into an empty box, so there is no error worth
        // stopping on. This branch used to `break` on a non-retryable status, and Gemini answers our request
        // shape with 400 — which killed the request before Whisper ever ran.
        continue;
      }

      const model = forcedModel ?? c.geminiChat;
      let r = await callGemini(model, 'generateContent', body, c.geminiKey);
      if (r.status === 429 && c.geminiLite !== model) {
        const second = await callGemini(c.geminiLite, 'generateContent', body, c.geminiKey);
        if (second.status !== 429) {
          return new Response(second.body, { status: second.status, headers: { 'content-type': 'application/json', 'x-provider': 'gemini', 'x-model-used': c.geminiLite } });
        }
        r = second;
      }
      if (r.ok) return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json', 'x-provider': 'gemini', 'x-model-used': model } });
      last = r;
      if (!retryable(r.status)) break;
    }

    // Pass the last upstream message through: a 429 alone doesn't say whether it's "too fast" or "no free tier".
    if (!last) return json({ error: 'no provider available for this endpoint' }, 503);
    return new Response(last.body, { status: last.status, headers: { 'content-type': 'application/json' } });
  },
};
