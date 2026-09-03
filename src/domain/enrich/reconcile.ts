// Policy layer between the model and ingest(). The model's output is a proposal; the rules below are ours and
// deterministic, so the app behaves the same whichever provider answered (Groq, Gemini, or the heuristic).
// Each rule is an edge case that was observed to go wrong. Keep the numbering in sync with docs/02-AI-LAYER.md.
//
//   E1  gift + person, no occasion, no date            → birthday anchor → ask "Kad je X rođendan?" (unless known)
//   E2  gift + person + anchor already known           → 0 questions, chain
//   E3  gift + person + date in the text               → anchor inferred from the text, 0 questions
//   E4  gift without a person                          → semantic only, no question
//   E5  lowercase relation ("majci", "bratu")          → the person ("Mama", "Brat")
//   E6  relative time in the text ("sljedeći tjedan")  → time trigger, never a question about time
//   E7  bare hour already passed today                 → tomorrow (heuristic)
//   E8  tradesman / service / doctor                   → future_need (+ quiet fallback in ingest), never a question
//   E9  restaurant / café / bakery / place             → fact, no question
//   E10 model asks "when?" while a time exists         → dropped (ingest)
//   E11 model asks a date with nobody to bind          → person derived or question dropped (ingest)
//   E12 text without diacritics                        → same as with (heuristic fold)
//   E13 brands are not people                          → heuristic
//   E14 task verb + time                               → task
//   E15 tradesman written as a contact card            → future_need, not contact

import type { Anchor, EnrichResult, EnrichTrigger, Intent, Language } from '../types';
import { heuristicEnrich, fold, isLikelyPlace, detectLanguage, isMarriageAnniversary, extractExplicitDate, isMemorial, statedOccasionDate } from './heuristic';
import { formatMonthDay } from '../triggers/resolve';
import { MARRIAGE_PERSON } from './ingest';
import { offsetLabel } from '../triggers/resolve';
import { findKnownDate } from './knownDates';
import { parseTemporal, resolveSignal, signalLabel, toLocalIso as toLocalIsoTemporal } from './temporal';
import { startOfDay } from '../dates';

export interface ReconcileContext {
  now: number;
  anchors: Anchor[];
  /** Language for labels this layer writes — the device/UI language. Defaults to the text's own language. */
  uiLang?: Language;
}

const GIFT_MARKERS = /\b(poklon\w*|dar|darovat\w*|rodendan\w*|godisnjic\w*|zeli|svida|fali|voli|gift|present|birthday|anniversary|wants|likes|loves)\b/i; // on fold(text)
const TASK_VERBS = /\b(podsjeti|nazvati|nazovem|nazovi|zovi|kupi|kupiti|kupim|posalji|poslati|platiti|plati|platim|rezerviraj|rezervirati|rezerviram|odnesi|odnijeti|pokupi|javi|uzeti|uzmi|remind|call|buy|send|pay|book|pick up|return|email|text)\b/i;
const SERVICE_CATEGORIES = new Set(['auto_servis', 'zdravlje', 'dom']);
// A service category alone is not enough — "lijek koji mi je pomogao" and "boja zida" hit zdravlje/dom by
// vocabulary but name no provider and recommend nothing. future_need needs an actual referral signal:
// someone/some business named, or words that mark "you'll need this again, from someone".
const REFERRAL_MARKERS =
  /\b(preporuc\w*|preporuca\w*|mehanicar\w*|vodoinstalater\w*|elektricar\w*|zubar\w*|frizer\w*|krojac\w*|racunovod\w*|majstor\w*|servis\w*|popravi\w*|dosao|dosla|radi\s+i|cijena|eur|kn\b|\d+\s?(eur|kn|€))\b/i; // on fold(text)
const PLACE_CATEGORIES = new Set(['restoran']);
const IDEA_CATEGORIES = new Set(['putovanje', 'preporuka']);

