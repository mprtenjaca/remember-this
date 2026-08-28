// Every provider (Gemini with/without a hard schema, Groq JSON mode, the heuristic) funnels through here
// before ingest(). Missing arrays become empty, junk becomes null, enums are clamped — ingest never crashes
// on a model that "almost" followed the schema.

import type { AnchorKind, Certainty, EnrichQuestion, EnrichResult, EnrichTrigger, Intent, TriggerType } from '../types';

const INTENTS: ReadonlySet<string> = new Set<Intent>(['future_need', 'task', 'fact', 'idea', 'gift', 'contact']);
const TRIGGER_TYPES: ReadonlySet<string> = new Set<TriggerType>(['time', 'anchor', 'location', 'semantic', 'person']);
const CERTAINTIES: ReadonlySet<string> = new Set<Certainty>(['low', 'medium', 'high']);
const KINDS: ReadonlySet<string> = new Set<AnchorKind>(['birthday', 'anniversary', 'annual', 'oneoff']);

// The category is shown to the user as a chip on the card, so a hallucinated key leaks straight into the UI —
// Groq returned "future_need_mechanic" (an intent name glued to a guess) and the Today card rendered
// "future need mechanic". A category is never an intent: drop anything that starts with one.
const KNOWN_CATEGORIES: ReadonlySet<string> = new Set([
  'auto_servis', 'zdravlje', 'dom', 'poklon', 'restoran', 'putovanje', 'posao', 'financije', 'preporuka', 'ostalo',
]);

/** Clamp the model's category: known keys pass, intent-flavoured inventions are dropped, anything else is trusted once. */
function category(v: unknown): string | null {
  const raw = str(v)?.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') ?? null;
  if (!raw) return null;
  if (KNOWN_CATEGORIES.has(raw)) return raw;
  // "future_need", "future_need_mechanic", "task_call" … — the model echoed the intent instead of a category.
  for (const i of INTENTS) if (raw === i || raw.startsWith(`${i}_`)) return null;
  return raw;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()) : []);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : fallback);

function trigger(raw: unknown): EnrichTrigger | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = str(r.type)?.toLowerCase();
  if (!type || !TRIGGER_TYPES.has(type)) return null;
  const certainty = str(r.certainty)?.toLowerCase();
  const kind = str(r.anchor_kind)?.toLowerCase();
  const offset = r.offset_days == null ? null : Math.round(num(r.offset_days, NaN));
  return {
    type: type as TriggerType,
    certainty: (certainty && CERTAINTIES.has(certainty) ? certainty : 'medium') as Certainty,
    label: str(r.label) ?? '',
    iso_datetime: str(r.iso_datetime),
    keywords: Array.isArray(r.keywords) ? strs(r.keywords) : null,
    anchor_person: str(r.anchor_person),
    anchor_kind: kind && KINDS.has(kind) ? (kind as AnchorKind) : null,
    anchor_month_day: str(r.anchor_month_day),
    offset_days: offset != null && Number.isFinite(offset) ? offset : null,
    place_query: str(r.place_query),
    person: str(r.person),
  };
}

function question(raw: unknown, i: number): EnrichQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = str(r.text);
  if (!text) return null;
  const kind = str(r.kind)?.toLowerCase() === 'date' ? 'date' : 'options';
  const options = strs(r.options);
  if (kind === 'options' && options.length < 2) return null;
  return { id: str(r.id) ?? `q${i + 1}`, text, kind, ...(kind === 'options' ? { options } : {}) };
}

/**
 * The model's triggers, from either shape.
 *
 * New (slim) shape: `keywords: string[]` + `anchor: {person, kind}` — no times at all, because parseTemporal()
 * owns every date. Old shape: a full `triggers[]` array. Both are accepted so a stale response, a cached reply
 * or the harness's own fixtures keep working; time triggers from the model are dropped either way, since
 * reconcile() replaces them with our own parsed signals.
 */
function modelTriggers(r: Record<string, unknown>): EnrichTrigger[] {
  const out: EnrichTrigger[] = [];

  const kw = strs(r.keywords);
  if (kw.length) out.push({ type: 'semantic', certainty: 'high', label: '', keywords: kw });

  const a = r.anchor as Record<string, unknown> | null | undefined;
  const person = a && typeof a === 'object' ? str(a.person) : null;
  if (person) {
    const kind = str(a!.kind)?.toLowerCase();
    out.push({
      type: 'anchor',
      certainty: 'high',
      label: '',
      anchor_person: person,
      anchor_kind: (kind && KINDS.has(kind) ? kind : 'birthday') as AnchorKind,
      anchor_month_day: null,
      offset_days: null,
    });
  }

  // Legacy array — keep everything except times (ours win) and locations (M5).
  for (const raw of Array.isArray(r.triggers) ? r.triggers : []) {
    const t = trigger(raw);
    if (!t) continue;
    if (t.type === 'semantic' && out.some((x) => x.type === 'semantic')) {
      const existing = out.find((x) => x.type === 'semantic')!;
      existing.keywords = [...(existing.keywords ?? []), ...(t.keywords ?? [])];
      continue;
    }
    if (t.type === 'anchor' && out.some((x) => x.type === 'anchor')) continue;
    out.push(t);
  }
  return out;
}

/** Returns null when the payload is not even close to an EnrichResult (no usable summary or wrong shape). */
export function normalizeEnrichResult(input: unknown, fallbackText?: string): EnrichResult | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  const summary = str(r.summary) ?? (fallbackText ? fallbackText.split(/\s+/).slice(0, 8).join(' ') : null);
  if (!summary) return null;
  const intent = str(r.intent)?.toLowerCase();
  const na = r.needs_anchor as Record<string, unknown> | null | undefined;
  const naPerson = na && typeof na === 'object' ? str(na.person) : null;
  const naKind = na && typeof na === 'object' ? str(na.kind)?.toLowerCase() : null;
  const ent = (r.entities && typeof r.entities === 'object' ? r.entities : {}) as Record<string, unknown>;

  return {
    summary,
    language: str(r.language)?.toLowerCase() === 'en' ? 'en' : 'hr',
    category: category(r.category),
    intent: (intent && INTENTS.has(intent) ? intent : 'fact') as Intent,
    confidence: Math.max(0, Math.min(1, num(r.confidence, 0.5))),
    entities: { people: strs(ent.people), orgs: strs(ent.orgs), places: strs(ent.places), keywords: strs(ent.keywords) },
    needs_anchor: naPerson ? { person: naPerson, kind: (naKind && KINDS.has(naKind) ? naKind : 'birthday') as AnchorKind } : null,
    triggers: modelTriggers(r),
    questions: (Array.isArray(r.questions) ? r.questions : []).map(question).filter((q): q is EnrichQuestion => q !== null),
  };
}
