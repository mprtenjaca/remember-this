// Row ↔ domain mapping. Rows are snake_case as stored; domain objects are camelCase.

import type { Anchor, EditRecord, Note, Surfacing, Trigger, EnrichQuestion } from '@/domain/types';

export interface NoteRow {
  id: string;
  raw_text: string;
  summary: string | null;
  language: string | null;
  category: string | null;
  intent: string | null;
  confidence: number | null;
  status: string;
  summary_edited: number;
  archived: number;
  source: string;
  created_at: number;
  updated_at: number;
  enriched_at: number | null;
  enrich_attempts: number;
  questions: string | null;
}

export function toNote(r: NoteRow): Note & { questions: EnrichQuestion[] } {
  return {
    id: r.id,
    rawText: r.raw_text,
    summary: r.summary,
    language: r.language as Note['language'],
    category: r.category,
    intent: r.intent as Note['intent'],
    confidence: r.confidence,
    status: r.status as Note['status'],
    summaryEdited: r.summary_edited === 1,
    archived: r.archived === 1,
    source: r.source as Note['source'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    enrichedAt: r.enriched_at,
    enrichAttempts: r.enrich_attempts,
    questions: r.questions ? (JSON.parse(r.questions) as EnrichQuestion[]) : [],
  };
}

export interface TriggerRow {
  id: string;
  note_id: string;
  type: string;
  payload: string;
  label: string | null;
  certainty: number;
  anchor_id: string | null;
  offset_days: number | null;
  fire_at: number | null;
  next_eval_at: number | null;
  os_notification_id: string | null;
  state: string;
  fire_count: number;
  last_fired_at: number | null;
  user_edited: number;
  created_at: number;
  updated_at: number;
}

export function toTrigger(r: TriggerRow): Trigger {
  return {
    id: r.id,
    noteId: r.note_id,
    type: r.type as Trigger['type'],
    payload: JSON.parse(r.payload),
    label: r.label,
    certainty: r.certainty,
    anchorId: r.anchor_id,
    offsetDays: r.offset_days,
    fireAt: r.fire_at,
    nextEvalAt: r.next_eval_at,
    osNotificationId: r.os_notification_id,
    state: r.state as Trigger['state'],
    fireCount: r.fire_count,
    lastFiredAt: r.last_fired_at,
    userEdited: r.user_edited === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface AnchorRow {
  id: string;
  label: string;
  person: string | null;
  kind: string;
  month_day: string | null;
  year: number | null;
  contact_id: string | null;
  source: string;
  created_at: number;
  updated_at: number;
}

export function toAnchor(r: AnchorRow): Anchor {
  return {
    id: r.id,
    label: r.label,
    person: r.person,
    kind: r.kind as Anchor['kind'],
    monthDay: r.month_day,
    year: r.year,
    contactId: r.contact_id,
    source: r.source as Anchor['source'],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface SurfacingRow {
  id: string;
  note_id: string;
  trigger_id: string | null;
  channel: string;
  score: number | null;
  shown_at: number;
  reaction: string | null;
  reacted_at: number | null;
}

export function toSurfacing(r: SurfacingRow): Surfacing {
  return {
    id: r.id,
    noteId: r.note_id,
    triggerId: r.trigger_id,
    channel: r.channel as Surfacing['channel'],
    score: r.score,
    shownAt: r.shown_at,
    reaction: r.reaction as Surfacing['reaction'],
    reactedAt: r.reacted_at,
  };
}

export interface EditRow {
  id: string;
  note_id: string;
  target: string;
  before: string | null;
  after: string | null;
  inverse: string | null;
  source: string;
  created_at: number;
}

export function toEdit(r: EditRow): EditRecord & { inverse: string | null } {
  return {
    id: r.id,
    noteId: r.note_id,
    target: r.target,
    before: r.before,
    after: r.after,
    inverse: r.inverse,
    source: r.source as EditRecord['source'],
    createdAt: r.created_at,
  };
}