function uniq(...lists: Array<string[] | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lists) for (const k of l ?? []) {
    const n = k.trim();
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

/**
 * Merge the model's EnrichResult with what our own rules see in the raw text. Returns a new EnrichResult
 * for ingest(). Never removes the model's triggers; adds what the rules require and corrects the intent
 * only where the text carries an unambiguous signal.
 */
export function reconcile(raw: EnrichResult, rawText: string, ctx: ReconcileContext): EnrichResult {
  const h = heuristicEnrich(rawText, { now: ctx.now, anchors: ctx.anchors });
  const folded = fold(rawText);
  // ── language (E18): every label, question and notification is written in raw.language, so a wrong claim shows up
  //    as "next week" / "3 weeks before" inside a Croatian note. The TEXT decides, not the model.
  const language: Language = detectLanguage(rawText);
  const labelLang: Language = ctx.uiLang ?? language;
  const giftMarker = GIFT_MARKERS.test(folded);
  const taskVerb = TASK_VERBS.test(folded);
  const hTime = h.triggers.find((t) => t.type === 'time');
  const hAnchor = h.triggers.find((t) => t.type === 'anchor');
  const hSemantic = h.triggers.find((t) => t.type === 'semantic');

  // ── people: model first, then relations/names our heuristic saw (E5, E13). Places are never people, whichever
  //    side proposed them ("u Zadru" → Groq happily lists "Zadru" as a person). A wedding anniversary has no
  //    person — the marriage itself is the anchor (E16).
  const rawTokens = rawText.replace(/[.,;:!?()"„”]/g, ' ').split(/\s+/);
  const notAPlace = (name: string) => {
    const idx = rawTokens.findIndex((tok) => fold(tok) === fold(name));
    return !isLikelyPlace(name, idx > 0 ? rawTokens[idx - 1] : undefined);
  };
  // "godišnjica braka" is the explicit form, but a bare "godišnjica" is the SAME occasion in practice — nobody
  // writes "godišnjica" about anything else without saying what of ("godišnjica firme" does name it). Treating the
  // bare word as the marriage is what makes the app ASK for the date instead of guessing a person or a time.
  const marriage = isMarriageAnniversary(folded);
  // "Babi je god" — the anniversary of a death. Its own occasion: an anchor and a question, but never a gift.
  const memorial = isMemorial(folded);
  const people = uniq(raw.entities?.people, h.entities?.people).filter(notAPlace);
  const person = marriage ? MARRIAGE_PERSON : (people[0] ?? null);

  // ── intent (E8, E9, E14, E15, gift markers)
  let intent: Intent = raw.intent;
  const category = raw.category ?? h.category ?? null;
  // A memorial ("babi je god") outranks every other reading, whatever the model proposed. Suggesting a present
  // for someone who has died is the single worst thing this app could output, so it is decided here and not
  // left to the model's mood.
  if (memorial) intent = 'fact';
  else if (giftMarker && person && !(taskVerb && hTime && !/poklon|dar|gift|present/.test(folded))) intent = 'gift';
  else if (
    category &&
    SERVICE_CATEGORIES.has(category) &&
    (intent === 'fact' || intent === 'contact' || intent === 'idea') &&
    !(taskVerb && hTime) &&
    (REFERRAL_MARKERS.test(folded) || person)
  )
    intent = 'future_need';
  // A place is a fact to remember unless there's an actual task verb AND a real time ("rezervirati sutra u 20h" is a
  // task; "rezervirati terasu" with no time is just a note about the place worth remembering).
  else if (category && PLACE_CATEGORIES.has(category) && !(taskVerb && hTime) && (intent === 'task' || intent === 'future_need' || intent === 'contact')) intent = 'fact';
  else if (category && IDEA_CATEGORIES.has(category) && !taskVerb && (intent === 'task' || intent === 'future_need' || intent === 'contact')) intent = 'idea';
  else if (taskVerb && hTime && intent !== 'gift') intent = 'task';

  let triggers: EnrichTrigger[] = [...raw.triggers];

  // ── stated occasion date (E3, E17): "rođendan 10.6", "godišnjica je treći petog". When the text itself dates the
  //    occasion, the model's own guesses are noise — a time trigger on some other day (Groq produced 15.01.2027 for
  //    "treći petog") is a hallucination, and any anchor it named must carry OUR date.
  // The heuristic only builds an anchor when it found a PERSON, so a nameless "rođendan u 8 u petak" arrived
  // here with no stated date at all — and the model's anchor then asked "Kad je rođendan?" with the Friday sitting
  // right there in the text (device, 2026-08-28). The text is the authority whether or not anyone is named.
  const occasionWord = /\brodendan\w*|\bbirthday\b|godisnjic|anniversary/.test(folded);
  const statedFromText = occasionWord ? statedOccasionDate(rawText, ctx.now) : null;
  const statedMonthDay = hAnchor?.anchor_month_day ?? (statedFromText ? formatMonthDay(statedFromText.month, statedFromText.day) : null);
  // Was the date written in the NOTE ("rođendan 10.6", "treći petog"), or did the heuristic look it up in the
  // calendar? Only the former outranks the calendar; the distinction matters because both arrive as an anchor.
  const textStatedDate = extractExplicitDate(rawText) != null;
  if (statedMonthDay) {
    triggers = triggers.filter((t) => {
      if (t.type !== 'time' || !t.iso_datetime) return true;
      const d = new Date(t.iso_datetime);
      const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return md === statedMonthDay;
    });
  }

  // ── marriage anniversary: whatever spouse/place the model guessed as anchor_person, the anchor is the marriage
  if (marriage) for (const t of triggers) if (t.type === 'anchor') t.anchor_person = MARRIAGE_PERSON;

  // ── E21: TIME IS OURS. parseTemporal() is the authority on every date, offset, recurrence and deadline in the
  //    note (54 tests), so the model's own time triggers are discarded rather than merged — a model that
  //    "helpfully" dates a note is the single biggest source of invented reminders. The model is not even asked
  //    for times any more; this also cleans up stale/legacy answers.
  const signals = parseTemporal(rawText, ctx.now);
  const primary = signals[0] ?? null;
  const resolved = primary ? resolveSignal(primary, ctx.now, intent) : null;

  triggers = triggers.filter((t) => t.type !== 'time');
  if (resolved?.fireAt != null) {
    triggers.push({
      type: 'time',
      certainty: resolved.certainty,
      label: signalLabel(primary!, labelLang),
      iso_datetime: toLocalIsoTemporal(resolved.fireAt),
      ...(resolved.recurring ? { recurring: resolved.recurring } : {}),
    } as EnrichTrigger);

    // ── E25: a DEADLINE 3+ days out gets a "dan prije" companion (Marko, 2026-09-01). One reminder on the
    //    last day at 09:00 is often too late to act on — banks and offices keep their own hours. A mirror of
    //    E23's same-day pair, but only for dates with a penalty behind them: the deadline wrapper ("do petka",
    //    "najkasnije 15.9.") or a span said with rok/unutar/within. A plain "za 8 dana kontrola" stays single —
    //    more reminders for every dated note would be noise, not safety (hard rule 6).
    const spanWord = primary!.type === 'relative' && /\b(rok\w{0,2}|unutar|within)\b/.test(fold(primary!.text));
    if ((primary!.type === 'deadline' || spanWord) && !resolved.recurring) {
      const daysAhead = Math.round((startOfDay(resolved.fireAt) - startOfDay(ctx.now)) / 86_400_000);
      if (daysAhead >= 3) {
        const dayBefore = new Date(resolved.fireAt);
        dayBefore.setDate(dayBefore.getDate() - 1); // calendar day, not −24 h — a DST switch must not move the hour
        triggers.push({
          type: 'time',
          certainty: resolved.certainty,
          label: labelLang === 'hr' ? 'dan prije' : 'day before',
          iso_datetime: toLocalIsoTemporal(dayBefore.getTime()),
        });
      }
    }
  } else if (hTime && !primary) {
    // Nothing parsed but the older heuristic saw something — keep it rather than lose a real time.
    triggers.push(hTime);
  }

  // ── E20: an occasion the app can look up (Valentinovo, Dan žena, Božić, Uskrs, …) is never a question.
  //    Birthdays and personal anniversaries stay ask-only — those the app genuinely cannot know.
  //    A date stated in the text still wins: the calendar only fills a gap.
  // The heuristic already resolves a known occasion (so the offline path works), which means `statedMonthDay` may
  // BE that calendar date rather than a date written in the note. Look the occasion up here regardless and let it
  // own the anchor; only a real date in the TEXT (or a marriage anniversary) takes precedence.
  const known = marriage || textStatedDate ? null : findKnownDate(rawText, new Date(ctx.now).getFullYear(), labelLang);

  // ── anchor (E1–E4, E16): an occasion needs an anchor; a stated date rides along.
  //    The gate is the OCCASION, not the intent: "Godišnjica, trebam rezervirati restoran" is a task by intent but
  //    still hangs on a date the app cannot know. Without this it fell through to ingest's quiet ~6-month fallback,
  //    which is exactly the "random za 6 mjeseci" Marko saw instead of a question.
  const hasAnchor = triggers.some((t) => t.type === 'anchor');
  let needs_anchor = raw.needs_anchor ?? null;

  // ── E24: an occasion NOBODY MENTIONED is never asked about (Marko, 2026-09-01).
  //
  // "Piće s Ivanom" was asked "Kad je rođendan?". There is no birthday in that text — the model saw a person's
  // name and reached for the occasion a name usually implies, and we took `needs_anchor` on trust. Answering it
  // would have pinned a birthday onto a note about going for a drink.
  //
  // An anchor question is legitimate only when something in the TEXT implies the occasion:
  //   - the occasion word itself ("rođendan", "godišnjica"), or a memorial/marriage phrase, or
  //   - a gift marker — "Ivan želi bušilicu" implies a birthday without naming one (E1), which is the whole
  //     point of that rule.
  // Our own heuristic already refuses to invent one (its `occasion` gate below needs the same signals), so this
  // only ever strips a model guess. Hard rules 5 and 11.
  const occasionImplied = occasionWord || memorial || marriage || giftMarker || intent === 'gift';
  if (needs_anchor && !occasionImplied) needs_anchor = null;

  if (marriage && needs_anchor) needs_anchor = { ...needs_anchor, person: MARRIAGE_PERSON, kind: 'anniversary' };

  if (known) {
    // The occasion IS the anchor: its "person" is the occasion's name, so two notes about Valentinovo share one.
    needs_anchor = null;
    triggers = triggers.filter((t) => t.type !== 'anchor');
    triggers.push({
      type: 'anchor',
      certainty: 'high',
      label: offsetLabel(-7, labelLang),
      anchor_person: known.key,
      anchor_kind: known.kind,
      anchor_month_day: known.monthDay,
      offset_days: -7,
    });
  }

  // A memorial is an occasion too — it just is not a gift one, and its intent is 'fact', so it has to be named
  // here explicitly or the anchor (and therefore the date question) would be dropped.
  const occasion = !known && (intent === 'gift' || marriage || memorial || /\brodendan\w*|\bbirthday\b/.test(folded));
  if (occasion && person) {
    if (!hasAnchor) {
      const anniversary = !memorial && (marriage || /godisnjic|anniversary/.test(folded));
      const a: EnrichTrigger = hAnchor ?? {
        type: 'anchor',
        certainty: 'medium',
        label: offsetLabel(memorial ? -7 : anniversary ? -14 : -21, labelLang),
        anchor_person: person,
        anchor_kind: memorial ? 'memorial' : anniversary ? 'anniversary' : 'birthday',
        anchor_month_day: statedMonthDay,
        offset_days: memorial ? -7 : anniversary ? -14 : -21,
      };
      triggers.push({ ...a, anchor_person: a.anchor_person ?? person });
      if (!a.anchor_month_day && !needs_anchor)
        needs_anchor = h.needs_anchor ?? { person: a.anchor_person ?? person, kind: a.anchor_kind ?? (memorial ? 'memorial' : anniversary ? 'anniversary' : 'birthday') };
    } else if (statedMonthDay) {
      // model saw the person, we saw the date → E3
      for (const t of triggers) if (t.type === 'anchor' && !t.anchor_month_day) t.anchor_month_day = statedMonthDay;
      needs_anchor = null;
    }
  }

  // ── E3 for the nameless: the block above needs a `person`; "rođendan u 8 u petak" has none, yet the model may
  //    still have sent an anchor (with a guessed person) or a needs_anchor. A date written in the text fills every
  //    anchor that lacks one and settles the question — whoever the occasion belongs to.
  if (statedMonthDay) {
    for (const t of triggers) if (t.type === 'anchor' && !t.anchor_month_day) t.anchor_month_day = statedMonthDay;
    if (needs_anchor) {
      if (!triggers.some((t) => t.type === 'anchor')) {
        triggers.push({
          type: 'anchor',
          certainty: 'medium',
          label: offsetLabel(-21, labelLang),
          anchor_person: needs_anchor.person,
          anchor_kind: needs_anchor.kind,
          anchor_month_day: statedMonthDay,
          offset_days: -21,
        });
      }
      needs_anchor = null;
    }
  }

  // ── E19: an occasion still waiting for its date must not carry an absolute time the model invented. Groq answers
  //    "godišnjica, rezervirati restoran" with a confident date months out; next to the question "Kad je godišnjica
  //    braka?" that date is noise, and it is what the user reads as the app having made something up. A time the
  //    TEXT actually stated survives (hTime) — only the model's own guess goes.
  if (needs_anchor && !statedMonthDay) {
    triggers = triggers.filter((t) => t.type !== 'time' || (hTime != null && t.iso_datetime === hTime.iso_datetime));
  }

  // ── E22: the occasion's own day is BOUND to the anchor, never a free time reminder. "Branki je rođendan u
  //    subotu" produced the chain (−21/−7/−1) on the anchor plus a loose time trigger for Saturday; when the user
  //    moved the birthday, the three followed and the Saturday stayed behind (device, 2026-08-28). As an anchor
  //    trigger with offset 0 ("na dan") it moves with the date like everything else.
  if (statedMonthDay) {
    const anchorT = triggers.find((t) => t.type === 'anchor' && t.anchor_month_day === statedMonthDay);
    const sameDay = (iso: string) => {
      const d = new Date(iso);
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === statedMonthDay;
    };
    if (anchorT && triggers.some((t) => t.type === 'time' && t.iso_datetime && sameDay(t.iso_datetime))) {
      triggers = triggers.filter((t) => !(t.type === 'time' && t.iso_datetime && sameDay(t.iso_datetime)));
      if (!triggers.some((t) => t.type === 'anchor' && t.offset_days === 0)) {
        triggers.push({
          type: 'anchor',
          certainty: 'high',
          label: offsetLabel(0, labelLang),
          anchor_person: anchorT.anchor_person,
          anchor_kind: anchorT.anchor_kind,
          anchor_month_day: statedMonthDay,
          offset_days: 0,
        });
      }
    }
  }

  // ── E23: SAME DAY → exactly two reminders, an hour before and at the moment (Marko, 2026-08-28). A birthday
  //    "večeras u 8" had produced four: −21/−7/−1 rolled into next year and "na dan" sat at the default 09:00,
  //    already past. The chain is for things ahead; for tonight it is noise. Applies to tasks the same way
  //    ("sastanak danas u 15h" → 14:00 and 15:00). The anchor goes too — its day-of reminder cannot carry the
  //    stated hour, and two is the number. (Consequence: a same-day birthday does not create a yearly anchor.)
  const todayRelative = primary?.type === 'relative' && primary.days === 0 && !primary.weeks && !primary.months && !primary.years;
  const sameDay = primary != null && ((resolved?.fireAt != null && startOfDay(resolved.fireAt) === startOfDay(ctx.now)) || todayRelative);
  if (sameDay) {
    let moment: number | null = resolved?.fireAt ?? null;
    if (moment == null || startOfDay(moment) !== startOfDay(ctx.now)) {
      if (primary.type === 'relative' && primary.hour != null) {
        // A STATED hour that has already passed today ("sastanak danas u 15", written at 17:00): the event is over.
        // Nothing to remind, and nothing to invent — an 18:00 that nobody asked for was worse than no reminder.
        moment = null;
      } else {
        // "danas" with no hour, and the default hour has passed (the resolver rolled it to tomorrow): the next full
        // hour today, never after 21:00 — hard rule 6.
        const d = new Date(ctx.now);
        d.setMinutes(0, 0, 0);
        d.setHours(d.getHours() + 1);
        moment = d.getHours() <= 21 ? d.getTime() : null;
      }
    }
    triggers = triggers.filter((t) => t.type !== 'time' && t.type !== 'anchor');
    needs_anchor = null;
    if (moment != null) {
      const hourBefore = moment - 60 * 60 * 1000;
      if (hourBefore > ctx.now) {
        triggers.push({ type: 'time', certainty: 'high', label: labelLang === 'hr' ? 'sat prije' : 'an hour before', iso_datetime: toLocalIsoTemporal(hourBefore) });
      }
      // "u to vrijeme", not "danas": next to a time that is already today, "danas" said nothing (Marko).
      triggers.push({ type: 'time', certainty: 'high', label: labelLang === 'hr' ? 'u to vrijeme' : 'at the time', iso_datetime: toLocalIsoTemporal(moment) });
    }
  }

  // ── semantic: always present, union of everything we and the model saw. The model's entity keywords count
  //    too: in the slim schema they ARE its answer ("servis auta", "klima"), and dropping them would throw away
  //    the one part of the job only a language model can do.
  const sem = triggers.find((t) => t.type === 'semantic');
  const modelKeywords = uniq(raw.entities?.keywords);
  if (!sem && (hSemantic || modelKeywords.length)) {
    triggers.push({
      type: 'semantic',
      certainty: 'high',
      label: hSemantic?.label ?? '',
      keywords: uniq(modelKeywords, hSemantic?.keywords).slice(0, 20),
    });
  } else if (sem) {
    sem.keywords = uniq(sem.keywords, modelKeywords, hSemantic?.keywords).slice(0, 20);
  }

  return {
    ...raw,
    language,
    intent,
    category,
    entities: {
      people,
      orgs: uniq(raw.entities?.orgs),
      places: uniq(raw.entities?.places),
      keywords: uniq(raw.entities?.keywords, h.entities?.keywords).slice(0, 24),
    },
    needs_anchor,
    triggers,
  };
}
