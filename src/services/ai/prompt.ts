// System prompt + responseSchema for enrich. Shared verbatim by the app and p0-harness
// so the harness measures exactly what ships. Pure TS — no RN imports.
//
// ── Division of labour (decided 2026-08-25, after the 120b prompt stalled and the daily token budget ran out)
//
//   text ──parseTemporal (TS)──► TemporalSignal[]     dates, offsets, recurrence, deadlines, defaults, certainty
//        ──LLM──────────────────► intent, category, semantics, anchor person, summary, questions
//        ──reconcile (TS)───────► final truth: our signals OVERRULE the model's
//
// Every rule that can be computed lives in src/domain/enrich/temporal.ts with a test beside it. The model is
// never asked to do arithmetic — it cannot be tested and it hallucinated dates months out. What is left here is
// what only a language model can do: read meaning. That kept the prompt at roughly a third of its old size,
// which matters directly: Groq's free tier bills TOKENS PER DAY, and the full old prompt cost ~2/3 of the
// budget per note. The long-form version of these rules lives in docs/02-AI-LAYER.md as the specification.

import type { Anchor } from '@/domain/types';

export interface PromptContext {
  todayIso: string; // 2026-08-25
  weekday: string; // utorak
  timezone: string;
  anchors: Array<Pick<Anchor, 'person' | 'kind' | 'monthDay'>>;
  prefs: Record<string, string>;
  /**
   * What our own parser already resolved, as short human lines ("sutra 09:00", "rok: 15.09.", "svakih 6 mj.").
   * Present → the model must not produce or alter any time. Absent → there is genuinely no time in the note,
   * and the model still must not invent one.
   */
  temporal?: string[];
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const anchors = JSON.stringify(ctx.anchors.map((a) => ({ person: a.person, kind: a.kind, monthDay: a.monthDay })));
  const prefs = JSON.stringify(ctx.prefs);
  const temporal = ctx.temporal?.length ? ctx.temporal.join(' · ') : 'nema vremenske oznake u tekstu';

  return `Ti si semantic engine za app "Remember This". Korisnik zapiše misao; ti odlučuješ ŠTO ona znači i po čemu će je tražiti za pola godine.

VRIJEME JE VEĆ OBRAĐENO U KODU: ${temporal}
Ne izračunavaj, ne mijenjaj i ne izmišljaj datum, vrijeme ni godinu. Nikad ne postavljaj pitanje o vremenu.
Polje iso_datetime ostavi null — vrijeme postavlja aplikacija.

KONTEKST
Danas: ${ctx.todayIso} (${ctx.weekday}), ${ctx.timezone}
Poznati anchori: ${anchors}
Naučeni defaulti: ${prefs}

1. INTENT — najčešća greška je ovdje
- gift: što netko želi/voli/fali mu, poklon, rođendan, godišnjica. ("Sestri fali ruksak" = gift)
- future_need: osoba ili usluga koja će opet trebati — mehaničar, vodoinstalater, zubar, frizer, krojač,
  računovođa, servis, majstor — i kad je napisana kao činjenica ("Mehaničar Dario popravio klimu za 80€").
  Preporuka majstora s brojem je future_need, ne contact.
- task: nešto što treba NAPRAVITI (nazvati, platiti, kupiti, rezervirati, odnijeti, predati, provjeriti).
- idea: nešto što bi korisnik mogao napraviti ili posjetiti — putovanje, plaža, knjiga, film, ideja, "kad budem u Zagrebu otići u…".
- fact: informacija za kasnije — restoran/kafić/pekara koju vrijedi pamtiti, lozinka, broj police, veličina cipela.
- contact: SAMO kontakt podatak osobe bez usluge.

2. CATEGORY — točno jedan ključ, ništa drugo:
auto_servis | poklon | zdravlje | dom | restoran | putovanje | preporuka | posao | financije | ostalo
Nikad ne spajaj intent i kategoriju ("future_need_mechanic" je greška → auto_servis). Ako ništa ne odgovara → ostalo.

3. SEMANTIC TRIGGER — uvijek barem jedan, i to je najvažniji dio tvog posla.
Ključne riječi kojima bi korisnik za nekoliko mjeseci tražio ovu informaciju: sinonimi, nadpojmovi, kategorija
problema, razlog zbog kojeg je bilješka korisna. Ne prepisuj riječi iz teksta.
"Mehaničar Dario popravio klimu" → mehaničar, servis auta, auto, kvar, popravak, klima
"Konoba Mare ima odličan brudet" → restoran, konoba, brudet, hrana, večera
Zabranjene jer su beskorisne: "bilješka", "informacija", "stvari", "podatak".

4. ANCHOR — osobni datum koji app ne može znati
Rođendan ili osobna godišnjica: ispuni anchor_person + anchor_kind i needs_anchor ako osoba nije u ANCHORS.
NIKAD ne izmišljaj datum. Ako je osoba u ANCHORS → needs_anchor null, bez pitanja.
Relacije su osobe: "bratu" → Brat, "mami" → Mama, "tati" → Tata, "sestri" → Sestra, "baki" → Baka.
Brendovi i proizvodi nisu osobe (Nikon, Dyson, Zara). Mjesta nisu osobe ("u Zadru").
"Godišnjica" bez objašnjenja = godišnjica braka; ne izmišljaj supružnika ni mjesto.
Javni i crkveni datumi (Valentinovo, Dan žena, Božić, Uskrs, Svi sveti) NISU osobni anchori — app ih zna sam,
ostavi needs_anchor null i ne pitaj.

5. PITANJA — najviše 2, i samo ono što je stvarno nemoguće izvesti
Svako pitanje ima 2–4 kratke tap-opcije; iznimka je kind "date" (koristi se date picker, bez opcija).
Nikad ne pitaj: vrijeme, sat, "kada ti odgovara", lead time ("koliko unaprijed") — to dolazi iz PREFS ili defaulta.
Nikad ne pitaj TKO je osoba ("čiji je rođendan", "za koga") — ime nije potrebno za podsjetnik.
Ne pitaj podatak koji nije nužan za okidač (adresa, cijena, "kad ćeš opet ići").
"Ana želi Dyson fen za rođendan" → 1 date pitanje ako Ana nije u ANCHORS, inače 0.

6. SUMMARY — naslov, najviše 8 riječi, treće lice, ne kopija teksta.
"Ana: Dyson fen za rođendan", "Auto X · servis auta", "Nazvati Marka".
NIKAD ne sklanjaj ime: piši "rođendan — Ana", nikako "Anin rođendan" ni "Martiov rođendan".

7. JEZIK izlaza = jezik bilješke. Dijakritika nije bitna: "rodendan" = "rođendan".

8. NE IZMIŠLJAJ ništa čega nema u tekstu ili u ANCHORS — ni datum, ni osobu, ni mjesto, ni događaj.
Bolje bez podatka nego izmišljen podatak.`;
}

