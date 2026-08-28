// Domain types. Pure TypeScript — no React, no Expo imports here.

export type Intent = 'future_need' | 'task' | 'fact' | 'idea' | 'gift' | 'contact';

export type TriggerType = 'time' | 'anchor' | 'location' | 'semantic' | 'person';

export type Certainty = 'low' | 'medium' | 'high';

export type TriggerState = 'active' | 'fired' | 'dismissed' | 'done';

export type NoteStatus = 'pending' | 'enriched' | 'failed' | 'needs_input';

export type Language = 'hr' | 'en';

// ─── payload per type (JSON in triggers.payload)

export type TimePayload = { iso: string; recurring?: 'daily' | 'weekly' | 'yearly' };
/** Offset lives in the column. `person`/`kind` are kept only while the anchor is still unresolved (needs_input). */
export type AnchorPayload = { hour: number; minute: number; person?: string; kind?: AnchorKind };
export type LocationPayload = { lat: number; lng: number; radius: number; label: string };
export type SemanticPayload = { keywords: string[] };
export type PersonPayload = { person: string; contactId?: string };

export type TriggerPayload =
  | { type: 'time'; data: TimePayload }
  | { type: 'anchor'; data: AnchorPayload }
  | { type: 'location'; data: LocationPayload }
  | { type: 'semantic'; data: SemanticPayload }
  | { type: 'person'; data: PersonPayload };

export type PayloadOf<T extends TriggerType> = Extract<TriggerPayload, { type: T }>['data'];

export interface Trigger {
  id: string;
  noteId: string;
  type: TriggerType;
  payload: TriggerPayload['data'];
  label: string | null;
  certainty: number;
  anchorId: string | null;
  offsetDays: number | null;
  fireAt: number | null;
  nextEvalAt: number | null;
  osNotificationId: string | null;
  state: TriggerState;
  fireCount: number;
  lastFiredAt: number | null;
  userEdited: boolean; // ⚠ enrich never overwrites a trigger with userEdited = true
  createdAt: number;
  updatedAt: number;
}

/** What enrich / AI / manual "+" produce before a Trigger row exists. */
export interface TriggerDraft {
  type: TriggerType;
  payload: TriggerPayload['data'];
  label: string | null;
  certainty: number;
  anchorId?: string | null;
  offsetDays?: number | null;
  fireAt?: number | null;
  nextEvalAt?: number | null;
}

/**
 * 'memorial' is the anniversary of a death — Dalmatian "god" ("babi je god"). It is deliberately its own kind:
 * it must never inherit the gift chain, because suggesting a present for someone who died is the worst thing
 * this app could do.
 */
export type AnchorKind = 'birthday' | 'anniversary' | 'annual' | 'oneoff' | 'memorial';

export interface Anchor {
  id: string;
  label: string;
  person: string | null;
  kind: AnchorKind;
  monthDay: string | null; // 'MM-DD'
  year: number | null;
  contactId: string | null;
  source: 'contacts' | 'user' | 'inferred';
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  rawText: string;
  summary: string | null;
  language: Language | null;
  category: string | null;
  intent: Intent | null;
  confidence: number | null;
  status: NoteStatus;
  summaryEdited: boolean;
  archived: boolean;
  source: 'typed' | 'voice' | 'share' | 'import';
  createdAt: number;
  updatedAt: number;
  enrichedAt: number | null;
  enrichAttempts: number;
}

export type Reaction = 'useful' | 'not_now' | 'wrong' | 'done' | 'ignored';

export type SurfacingChannel = 'notification' | 'today' | 'inline_search' | 'digest';

export interface Surfacing {
  id: string;
  noteId: string;
  triggerId: string | null;
  channel: SurfacingChannel;
  score: number | null;
  shownAt: number;
  reaction: Reaction | null;
  reactedAt: number | null;
}

// ─── mutations: the only path that changes trigger/anchor/summary state.
// Same types double as function-calling tools for the AI edit chat.

export type Mutation =
  | { op: 'set_time'; triggerId: string; iso: string }
  | { op: 'shift_offset'; triggerId: string; days: number }
  | { op: 'add_trigger'; trigger: TriggerDraft & { id?: string } }
  | { op: 'remove_trigger'; triggerId: string }
  | { op: 'set_state'; triggerId: string; state: TriggerState }
  | { op: 'set_anchor'; anchorId: string; monthDay?: string; year?: number }
  | { op: 'edit_summary'; text: string }
  | { op: 'set_keywords'; triggerId: string; keywords: string[] };

export type EditSource = 'manual' | 'ai_chat' | 'enrich' | 'learned';

export interface EditRecord {
  id: string;
  noteId: string;
  target: string; // trigger:<id> | note.summary | anchor:<id>
  before: string | null; // JSON snapshot
  after: string | null; // JSON mutation
  source: EditSource;
  createdAt: number;
}

// ─── enrich result — what the LLM (or the local heuristic) returns.
// Flat, nullable payload fields on purpose: Gemini responseSchema has no anyOf.

export interface EnrichTrigger {
  type: TriggerType;
  certainty: Certainty;
  label: string;
  iso_datetime?: string | null;
  keywords?: string[] | null;
  anchor_person?: string | null;
  anchor_kind?: AnchorKind | null;
  /** 'MM-DD' when the note itself states the date ("rođendan 10.6") — then nobody needs to be asked. */
  anchor_month_day?: string | null;
  offset_days?: number | null;
  place_query?: string | null;
  person?: string | null;
}

export interface EnrichQuestion {
  id: string;
  text: string;
  /**
   * 'options' — an answer kept as a keyword; 'date' — creates an anchor;
   * 'interval' — MOVES the fallback reminder. The distinction matters: an 'options' answer never touches a
   * trigger, so offering "za 3 mjeseca" as one would clear the question and change nothing.
   */
  kind: 'options' | 'date' | 'interval';
  options?: string[];
  /** For kind 'interval': months behind each option, positionally matched to `options`. */
  optionMonths?: number[];
  /** For kind 'date': whose date this is, so the answer can create the anchor even if no pending trigger exists. */
  person?: string;
  anchorKind?: AnchorKind;
}

export interface EnrichResult {
  summary: string;
  language: Language;
  category?: string | null;
  intent: Intent;
  confidence: number;
  entities?: {
    people?: string[];
    orgs?: string[];
    places?: string[];
    keywords?: string[];
  };
  needs_anchor?: { person: string; kind: AnchorKind } | null;
  triggers: EnrichTrigger[];
  questions: EnrichQuestion[];
}

export const CERTAINTY_VALUE: Record<Certainty, number> = {
  low: 0.3,
  medium: 0.6,
  high: 0.9,
};
