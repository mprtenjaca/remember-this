// Post-processing of an EnrichResult (LLM or heuristic). The model's output is a
// proposal, not truth — this is where hard rules are enforced.

import type { Clock } from '../clock';
import { DAY_MS } from '../clock';
import type {
  Anchor,
  AnchorKind,
  AnchorPayload,
  EnrichQuestion,
  EnrichResult,
  EnrichTrigger,
  Intent,
  Language,
  Trigger,
  TriggerDraft,
} from '../types';
import { CERTAINTY_VALUE } from '../types';
import { DEFAULT_ANCHOR_TIME, DEFAULT_CHAINS, offsetLabel, parseMonthDay, resolveAnchorTrigger, resolveTimeTrigger } from '../triggers/resolve';
import { anchorQuestionFor, kindNoun, MARRIAGE_PERSON } from './labels';

// Re-exported so existing callers keep one import site for naming helpers.
export { MARRIAGE_PERSON, kindNoun, anchorLabelFor } from './labels';

export interface IngestContext {
  existingTriggers: Trigger[];
  anchors: Anchor[];
  prefs: Record<string, string>;
  clock: Clock;
  /**
   * Language for LABELS and QUESTIONS — i.e. the device/UI language. A Croatian phone must never show
   * "next Friday" inside a Croatian note, whatever language the note itself is in. Defaults to the note's
   * language so the domain tests and the harness keep working without a UI.
   */
  uiLang?: Language;
}

export interface IngestOutput {
  summary: string;
  language: Language;
  category: string | null;
  intent: Intent;
  confidence: number;
  keywords: string[];
  people: string[];
  drafts: TriggerDraft[];
  /** Enrich-owned triggers superseded by this run (never user-edited ones). */
  removeTriggerIds: string[];
  needsAnchor: { person: string; kind: AnchorKind } | null;
  /** The note itself stated the date → create this anchor (no question) and bind the pending drafts to it. */
  inferredAnchor: { person: string; kind: AnchorKind; monthDay: string } | null;
  questions: EnrichQuestion[];
  status: 'enriched' | 'needs_input';
}

const MAX_LOW_CERTAINTY = 2;
const MAX_QUESTIONS = 2;
const LEAD_TIME_QUESTION = /koliko\s+(dana|tjedana|unaprijed|prije)|lead\s*time|how\s+(early|far|long)\s+(before|in advance)|unaprijed/i;
const WHEN_QUESTION = /\b(kad|kada|when|koji\s+dan|which\s+day|u\s+koliko|what\s+time|koje\s+vrijeme|koji\s+datum|what\s+date)\b/i;
// Marko, 2026-08-28: the app never asks WHO a person is. An options answer becomes a keyword and moves no
// reminder, so "Čiji je rođendan?" was a tap with no effect — and the day-of reminder never needed the name.
// No `\b` here: it is an ASCII boundary, so `\bčiji` never matches (č is not \w). Explicit edges instead.
const WHO_QUESTION = /(?:^|[^\p{L}])(čiji|čija|čije|ciji|cija|cije|za\s+koga|kome|komu|tko|who|whose|for\s+whom)(?![\p{L}])/iu;

const FALLBACK_MONTHS: Record<string, number> = {
  auto_servis: 6,
  zdravlje: 6,
  frizer: 2,
  default: 6,
};

/**
 * Categories whose fallback interval is a real rhythm rather than a guess. A car service or a haircut comes
 * round on a cycle, so ~6 / ~2 months is a reasonable assumption and asking would be nagging (hard rule 5:
 * only ask what cannot be derived).
 *
 * Everything else — a one-off eye examination, an unclassified errand — has no cycle at all: it might be next
 * month or in two years, and "~6 months" is not an assumption but a coin toss. Those offer a one-tap
 * correction instead of guessing silently.
 */
const RHYTHMIC_CATEGORIES = new Set(['auto_servis', 'frizer']);