// Gemini responseSchema is a JSON Schema subset. No anyOf/oneOf → flat nullable payload fields.
export const enrichSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    language: { type: 'string', enum: ['hr', 'en'] },
    category: { type: 'string' },
    intent: { type: 'string', enum: ['future_need', 'task', 'fact', 'idea', 'gift', 'contact'] },
    confidence: { type: 'number' },
    entities: {
      type: 'object',
      properties: {
        people: { type: 'array', items: { type: 'string' } },
        orgs: { type: 'array', items: { type: 'string' } },
        places: { type: 'array', items: { type: 'string' } },
        keywords: { type: 'array', items: { type: 'string' } },
      },
    },
    needs_anchor: {
      type: 'object',
      nullable: true,
      properties: {
        person: { type: 'string' },
        kind: { type: 'string', enum: ['birthday', 'anniversary', 'annual', 'oneoff'] },
      },
    },
    // Semantic keywords only — every time/date trigger now comes from parseTemporal(), so the model is not
    // asked for iso_datetime, offsets or recurrence at all. Fewer fields = fewer output tokens, lower latency,
    // and nothing left to hallucinate. normalize() maps this back onto the internal EnrichTrigger shape.
    keywords: { type: 'array', items: { type: 'string' }, description: 'Ključne riječi za pretragu za 6 mjeseci' },
    anchor: {
      type: 'object',
      nullable: true,
      description: 'Osobni datum (rođendan/godišnjica) na koji se bilješka veže. Datum NE ispunjavaj.',
      properties: {
        person: { type: 'string' },
        kind: { type: 'string', enum: ['birthday', 'anniversary'] },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          kind: { type: 'string', enum: ['options', 'date'] },
          options: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'text', 'kind'],
      },
    },
  },
  required: ['summary', 'language', 'intent', 'keywords', 'questions'],
  propertyOrdering: ['summary', 'language', 'category', 'intent', 'keywords', 'entities', 'anchor', 'needs_anchor', 'questions'],
} as const;

export function buildEnrichBody(rawText: string, ctx: PromptContext) {
  return {
    contents: [{ role: 'user', parts: [{ text: rawText }] }],
    systemInstruction: { parts: [{ text: buildSystemPrompt(ctx) }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: enrichSchema,
      // Gemini 3.x is trained to reason AT temperature 1 — Google's own guidance is that lowering it degrades
      // reasoning quality rather than making the model more careful (the intuition from older models, that low
      // temperature = more deterministic extraction, does not carry over). It costs nothing extra: the quota is
      // requests and tokens, not sampling. Determinism where it matters comes from the schema and reconcile(),
      // not from the sampler. Groq's gpt-oss is a different family and keeps its own value in the worker.
      temperature: 1,
      // Extraction into a fixed schema needs no "thinking"; a budget of 0 is faster and cheaper,
      // and maxOutputTokens then measures the answer itself (newer models spend budget on thinking first).
      maxOutputTokens: 1200,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
}

export const EMBED_MODEL = 'gemini-embedding-001';
export const EMBED_DIM = 768;

export function buildEmbedBody(text: string, taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY') {
  return {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: EMBED_DIM,
  };
}

/** Pull the JSON text out of a Gemini generateContent response. */
export function extractJsonText(resp: unknown): string {
  const r = resp as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = r.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('empty model response');
  return text;
}

export function extractEmbedding(resp: unknown): number[] {
  const r = resp as { embedding?: { values?: number[] } };
  const v = r.embedding?.values;
  if (!v || v.length === 0) throw new Error('empty embedding');
  return v;
}
