// Enrich one note: remote (Gemini via worker) when configured and reachable,
// local heuristic otherwise. Both return EnrichResult → ingest() enforces the rules.

import { clock } from '@/domain/clock';
import { weekdayName } from '@/domain/dates';
import { heuristicEnrich } from '@/domain/enrich/heuristic';
import { parseTemporal, resolveSignal, signalLabel } from '@/domain/enrich/temporal';
import { fmtDateTime } from '@/domain/dates';
import { normalizeEnrichResult } from '@/domain/enrich/normalize';
import type { Anchor, EnrichResult } from '@/domain/types';
import { AiUnavailable, aiConfigured, callProxy } from './client';
import { buildEnrichBody, extractJsonText } from './prompt';

export type EnrichSource = 'gemini' | 'heuristic';

export interface EnrichOutcome {
  result: EnrichResult;
  source: EnrichSource;
}

function isEnrichResult(x: unknown): x is EnrichResult {
  const r = x as EnrichResult;
  return !!r && typeof r.summary === 'string' && Array.isArray(r.triggers) && Array.isArray(r.questions) && typeof r.intent === 'string';
}

export async function enrichRemote(rawText: string, anchors: Anchor[], prefs: Record<string, string>): Promise<EnrichResult> {
  const now = clock.now();
  const d = new Date(now);
  const todayIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Hand the model what we already resolved, as short lines. Two effects: it stops trying to date the note
  // (the single biggest source of invented reminders), and it costs a handful of tokens instead of the pages of
  // date arithmetic the prompt used to carry.
  const temporal = parseTemporal(rawText, now)
    .map((sig) => {
      const r = resolveSignal(sig, now, 'task');
      const label = signalLabel(sig, 'hr');
      return r?.fireAt != null ? `${label} → ${fmtDateTime(r.fireAt)}` : label;
    })
    .slice(0, 4);

  const body = buildEnrichBody(rawText, {
    temporal,
    todayIso,
    weekday: weekdayName(now, 'hr'),
    timezone: clock.timezone(),
    anchors: anchors.map((a) => ({ person: a.person, kind: a.kind, monthDay: a.monthDay })),
    prefs,
  });
  const resp = await callProxy<unknown>('enrich', body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(resp));
  } catch {
    throw new AiUnavailable('model returned non-JSON', false);
  }
  // Providers without a hard response schema (Groq JSON mode, Gemini lite) may omit arrays or drift on enums —
  // normalise before validating so ingest() never sees a half-shaped result.
  const normalized = normalizeEnrichResult(parsed, rawText);
  if (!normalized || !isEnrichResult(normalized)) throw new AiUnavailable('schema mismatch', false);
  return normalized;
}

/**
 * Remote first; falls back to the heuristic on any non-retryable failure or when
 * unconfigured. Retryable failures (network, 429, 5xx) bubble up so the queue can
 * retry later — but the caller may still choose the heuristic for an instant result.
 */
export async function enrichNote(rawText: string, anchors: Anchor[], prefs: Record<string, string>): Promise<EnrichOutcome> {
  if (!aiConfigured()) {
    return { result: heuristicEnrich(rawText, { now: clock.now(), anchors }), source: 'heuristic' };
  }
  try {
    return { result: await enrichRemote(rawText, anchors, prefs), source: 'gemini' };
  } catch (e) {
    if (e instanceof AiUnavailable && e.retryable) throw e;
    return { result: heuristicEnrich(rawText, { now: clock.now(), anchors }), source: 'heuristic' };
  }
}