/**
 * Wording that turns a health note into a recurring visit, which DOES have a rhythm.
 *
 * Only words the USER would write. Practitioner names ("zubar", "dentist") are deliberately absent: the
 * heuristic seeds the category's own keywords into its output, so matching on them fired for every health
 * note — including "veliki pregled kod oftalmologa", which is exactly the case that must ask.
 */
const ROUTINE_HEALTH = /\b(kontrol\w*|redovn\w*|godisnj\w*|sistematsk\w*|ponovit\w*|ponovn\w*|check-?up|routine|annual)\b/i;

/** Offered intervals, in months. Three taps that cover almost every real answer. */
const INTERVAL_CHOICES = [3, 6, 12] as const;

/** Does this fallback deserve a question, or is the guess good enough to stay silent? */
export function fallbackNeedsAsking(category: string | null, text: string): boolean {
  if (category && RHYTHMIC_CATEGORIES.has(category)) return false;
  // "kontrola kod zubara" is a recurring appointment; "veliki pregled kod oftalmologa" is not.
  if (category === 'zdravlje' && ROUTINE_HEALTH.test(text)) return false;
  return true;
}

function intervalLabel(months: number, lang: string): string {
  if (lang === 'en') return months === 12 ? 'in a year' : `in ${months} months`;
  if (months === 12) return 'za godinu';
  return `za ${months} mj`;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * A stored anchor for this occasion, but ONLY for occasions that are the same day for everybody.
 *
 * Personal dates are deliberately never recalled by name (Marko, 2026-08-25): the Marta in this note need not
 * be the Marta in the last one, and quietly attaching her birthday to a different person produces a confidently
 * wrong reminder. Asking costs a tap; guessing costs trust. Public/church dates (Božić, Uskrs, Valentinovo) are
 * the exception — those really are shared, so they are recalled and never asked.
 *
 * A date written in the note itself is unaffected: that is this note speaking, not a memory.
 */
export function findAnchor(anchors: Anchor[], person: string, kind: AnchorKind): Anchor | undefined {
  if (!isOfficialAnchor(person, kind)) return undefined;
  const p = norm(person);
  return anchors.find((a) => a.person && norm(a.person) === p && a.kind === kind);
}

/** Official = a fixed public/church occasion, stored with kind 'annual' by knownDates. Never a person. */
export function isOfficialAnchor(person: string, kind: AnchorKind): boolean {
  return kind === 'annual' && person !== MARRIAGE_PERSON;
}

function anchorTime(prefs: Record<string, string>): AnchorPayload {
  const h = Number(prefs['hour.default']);
  return Number.isFinite(h) && h >= 0 && h < 24 ? { hour: h, minute: 0 } : DEFAULT_ANCHOR_TIME;
}

/** Anniversaries / annual / one-off dates have their own rhythm; the gift chain (−21/−7/−1) is for birthdays. */
function defaultChain(intent: Intent, kind: AnchorKind): number[] {
  if (kind !== 'birthday' && DEFAULT_CHAINS[kind]) return [...DEFAULT_CHAINS[kind]!];
  return [...(DEFAULT_CHAINS[intent] ?? DEFAULT_CHAINS[kind] ?? DEFAULT_CHAINS.oneoff!)];
}

/** Learned lead time (prefs 'lead_time.<intent>') replaces the chain's first step. Never asked. */
function learnedLead(prefs: Record<string, string>, intent: Intent): number | null {
  const learned = Number(prefs[`lead_time.${intent}`]);
  return Number.isFinite(learned) && learned < 0 ? learned : null;
}

function leadTime(prefs: Record<string, string>, intent: Intent, kind: AnchorKind): number[] {
  const chain = defaultChain(intent, kind);
  const learned = learnedLead(prefs, intent);
  if (learned != null) chain[0] = learned;
  return chain;
}

function uniqKeywords(...lists: Array<string[] | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lists) {
    for (const k of l ?? []) {
      const n = norm(k);
      if (n.length < 2 || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

export function ingest(raw: EnrichResult, ctx: IngestContext): IngestOutput {
  const now = ctx.clock.now();
  const noteLang: Language = raw.language === 'en' ? 'en' : 'hr';
  // Labels and questions are UI copy → device language. The note's own language is still returned below.
  const lang: Language = ctx.uiLang ?? noteLang;
  const at = anchorTime(ctx.prefs);

  const locked = ctx.existingTriggers.filter((t) => t.userEdited);
  const lockedTypes = new Set(locked.map((t) => t.type));
  const removeTriggerIds = ctx.existingTriggers.filter((t) => !t.userEdited).map((t) => t.id);

  // 1. certainty filter — keep at most 2 'low'
  let lowSeen = 0;
  const proposed: EnrichTrigger[] = (raw.triggers ?? []).filter((t) => {
    if (t.certainty !== 'low') return true;
    return ++lowSeen <= MAX_LOW_CERTAINTY;
  });

  const drafts: TriggerDraft[] = [];
  let needsAnchor: { person: string; kind: AnchorKind } | null = null;
  let inferredAnchor: IngestOutput['inferredAnchor'] = null;
  const anchorOffsetsSeen = new Set<number>();
  let anchorRef: { anchor: Anchor | undefined; person: string; kind: AnchorKind } | null = null;

  for (const t of proposed) {
    if (lockedTypes.has(t.type)) continue; // ⚠ user_edited = 1 is sacred
    const certainty = CERTAINTY_VALUE[t.certainty] ?? 0.5;

    switch (t.type) {
      case 'semantic': {
        const keywords = uniqKeywords(t.keywords);
        if (keywords.length === 0) break;
        drafts.push({ type: 'semantic', payload: { keywords }, label: t.label, certainty });
        break;
      }
      case 'time': {
        if (!t.iso_datetime) break;
        let fireAt = resolveTimeTrigger({ iso: t.iso_datetime }, ctx.clock);
        if (fireAt == null) {
          // 4. past date → next year if that lands in the future, else drop
          const d = new Date(t.iso_datetime);
          if (Number.isNaN(d.getTime())) break;
          d.setFullYear(d.getFullYear() + 1);
          if (d.getTime() <= now) break;
          fireAt = d.getTime();
        }
        drafts.push({ type: 'time', payload: { iso: t.iso_datetime }, label: t.label, certainty, fireAt });
        break;
      }
      case 'anchor': {
        const person = t.anchor_person ?? raw.needs_anchor?.person;
        const kind: AnchorKind = t.anchor_kind ?? raw.needs_anchor?.kind ?? 'birthday';
        if (!person) break;
        let offset = t.offset_days ?? defaultChain(raw.intent, kind)[0]!;
        const learned = learnedLead(ctx.prefs, raw.intent);
        if (learned != null && offset === defaultChain(raw.intent, kind)[0]) offset = learned;
        if (anchorOffsetsSeen.has(offset)) break;
        anchorOffsetsSeen.add(offset);
        const anchor = findAnchor(ctx.anchors, person, kind);
        anchorRef = { anchor, person, kind };
        if (anchor) {
          const fireAt = resolveAnchorTrigger(anchor, offset, at, ctx.clock);
          drafts.push({ type: 'anchor', payload: at, label: t.label || offsetLabel(offset, lang), certainty, anchorId: anchor.id, offsetDays: offset, fireAt });
        } else {
          // Date stated in the note itself → no question; the caller creates the anchor and binds these drafts.
          const stated = t.anchor_month_day && parseMonthDay(t.anchor_month_day) ? t.anchor_month_day : null;
          if (stated) inferredAnchor = { person, kind, monthDay: stated };
          else needsAnchor = { person, kind };
          drafts.push({
            type: 'anchor',
            payload: { ...at, person, kind },
            label: t.label || offsetLabel(offset, lang),
            certainty,
            anchorId: null,
            offsetDays: offset,
            fireAt: null,
          });
        }
        break;
      }
      case 'person': {
        if (!t.person) break;
        drafts.push({ type: 'person', payload: { person: t.person }, label: t.label, certainty });
        break;
      }
      case 'location': {
        // 3. place_query is NOT a coordinate — needs geocoding (M5). Keep the intent as keywords.
        break;
      }
    }
  }

  // 6. needs_anchor from the model even without an anchor trigger → build the chain
  if (raw.needs_anchor && !anchorRef && !inferredAnchor && !lockedTypes.has('anchor')) {
    const { person, kind } = raw.needs_anchor;
    const anchor = findAnchor(ctx.anchors, person, kind);
    anchorRef = { anchor, person, kind };
    if (!anchor) needsAnchor = { person, kind };
  }

  // A date question without any anchor reference (Groq often asks "Kad je Martin rođendan?" but emits no anchor
  // trigger and no needs_anchor). Derive the person from entities so the answer has something to bind to;
  // with nobody to attach it to, the question is unanswerable and gets dropped below.
  const dateQuestion = (raw.questions ?? []).find((q) => q.kind === 'date');
  if (dateQuestion && !anchorRef && !inferredAnchor && !lockedTypes.has('anchor')) {
    const person = raw.needs_anchor?.person ?? raw.entities?.people?.[0] ?? null;
    if (person) {
      const kind: AnchorKind = raw.needs_anchor?.kind ?? (/godišnjic|godisnjic|anniversary/i.test(dateQuestion.text) ? 'anniversary' : 'birthday');
      const anchor = findAnchor(ctx.anchors, person, kind);
      anchorRef = { anchor, person, kind };
      if (!anchor) needsAnchor = { person, kind };
    }
  }

  // default chain fill: if we have an anchor reference but < 2 anchor triggers
  if (anchorRef && !lockedTypes.has('anchor')) {
    const { anchor, person, kind } = anchorRef;
    const chain = leadTime(ctx.prefs, raw.intent, kind);
    for (const offset of chain) {
      if (anchorOffsetsSeen.has(offset)) continue;
      anchorOffsetsSeen.add(offset);
      const fireAt = anchor ? resolveAnchorTrigger(anchor, offset, at, ctx.clock) : null;
      drafts.push({
        type: 'anchor',
        payload: anchor ? at : { ...at, person, kind },
        label: offsetLabel(offset, lang),
        certainty: 0.6,
        anchorId: anchor?.id ?? null,
        offsetDays: offset,
        fireAt,
      });
    }
  }

  // Rule 1: always at least one semantic trigger
  const keywords = uniqKeywords(raw.entities?.keywords, raw.entities?.people, raw.entities?.orgs, raw.entities?.places);
  if (!drafts.some((d) => d.type === 'semantic') && !lockedTypes.has('semantic')) {
    const kw = keywords.length ? keywords : uniqKeywords(raw.summary.split(/\s+/));
    if (kw.length) drafts.push({ type: 'semantic', payload: { keywords: kw }, label: lang === 'hr' ? 'kad tražiš' : 'when you search', certainty: 0.7 });
  }

  let fallbackQuestion: EnrichQuestion | null = null;

  // Rule 5: future_need without any time → quiet low-certainty fallback.
  // Never when an anchor is still waiting for its date: the note hangs on a real occasion the user is about to
  // supply, and a "~6 months from now" guess next to that question is exactly the invented date Marko saw.
  if (raw.intent === 'future_need' && !needsAnchor && !drafts.some((d) => d.type === 'time' || d.type === 'anchor') && !lockedTypes.has('time')) {
    const months = FALLBACK_MONTHS[raw.category ?? 'default'] ?? FALLBACK_MONTHS.default!;
    const d = new Date(now + months * 30 * DAY_MS);
    d.setHours(at.hour, at.minute, 0, 0);
    drafts.push({
      type: 'time',
      payload: { iso: localIso(d) },
      label: lang === 'hr' ? `za ~${months} mjeseci` : `in ~${months} months`,
      certainty: CERTAINTY_VALUE.low,
      fireAt: d.getTime(),
    });
    // The guess is WRITTEN either way — the question only offers to correct it. Skipping it must never leave
    // a note that looks filed with nothing scheduled, which is this project's characteristic failure.
    // Summary + keywords rather than a new context field: "kontrola" survives into both, and threading the
    // raw text through would touch every caller and test for one regex.
    if (fallbackNeedsAsking(raw.category ?? null, [raw.summary, ...keywords].join(' '))) {
      fallbackQuestion = {
        id: 'fallback_interval',
        kind: 'interval',
        text: lang === 'hr' ? `Pogodio sam ~${months} mjeseci. Kad da te podsjetim?` : `I guessed ~${months} months. When should I remind you?`,
        options: INTERVAL_CHOICES.map((m) => intervalLabel(m, lang)),
        optionMonths: [...INTERVAL_CHOICES],
      };
    }
  }

  // Questions: never ask lead time; never ask "when" once a real time exists; drop the anchor question if the
  // anchor is known or nobody to attach it to; max 2
  const hasRealTime = drafts.some((d) => (d.type === 'time' && d.certainty >= 0.6) || (d.type === 'anchor' && d.anchorId));
  const questions = (raw.questions ?? [])
    .filter((q) => !LEAD_TIME_QUESTION.test(q.text))
    .filter((q) => !WHO_QUESTION.test(q.text))
    .filter((q) => !(q.kind === 'options' && hasRealTime && WHEN_QUESTION.test(q.text)))
    .filter((q) => !(q.kind === 'date' && (anchorRef?.anchor || inferredAnchor || !needsAnchor)))
    .filter((q) => q.kind === 'date' || (q.options?.length ?? 0) >= 2)
    .map((q) => (q.kind === 'date' && needsAnchor ? { ...q, person: needsAnchor.person, anchorKind: needsAnchor.kind } : q))
    // A date question with nobody attached is unanswerable: the clarify card has no anchor to bind the picked date
    // to, so tapping "Odaberi datum" could only dismiss the card. Drop it rather than show a dead end.
    .filter((q) => q.kind !== 'date' || !!q.person)
    .slice(0, MAX_QUESTIONS);

  // Last, and only if there is room: a correction offer must never crowd out a question the app genuinely
  // cannot answer itself (hard rule 4 caps this at two).
  if (fallbackQuestion && !needsAnchor && questions.length < MAX_QUESTIONS) questions.push(fallbackQuestion);

  if (needsAnchor && !questions.some((q) => q.kind === 'date')) {
    questions.unshift({
      id: 'anchor_date',
      kind: 'date',
      person: needsAnchor.person,
      anchorKind: needsAnchor.kind,
      text: anchorQuestion(needsAnchor.person, needsAnchor.kind, lang),
    });
  } else if (needsAnchor) {
    // The model's own date question may name a place or a spouse it guessed — ours is deterministic.
    for (const q of questions) if (q.kind === 'date') q.text = anchorQuestion(needsAnchor.person, needsAnchor.kind, lang);
  }

  return {
    summary: clampSummary(raw.summary),
    language: noteLang,
    category: raw.category ?? null,
    intent: raw.intent,
    confidence: raw.confidence,
    keywords,
    people: uniqKeywords(raw.entities?.people),
    drafts,
    removeTriggerIds,
    needsAnchor,
    inferredAnchor,
    questions: questions.slice(0, MAX_QUESTIONS),
    status: needsAnchor || questions.length ? 'needs_input' : 'enriched',
  };
}

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

export function clampSummary(s: string, maxWords = 8): string {
  const words = s.trim().replace(/\s+/g, ' ').split(' ');
  return words.slice(0, maxWords).join(' ');
}


/**
 * The one place the date question is worded. Croatian never inflects the name — it asks "Kad je rođendan?" with no name at all —
 * because approximating the possessive produced "Martiov rođendan" on the device (and would produce "Lukin",
 * "Nikolin"). See src/domain/enrich/labels.ts for the decision.
 */
export function anchorQuestion(person: string, kind: AnchorKind, lang: Language): string {
  return anchorQuestionFor(person, kind, lang);
}

