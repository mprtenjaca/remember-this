// Local rule-based enricher. Used when the AI proxy is unreachable or not configured,
// so the app is alive in Expo Go with zero network. Produces the SAME EnrichResult shape
// the LLM does, so ingest() handles both identically. Deliberately conservative: it
// never invents dates and asks at most one question (a birthday it cannot know).

import type { Anchor, AnchorKind, EnrichResult, EnrichTrigger, Intent, Language } from '../types';
import { findAnchor, MARRIAGE_PERSON } from './ingest';
import { formatMonthDay } from '../triggers/resolve';
import { findKnownDate } from './knownDates';
import { looksLikeIdentifier, parseTemporal, resolveSignal } from './temporal';
import { offsetLabel } from '../triggers/resolve';

export interface HeuristicContext {
  now: number;
  anchors: Anchor[];
}

const HR_HINTS = /\b(podsjeti|zapamti|želi|zeli|treba|sutra|danas|preporuč|rođendan|rodjendan|nazvati|nazovi|kupiti|kupi|servis|za|mi|je|da|na|se|sat|sati)\b|[čćžšđ]/i;
const EN_HINTS = /\b(remind|remember|wants|needs|tomorrow|today|recommend(ed)?|birthday|call|buy|the|to|me|for|at|on|in)\b/i;

export function detectLanguage(text: string): Language {
  const hr = (text.match(HR_HINTS) ?? []).length + (text.match(/[čćžšđ]/gi) ?? []).length * 2;
  const en = (text.match(EN_HINTS) ?? []).length;
  return en > hr ? 'en' : 'hr';
}

const STOP = new Set(
  (
    'i u na za da se je su sam si smo ste mi me ti ga ju ih im mu joj ovo ono to taj ta te tu tamo ovdje kad kada gdje što sto koji koja koje ali ili pa ni niti ne od do iz s sa o po pri kroz prema bez nego jer ako kako još jos već vec vrlo jako samo bi bih bilo bio bila biti će ce ću cu ćeš ces ima imam imaš imas nema treba trebam mogu možeš mozes hoću hocu podsjeti podsjetnik zapamti zabilježi zabiljezi sutra danas prekosutra ' +
    'a an the to of in on at for from by with about as is are was were be been being this that these those it its i me my we our you your he she they them his her their and or but not no yes so if then than too very just can could should would will remind remember want wants need needs said told'
  ).split(/\s+/),
);

const CATEGORY_SYNONYMS: Record<string, { match: RegExp; keywords: string[]; intent: Intent; category: string }> = {
  auto_servis: {
    // German-derived garage vocabulary is what people actually say — "šoferšajba", "auspuh", "kvačilo",
    // "felge". Getting the category right matters: it picks the ~6-month fallback for future_need.
    match:
      /\b(servis\w*|mehaničar\w*|mehanicar\w*|auto|automobil\w*|kvar\w*|gum[ae]\w*|registracij\w*|vulkanizer\w*|auspuh\w*|kvačil\w*|kvacil\w*|šoferšajb\w*|sofersajb\w*|mjenjač\w*|mjenjac\w*|kočnic\w*|kocnic\w*|amortizer\w*|akumulator\w*|alternator\w*|remen\w*|filter\w*|filtr\w*|ulj[ae]\w*|branik\w*|karoserij\w*|lakiranj\w*|farbanj\w*|limarij\w*|balansiranj\w*|centriranj\w*|tehnički|tehnicki|felg\w*|mechanic|car|garage|tires?|service)\b/i,
    keywords: ['servis', 'mehaničar', 'auto', 'kvar', 'popravak', 'mechanic', 'car service'],
    intent: 'future_need',
    category: 'auto_servis',
  },
  zdravlje: {
    // Stems end in \w* because Croatian inflects: \b(zubar)\b never matches "zubara", which is how people
    // actually write it ("naručiti se kod zubara"). Same for every category below.
    match: /\b(zubar\w*|doktor\w*|liječnik\w*|lijecnik\w*|pregled\w*|fizio\w*|ortoped\w*|dermatolog\w*|dentist\w*|doctor|checkup|physio)\b/i,
    keywords: ['zubar', 'doktor', 'liječnik', 'pregled', 'zdravlje', 'dentist', 'doctor', 'health'],
    intent: 'future_need',
    category: 'zdravlje',
  },
  dom: {
    match:
      /\b(majstor\w*|vodoinstalater\w*|električar\w*|elektricar\w*|stolar\w*|keramičar\w*|keramicar\w*|soboslikar\w*|klima|zidar\w*|tesar\w*|parketar\w*|staklar\w*|dimnjačar\w*|dimnjacar\w*|bojler\w*|kotao|radijator\w*|cijev\w*|slavin\w*|šterik\w*|sterik\w*|rolet\w*|grijanj\w*|instalacij\w*|terac\w*|fasad\w*|plumber|electrician|handyman|carpenter)\b/i,
    keywords: ['majstor', 'popravak', 'stan', 'kuća', 'vodoinstalater', 'električar', 'plumber', 'electrician', 'handyman'],
    intent: 'future_need',
    category: 'dom',
  },
  poklon: {
    match: /\b(poklon|poklonit\w*|dar|darovat\w*|rođendan|rodjendan|rodendan|godišnjic\w*|godisnjic\w*|želi|zeli|sviđa|svida|fali|voli|gift|present|birthday|anniversary|wants|likes|loves|needs)\b/i,
    keywords: ['poklon', 'dar', 'rođendan', 'što kupiti', 'gift', 'present', 'birthday'],
    intent: 'gift',
    category: 'poklon',
  },
  restoran: {
    match: /\b(restoran|konoba|kafić|kafic|bistro|pizzeri|restaurant|cafe|bar)\b/i,
    keywords: ['restoran', 'gdje jesti', 'hrana', 'večera', 'restaurant', 'food', 'dinner'],
    intent: 'fact',
    category: 'restoran',
  },
  putovanje: {
    match: /\b(putovanj|hotel|apartman|let|avion|plaža|plaza|otok|trip|travel|flight|beach|island)\b/i,
    keywords: ['putovanje', 'hotel', 'odmor', 'ljeto', 'travel', 'trip', 'vacation'],
    intent: 'idea',
    category: 'putovanje',
  },
  knjiga_film: {
    match: /\b(knjig|film|serij|podcast|album|book|movie|series|show)\b/i,
    keywords: ['knjiga', 'film', 'preporuka', 'što gledati', 'što čitati', 'book', 'movie', 'recommendation'],
    intent: 'idea',
    category: 'preporuka',
  },
};

// Kept in step with the same list in reconcile.ts — "uzeti"/"uzmi"/"odnijeti" were missing here, which let
// "Uzeti" pass as a first-word name in "Uzeti majci poklon".
const TASK_VERBS =
  /\b(podsjeti|nazvati|nazovi|zovi|kupi|kupiti|pošalji|poslati|platiti|plati|rezerviraj|rezervirati|odnesi|odnijeti|pokupi|javi|javiti|uzeti|uzmi|provjeriti|provjeri|predati|predaj|dogovoriti|dogovori|prijaviti|prijavi|remind|call|buy|send|pay|book|pick up|return|email|text|check)\b/i;
const IDEA_HINTS = /\b(ideja|idea|možda|mozda|maybe|htio bih|htjela bih|would like|someday|jednom)\b/i;
const RECOMMEND = /\b(preporuč|preporuka|recommend|hvali|kaže da je dobar|kaze da je dobar|said .* is good)\b/i;

interface TimeHit {
  iso: string;
  certainty: 'medium' | 'high';
  label: string;
}

// Ikavica included — see the same list in temporal.ts. "u sridu" is what people actually say.
const HR_WEEKDAYS = ['nedjelj|nedilj|nedij', 'ponedjelj|ponedilj', 'utorak|utork', 'srijed|srid|sred', 'četvrt|cetvrt|cetrt', 'pet', 'subot'];
const EN_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/** Extract an explicit time expression. Returns null rather than guessing. */
export function extractTime(text: string, now: number, lang: Language): TimeHit | null {
  const t = text.toLowerCase();
  const base = new Date(now);
  let day: Date | null = null;
  let dayLabel = '';
  let hour: number | null = null;
  let minute = 0;

  // hour: "u 15h", "u 15:30", "u 15 sati", "at 3pm", "at 15:00", "at 9"
  const h1 = /\b(?:u|at|@)\s*(\d{1,2})(?::(\d{2}))?\s*(h|sati|sat|am|pm)?\b/i.exec(t);
  if (h1) {
    let h = Number(h1[1]);
    const suffix = h1[3]?.toLowerCase();
    if (suffix === 'pm' && h < 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && (suffix || h1[2] || lang === 'hr')) {
      hour = h;
      minute = Number(h1[2] ?? 0);
    }
  }

  // relative day
  if (/\b(prekosutra|day after tomorrow)\b/.test(t)) {
    day = new Date(base);
    day.setDate(day.getDate() + 2);
    dayLabel = lang === 'hr' ? 'prekosutra' : 'day after tomorrow';
  } else if (/\b(sutra|tomorrow)\b/.test(t)) {
    day = new Date(base);
    day.setDate(day.getDate() + 1);
    dayLabel = lang === 'hr' ? 'sutra' : 'tomorrow';
  } else if (/\b(danas|today|tonight|večeras|veceras)\b/.test(t)) {
    day = new Date(base);
    dayLabel = lang === 'hr' ? 'danas' : 'today';
  }

  // "kraj(em) tjedna" = this Friday 15:00; "kraj(em) sljedećeg tjedna" = next Friday 15:00; "kraj(em) mjeseca" = last day, 10:00
  const endOfNextWeek = /\b(kraj|krajem)\s+(sljedećeg|sljedeceg|idućeg|iduceg)\s+tjedna\b/i.test(t);
  const endOfWeek = !endOfNextWeek && /\b(kraj|krajem)\s+(ovog\s+)?tjedna\b/i.test(t);
  const endOfMonth = /\b(kraj|krajem)\s+(ovog\s+|sljedećeg\s+|sljedeceg\s+)?mjeseca\b/i.test(t);
  const endOfNextMonth = /\b(kraj|krajem)\s+(sljedećeg|sljedeceg|idućeg|iduceg)\s+mjeseca\b/i.test(t);
  if (!day && (endOfWeek || endOfNextWeek)) {
    day = new Date(base);
    const friday = 5;
    let diff = (friday - day.getDay() + 7) % 7;
    if (endOfNextWeek || diff === 0) diff += 7; // "already Friday" or explicitly next week → the Friday after
    day.setDate(day.getDate() + diff);
    if (hour == null) hour = 15;
    dayLabel = endOfNextWeek ? (lang === 'hr' ? 'kraj sljedećeg tjedna' : 'end of next week') : lang === 'hr' ? 'kraj tjedna' : 'end of this week';
  } else if (!day && (endOfMonth || endOfNextMonth)) {
    day = new Date(base);
    if (endOfNextMonth) day.setMonth(day.getMonth() + 1);
    day.setMonth(day.getMonth() + 1, 0); // day 0 of next month = last day of target month
    if (hour == null) hour = 10;
    dayLabel = endOfNextMonth ? (lang === 'hr' ? 'kraj sljedećeg mjeseca' : 'end of next month') : lang === 'hr' ? 'kraj mjeseca' : 'end of this month';
  }

  // "za 3 dana / 2 tjedna / 6 mjeseci", "in 3 days / 2 weeks / 6 months", "next week/month"
  // "za godinu dana" / "za mjesec dana" / "za tjedan dana" say the unit instead of a number — very common, and
  // previously unparsed here (temporal.ts handled them, the heuristic did not).
  const rel =
    /\b(?:za|in)\s+(\d{1,3}|godinu|mjesec|misec|tjedan)\s*(dan|dana|tjedan|tjedna|tjedana|mjesec|mjeseca|mjeseci|misec\w*|godin\w*|days?|weeks?|months?|years?)\b/i.exec(t);
  if (!day && rel) {
    const spelled = { godinu: 'godin', mjesec: 'mjes', misec: 'mjes', tjedan: 'tjed' }[rel[1]!.toLowerCase()];
    const n = spelled ? 1 : Number(rel[1]);
    // When the count was spelled out ("za godinu dana"), the unit is in the FIRST group, not the second.
    const unit = spelled ?? rel[2]!;
    day = new Date(base);
    if (/^(dan|day)/.test(unit)) day.setDate(day.getDate() + n);
    else if (/^(tjed|week)/.test(unit)) day.setDate(day.getDate() + n * 7);
    else if (/^(mjes|month)/.test(unit)) day.setMonth(day.getMonth() + n);
    else day.setFullYear(day.getFullYear() + n);
    dayLabel = rel[0]!;
  } else if (!day && /\b(sljedeći|sljedeci|idući|iduci|next)\s+(tjedan|week)\b/.test(t)) {
    day = new Date(base);
    day.setDate(day.getDate() + 7);
    dayLabel = lang === 'hr' ? 'sljedeći tjedan' : 'next week';
  } else if (!day && /\b(sljedeći|sljedeci|idući|iduci|next)\s+(mjesec|month)\b/.test(t)) {
    day = new Date(base);
    day.setMonth(day.getMonth() + 1);
    dayLabel = lang === 'hr' ? 'sljedeći mjesec' : 'next month';
  }

  // weekday: "u petak", "on friday"
  if (!day) {
    const names = lang === 'hr' ? HR_WEEKDAYS : EN_WEEKDAYS;
    for (let i = 0; i < 7; i++) {
      const re = new RegExp(`\\b(?:u|on|this|next|ovaj|idući|iduci|sljedeći|sljedeci)?\\s*(${names[i]})\\w*\\b`, 'i');
      const m = re.exec(t);
      if (m && (lang === 'en' || /\b(u|ovaj|idući|iduci|sljedeći|sljedeci)\s/.test(m[0]))) {
        day = new Date(base);
        const diff = (i - day.getDay() + 7) % 7 || 7;
        day.setDate(day.getDate() + diff);
        dayLabel = m[1]!;
        break;
      }
    }
  }

  // explicit date "14.3." / "14.3" / "14.03.2026" / "14/3"
  if (!day) {
    const ex = extractExplicitDate(text);
    if (ex) {
      const y = ex.year ?? base.getFullYear();
      day = new Date(y, ex.month - 1, ex.day);
      if (!ex.year && day.getTime() < base.getTime()) day.setFullYear(y + 1);
      dayLabel = `${ex.day}.${ex.month}.`;
    }
  }

  if (!day && hour == null) return null;

  const d = day ?? new Date(base);
  if (hour != null) d.setHours(hour, minute, 0, 0);
  else d.setHours(9, 0, 0, 0);
  if (!day && hour != null && d.getTime() <= now) d.setDate(d.getDate() + 1); // "u 15h" after 15h → tomorrow

  const label = [dayLabel, hour != null ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : ''].filter(Boolean).join(' ');
  return { iso: localIso(d), certainty: hour != null ? 'high' : 'medium', label: label || (lang === 'hr' ? 'u to vrijeme' : 'at that time') };
}

/**
 * Strip Croatian diacritics so "rodendan", "rodjendan" and "rođendan" all match. Used for pattern tests only.
 *
 * Also the one place slang vocabulary is normalized: "roćkas" and "rođus" (casual Dalmatian for a birthday)
 * become "rodendan" here, so every folded pattern — BIRTHDAY, GIFT_MARKERS, reconcile's occasionWord and E24's
 * occasionImplied — learns the word at once. On the device "Marko rockas" produced no question on either path:
 * the heuristic did not know the word, and E24 stripped the model's (correct!) anchor because the raw text
 * carried no occasion word our rules recognized. Teaching eight regexes separately is how they drift apart.
 * The replacement keeps case endings working: "roćkasa" → "rodendana", "rođusu" → "rodendanu".
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/dj(?=endan)/g, 'd') // rodjendan → rodendan
    .replace(/[čć]/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/\brockas/g, 'rodendan') // roćkas / ročkas — ć/č already folded to c above
    .replace(/\brodj?us/g, 'rodendan'); // rođus — đ folded to d above; "rodjus" is đ typed as dj, like rodjendan
}

const BIRTHDAY = /\b(rodendan|birthday|bday)\w*/i; // tested on fold(text)
const ANNIVERSARY = /\b(godisnjic|anniversary)\w*/i;

/**
 * "God" — Dalmatian for the anniversary of a death ("babi je god", "god mi je materi u svibnju").
 *
 * The word is only three letters and lives inside "godina", "godišnji", "godišnjica", so it is matched as a
 * WHOLE word with no suffix at all (\b god \b), which those never are. The explicit "godišnjica/obljetnica
 * smrti" phrasings are matched separately.
 */
const MEMORIAL = /(^|[\s,;:.!?])god($|[\s,;:.!?])|\b(godisnjic\w*|obljetnic\w*)\s+smrti\b|\bsmrtn\w*\s+godisnjic\w*/i;

/** True when the note is about someone's death anniversary rather than a birthday or a wedding. */
export function isMemorial(folded: string): boolean {
  return MEMORIAL.test(folded);
}

// "godišnjica braka/vjenčanja" is the explicit form, but a BARE "godišnjica" is the same occasion in practice:
// people say "godišnjica, trebam rezervirati restoran" and mean their own. Only an explicit other subject
// ("godišnjica firme", "godišnjica smrti") takes it away from the marriage. Getting this right is what makes the
// app ASK for the date instead of inventing a spouse, a place, or a quiet ~6-month fallback.
const ANNIVERSARY_OF = /\bgodisnjic\w*\s+(\w+)/;
const NOT_MARRIAGE_SUBJECT =
  /^(firm|kompanij|drustv|klub|smrt|pogib|rat|drzav|osnutk|osnivanj|neovisnost|pobjed|company|death|war|independence)/;

/** Does this (folded) text talk about a wedding anniversary? Shared by the heuristic and reconcile. */
export function isMarriageAnniversary(folded: string): boolean {
  if (/\bgodisnjic\w*\s+(brak|vjencanj)|\b(wedding|marriage)\s+anniversary/.test(folded)) return true;
  if (!ANNIVERSARY.test(folded)) return false;
  // A word right after "godišnjica" only disqualifies it when it names another subject ("godišnjica firme");
  // a verb or filler ("trebam", "je") does not.
  const m = ANNIVERSARY_OF.exec(folded);
  return !(m?.[1] && NOT_MARRIAGE_SUBJECT.test(m[1]));
}

/**
 * Relations are people too: "bratu poklon" → person "Brat". Folded (diacritics-free) inflected forms →
 * nominative label. Only used when no proper name is found.
 */
const RELATIONS: Record<string, string> = {
  brat: 'Brat', brata: 'Brat', bratu: 'Brat', bratom: 'Brat',
  sestra: 'Sestra', sestre: 'Sestra', sestri: 'Sestra', sestru: 'Sestra', sestrom: 'Sestra',
  mama: 'Mama', mami: 'Mama', mamu: 'Mama', majka: 'Mama', majci: 'Mama', mater: 'Mama', materi: 'Mama',
  mati: 'Mama', mamica: 'Mama', mamici: 'Mama', matere: 'Mama',
  tata: 'Tata', tati: 'Tata', tatu: 'Tata', otac: 'Tata', ocu: 'Tata', cale: 'Tata',
  caca: 'Tata', caci: 'Tata', cacu: 'Tata', cace: 'Tata', ata: 'Tata', japa: 'Tata', japi: 'Tata',
  zena: 'Žena', zeni: 'Žena', zenu: 'Žena', supruga: 'Žena', supruzi: 'Žena',
  muz: 'Muž', muzu: 'Muž', suprug: 'Muž', suprugu: 'Muž',
  cura: 'Cura', curi: 'Cura', curu: 'Cura', djevojka: 'Cura', djevojci: 'Cura',
  decko: 'Dečko', decku: 'Dečko', decka: 'Dečko', momak: 'Dečko', momku: 'Dečko',
  baka: 'Baka', baki: 'Baka', baku: 'Baka', nona: 'Baka', noni: 'Baka',
  baba: 'Baka', babi: 'Baka', babu: 'Baka', bake: 'Baka',
  djed: 'Djed', djedu: 'Djed', deda: 'Djed', dedi: 'Djed', nono: 'Djed', nonu: 'Djed',
  did: 'Djed', dida: 'Djed', didu: 'Djed', dide: 'Djed', didi: 'Djed', dedo: 'Djed', dedek: 'Djed', dedeku: 'Djed',
  sin: 'Sin', sinu: 'Sin', kcer: 'Kći', kceri: 'Kći', kci: 'Kći', sina: 'Sin', kcerka: 'Kći', kcerki: 'Kći',
  tetka: 'Tetka', tetki: 'Tetka', teta: 'Teta', teti: 'Teta', ujak: 'Ujak', ujaku: 'Ujak', stric: 'Stric', stricu: 'Stric',
  strina: 'Strina', strini: 'Strina', ujna: 'Ujna', ujni: 'Ujna',
  // Extended family, the way it is actually said around the country.
  sogor: 'Šogor', sogoru: 'Šogor', sogora: 'Šogor', sogorica: 'Šogorica', sogorici: 'Šogorica',
  svekar: 'Svekar', svekru: 'Svekar', svekrva: 'Svekrva', svekrvi: 'Svekrva',
  punac: 'Punac', puncu: 'Punac', punica: 'Punica', punici: 'Punica',
  zet: 'Zet', zetu: 'Zet', snaha: 'Snaha', snahi: 'Snaha', nevjesta: 'Snaha',
  necak: 'Nećak', necaku: 'Nećak', necakinja: 'Nećakinja', sinovac: 'Nećak', sinovcu: 'Nećak',
  bratic: 'Bratić', braticu: 'Bratić', sestricna: 'Sestrična', sestricni: 'Sestrična',
  unuk: 'Unuk', unuku: 'Unuk', unuka: 'Unuka', unuci: 'Unuka',
  kum: 'Kum', kumu: 'Kum', kuma: 'Kuma', kumi: 'Kuma', prijatelj: 'Prijatelj', prijatelju: 'Prijatelj', frend: 'Frend', frendu: 'Frend',
  susjed: 'Susjed', susjedu: 'Susjed', susjeda: 'Susjeda', susjedi: 'Susjeda', komsija: 'Susjed',
  sef: 'Šef', sefu: 'Šef', kolega: 'Kolega', kolegi: 'Kolega', kolegica: 'Kolegica', kolegici: 'Kolegica',
  brother: 'Brother', sister: 'Sister', mom: 'Mom', mum: 'Mum', dad: 'Dad', wife: 'Wife', husband: 'Husband',
  girlfriend: 'Girlfriend', boyfriend: 'Boyfriend', grandma: 'Grandma', grandpa: 'Grandpa', son: 'Son', daughter: 'Daughter',
  boss: 'Boss', friend: 'Friend',
};

/** A capitalised word after these is a brand/option, not a person ("neki Nikon ili Canon"). */
const NON_PERSON_PRECEDERS = new Set(['neki', 'neka', 'neko', 'nekog', 'nekakav', 'ili', 'or', 'some', 'a', 'an', 'the', 'marke', 'brand', 'model']);

/**
 * The day an occasion in the note falls on — explicit ("rođendan 5.9.", "treći petog") OR relative but still a
 * specific day ("u subotu", "sutra", "za 2 tjedna", "prva srida u misecu"), resolved against `now`.
 *
 * Hard rule 12 says a date written in the note always wins; "u subotu" is such a date. Without this, "Branki je
 * rođendan u subotu" asked for the date and dropped the Saturday (device, 2026-08-28). Month- and year-sized
 * offsets ("za 3 mjeseca") stay out: they land on a day, but nobody means that day — better to ask than to
 * pin a birthday to an arithmetic accident.
 */
export function statedOccasionDate(text: string, now: number): { month: number; day: number; year: number | null } | null {
  const explicit = extractExplicitDate(text);
  if (explicit) return explicit;
  const s = parseTemporal(text, now)[0];
  if (!s) return null;
  const daySpecific =
    s.type === 'weekday' ||
    s.type === 'nth_weekday' ||
    (s.type === 'relative' && !s.approximate && (s.days != null || s.weeks != null) && s.months == null && s.years == null);
  if (!daySpecific) return null;
  // A relative DAY is counted on the calendar, not through resolveSignal(): that rolls "danas" to tomorrow once
  // the default hour has passed — right for a reminder, wrong for the date of the occasion ("rođendan danas" at
  // noon is today's birthday, whatever time the reminder ends up at).
  let at: number | null | undefined;
  if (s.type === 'relative') {
    const d = new Date(now);
    d.setDate(d.getDate() + (s.days ?? 0) + (s.weeks ?? 0) * 7);
    at = d.getTime();
  } else {
    at = resolveSignal(s, now)?.fireAt;
  }
  if (at == null) return null;
  const d = new Date(at);
  return { month: d.getMonth() + 1, day: d.getDate(), year: null };
}

/** "10.6", "10.6.", "10.06.2027", "6/10" (d/m) → month/day. Times like "u 10.30" are excluded. */
export function extractExplicitDate(text: string): { month: number; day: number; year: number | null } | null {
  const re = /(?:^|[\s(])(\d{1,2})[./](\d{1,2})\.?(?:\s?(\d{4}))?(?=$|[\s,.;!?)])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 4), m.index + 1).toLowerCase();
    if (/\b(u|at|od|do)\s$/.test(before + ' ') && !m[3]) continue; // "u 10.30" → time, not date
    // An identifier is not a date: "Verzija 2.10 ima bug" scheduled 2 October, "Polica osiguranja 12.5 mil"
    // scheduled 12 May. temporal.ts had refused both since August; this function is the copy that wins for
    // occasion dates and it had no guard at all. Shared list, so the two cannot drift apart.
    if (looksLikeIdentifier(text, m.index)) continue;
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return { month: mo, day: d, year: m[3] ? Number(m[3]) : null };
  }
  return parseSpokenDate(text);
}

// ── spoken dates ("treći petog", "trećeg svibnja", "3. svibnja", "petnaestog drugog") — what dictation produces.
const ORDINAL_UNITS: Record<string, number> = {
  prv: 1, drug: 2, trec: 3, cetvrt: 4, pet: 5, sest: 6, sedm: 7, osm: 8, devet: 9, deset: 10,
  jedanaest: 11, dvanaest: 12, trinaest: 13, cetrnaest: 14, petnaest: 15, sesnaest: 16, sedamnaest: 17, osamnaest: 18, devetnaest: 19,
  dvadeset: 20, trideset: 30,
};
const MONTH_NAMES: Record<string, number> = {
  sijec: 1, velja: 2, ozuj: 3, travn: 4, svib: 5, lip: 6, srp: 7, kolovoz: 8, ruj: 9, listopad: 10, studen: 11, prosin: 12,
  januar: 1, februar: 2, mart: 3, april: 4, maj: 5, jun: 6, jul: 7, august: 8, septemb: 9, oktob: 10, novemb: 11, decemb: 12,
};
// -og/-oga (petog), -eg/-ega (trećeg — soft stem), -i/-a/-e/-u/-om (nominative/other cases)
const ORD_SUFFIX = '(?:i|og|oga|eg|ega|e|a|u|om)?';

/** "dvadeset trećeg" → 23, "petog" → 5, "3." → 3. Returns null if the word isn't an ordinal. */
function ordinalValue(word: string): number | null {
  const w = fold(word).replace(/\.$/, '');
  if (/^\d{1,2}$/.test(w)) return Number(w);
  for (const [stem, n] of Object.entries(ORDINAL_UNITS)) {
    if (new RegExp(`^${stem}${ORD_SUFFIX}$`).test(w)) return n;
  }
  return null;
}

function monthValue(word: string): number | null {
  const w = fold(word).replace(/\.$/, '');
  for (const [stem, n] of Object.entries(MONTH_NAMES)) if (w.startsWith(stem)) return n;
  return ordinalValue(word);
}

export function parseSpokenDate(text: string): { month: number; day: number; year: number | null } | null {
  const tokens = text.replace(/[,;!?()"„”]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    // day may be one word ("treći") or two ("dvadeset treći")
    let day: number | null = null;
    let next = i + 1;
    const a = ordinalValue(tokens[i]!);
    if (a == null) continue;
    if ((a === 20 || a === 30) && i + 1 < tokens.length) {
      const b = ordinalValue(tokens[i + 1]!);
      if (b != null && b < 10) {
        day = a + b;
        next = i + 2;
      }
    }
    if (day == null) day = a;
    if (day < 1 || day > 31) continue;
    // optional "u" / "mjeseca" between day and month is rare; accept the month right after
    const mWord = tokens[next];
    if (!mWord) continue;
    const month = monthValue(mWord);
    if (month == null || month < 1 || month > 12) continue;
    // a digit-day followed by a digit-month was already handled by the numeric regex; here at least one is a word
    if (/^\d+\.?$/.test(tokens[i]!) && /^\d+\.?$/.test(mWord)) continue;
    const yTok = tokens[next + 1];
    const year = yTok && /^\d{4}\.?$/.test(yTok) ? Number(yTok.replace('.', '')) : null;
    return { month, day, year };
  }
  return null;
}

// Car makes and models are the trap Marko named: "mali servis za Polo" must not read Polo as a person to buy a
// present for. Many of them are ordinary-looking capitalised words (Polo, Golf, Astra, Punto, Corsa), so they
// need to be listed explicitly rather than inferred. Matched case-insensitively via fold(), so "polo" counts too.
const CAR_WORDS = [
  'polo', 'golf', 'passat', 'tiguan', 'touran', 'caddy', 'transporter', 'skoda', 'octavia', 'fabia', 'superb',
  'astra', 'corsa', 'insignia', 'zafira', 'vectra', 'punto', 'panda', 'tipo', 'stilo', 'bravo', 'clio', 'megane',
  'scenic', 'kadjar', 'captur', 'twingo', 'yaris', 'corolla', 'avensis', 'auris', 'rav', 'civic', 'accord', 'jazz',
  'focus', 'fiesta', 'mondeo', 'kuga', 'ibiza', 'leon', 'ateca', 'arona', 'ceed', 'sportage', 'sorento', 'picanto',
  'tucson', 'santa', 'i20', 'i30', 'qashqai', 'juke', 'micra', 'peugeot', 'citroen', 'renault', 'opel', 'fiat',
  'audi', 'bmw', 'mercedes', 'volkswagen', 'toyota', 'honda', 'hyundai', 'kia', 'mazda', 'nissan', 'suzuki',
  'seat', 'dacia', 'duster', 'sandero', 'logan', 'volvo', 'subaru', 'mitsubishi', 'lancia', 'alfa', 'romeo',
];

const NOT_NAMES = new Set(['Ja', 'Ti', 'On', 'Ona', 'Mi', 'Vi', 'Oni', 'I', 'You', 'He', 'She', 'We', 'They', 'Auto', 'Dyson', 'Apple', 'Google', 'Samsung', 'Nikon', 'Canon', 'Sony', 'Iphone', 'Zara', 'Ikea']);

/** A car make or model — never a person, never a fraction ("servis za polo" is not "half"). */
export function isCarWord(token: string): boolean {
  const f = fold(token).replace(/[^a-z0-9]/g, '');
  return CAR_WORDS.includes(f);
}

/** A capitalised word right after a locative/directional preposition is a place, not a person ("u Zadru", "na Krku"). */
const PLACE_PRECEDERS = new Set(['u', 'na', 'iz', 'do', 'prema', 'kroz', 'preko', 'pored', 'blizu', 'in', 'to', 'from', 'near', 'at']);
// Croatian cities/regions/islands + a few frequent neighbourhoods, as stems so any case ("Zadru", "Zadra") matches.
const CITY_STEMS = [
  'zagreb', 'zadr', 'split', 'rijek', 'osijek', 'dubrovn', 'pul', 'sibenik', 'varazdin', 'karlov', 'sisak', 'sisk', 'slavonsk', 'vinkov', 'vukovar',
  'zabok', 'cakov', 'koprivn', 'bjelovar', 'pozeg', 'virovit', 'gospic', 'knin', 'makarsk', 'trogir', 'omis', 'hvar', 'brac', 'korcul', 'krk', 'rab',
  'pag', 'cres', 'losinj', 'umag', 'porec', 'rovinj', 'opatij', 'crikven', 'senj', 'novalj', 'biograd', 'sukosan', 'vodic', 'primosten', 'kastel',
  'solin', 'imotsk', 'sinj', 'metkov', 'ploc', 'samobor', 'zapresic', 'sesvet', 'dubrav', 'tresnjevk', 'maksimir', 'crnomerec', 'ilic', 'jarun',
  'velik', 'goric', 'plitvic', 'istr', 'dalmac', 'slavonij', 'zagorj', 'lik', 'kvarner', 'hrvatsk', 'europ', 'italij', 'njemack', 'austrij',
  'beč', 'bec', 'london', 'pariz', 'berlin', 'rim', 'lisabon', 'barcelon', 'minhen', 'munchen', 'graz', 'ljubljan', 'beograd', 'sarajev', 'mostar',
];

export function isLikelyPlace(token: string, prevToken?: string): boolean {
  const f = fold(token);
  if (prevToken && PLACE_PRECEDERS.has(prevToken.toLowerCase())) return true;
  return CITY_STEMS.some((s) => f.startsWith(s));
}

/** Best-effort person detection: capitalised token that is not sentence-initial, or one followed by a "wants" verb. */
export function extractPeople(text: string): string[] {
  const tokens = text.replace(/[.,;:!?()"]/g, ' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  tokens.forEach((tok, i) => {
    if (!/^[A-ZČĆŽŠĐ][a-zčćžšđ]{2,}$/.test(tok)) return;
    if (NOT_NAMES.has(tok)) return;
    if (isCarWord(tok)) return; // "servis za Polo" — a model, not a person
    const prev = tokens[i - 1]?.toLowerCase() ?? '';
    if (NON_PERSON_PRECEDERS.has(prev)) return; // "neki Nikon ili Canon"
    if (isLikelyPlace(tok, prev) && !RELATIONS[fold(tok)]) return; // "u Zadru", "na Krku" — places, not people
    const next = tokens[i + 1]?.toLowerCase() ?? '';
    const isWantsVerb = /^(želi|zeli|voli|treba|wants|likes|needs|said|rekao|rekla|preporučio|preporucio|preporučila|preporucila|ima|has)$/.test(next);
    const isRelation = RELATIONS[fold(tok)] != null;
    if (isRelation) {
      const label = RELATIONS[fold(tok)]!;
      if (!out.includes(label)) out.push(label);
      return;
    }
    // A sentence-initial capital is usually just the start of a sentence, so a name there needs a reason.
    // A "wants" verb is one; so is a gift/occasion word in the note — people write "Marta poklon rođendan" as
    // a headline with no verb at all, and that used to yield no person, hence no anchor and no question: the
    // note saved silently and only asked after "Pročitaj ponovno".
    // But the first word must not itself be the sentence's verb ("Uzeti majci poklon" starts with a verb, and
    // the person there is "majci"), so a capitalised task verb is never the name.
    const occasionCue = /\b(poklon|dar|rodendan|godisnjic|imendan|gift|present|birthday|anniversary)/.test(fold(text));
    // …and the occasion word itself is never the person: "Godišnjica braka", "Rođendan je u petak".
    // Match the verb LIST, not an "-ti" ending: plenty of names end that way once inflected ("Marti", "Ivi",
    // "Anti"), and treating the ending as a verb marker silently dropped the person the note is about.
    const isVerb = TASK_VERBS.test(tok);
    const isOccasionWord = /^(poklon|dar|rodendan|rodjendan|godisnjic|imendan|gift|present|birthday|anniversary)/.test(fold(tok));
    if (i > 0 || isWantsVerb || (occasionCue && !isVerb && !isOccasionWord)) {
      // "Anin rođendan" → Ana, "Markov rođendan" → Marko — possessive only when an anchor noun follows
      let name = tok;
      const anchorNoun = /^(rođendan|rodjendan|godišnjic|godisnjic|imendan|birthday|anniversary)/.test(next);
      if (anchorNoun && /in$/.test(tok) && tok.length >= 4) name = tok.slice(0, -2) + 'a';
      else if (anchorNoun && /[oe]v$/.test(tok) && tok.length >= 4) name = tok.slice(0, -2) + 'o';
      if (!out.includes(name)) out.push(name);
    }
  });
  // No proper name → a lowercase relation counts ("bratu poklon…", "mami za rođendan")
  if (out.length === 0) {
    for (const tok of tokens) {
      const rel = RELATIONS[fold(tok)];
      if (rel) {
        out.push(rel);
        break;
      }
    }
  }
  return out;
}

export function extractKeywords(text: string, extra: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (w: string) => {
    const n = w.toLowerCase().trim();
    if (n.length < 3 || STOP.has(n) || seen.has(n) || /^\d+$/.test(n)) return;
    seen.add(n);
    out.push(n);
  };
  text
    .replace(/[.,;:!?()"']/g, ' ')
    .split(/\s+/)
    .forEach(push);
  extra.forEach(push);
  return out.slice(0, 14);
}

const PREFIX = /^\s*(zapamti|zabilježi|zabiljezi|podsjeti me|podsjeti|remember|remind me|note)\s*[:,-]?\s*(da|to|that)?\s*/i;
const TIME_EXPR = [
  /\b(?:u|at|@)\s*\d{1,2}(?::\d{2})?\s*(?:h|sati|sat|am|pm)?\b/gi,
  /\b(prekosutra|sutra|danas|večeras|veceras|tomorrow|today|tonight|day after tomorrow)\b/gi,
  /\b(?:za|in)\s+\d{1,3}\s*(?:dan|dana|tjedan|tjedna|tjedana|mjesec|mjeseca|mjeseci|godin\w*|days?|weeks?|months?|years?)\b/gi,
  /\b(?:u|on|this|next|ovaj|idući|iduci|sljedeći|sljedeci)\s+(ponedjeljak|utorak|srijedu|četvrtak|cetvrtak|petak|subotu|nedjelju|tjedan|mjesec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)\b/gi,
];

const CATEGORY_LABEL: Record<string, { hr: string; en: string }> = {
  auto_servis: { hr: 'servis auta', en: 'car service' },
  zdravlje: { hr: 'zdravlje', en: 'health' },
  dom: { hr: 'majstor', en: 'home repair' },
  poklon: { hr: 'poklon', en: 'gift' },
  restoran: { hr: 'restoran', en: 'restaurant' },
  putovanje: { hr: 'putovanje', en: 'travel' },
  preporuka: { hr: 'preporuka', en: 'recommendation' },
};

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Are these two words the same name in different cases? "Ana"/"Ani", "Marti"/"Marti", "Brat"/"Bratu".
 * Compares the stem (name minus its case ending) rather than trying to decline anything.
 */
function sameName(a: string, b: string): boolean {
  const stem = (s: string) => fold(s).replace(/(?:ovima|ama|ima|om|em|eu|ju|og|u|i|e|a|o)$/, '');
  const [x, y] = [fold(a), fold(b)];
  if (x === y) return true;
  const [sx, sy] = [stem(x), stem(y)];
  return sx.length >= 2 && sx === sy;
}

function clip(s: string, words: number): string {
  return s.replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '').split(' ').slice(0, words).join(' ');
}

/**
 * Short title (≤ 6 words) that is DIFFERENT from the raw text whenever we can manage it,
 * so the card reads: title = what it is, description = what you said.
 */
export function makeTitle(
  text: string,
  ctx: { intent: Intent; category: string | null; people: string[]; language: Language },
): string {
  const hr = ctx.language === 'hr';
  let clean = text.replace(PREFIX, '');
  for (const re of TIME_EXPR) clean = clean.replace(re, ' ');
  clean = clip(clean, 40);
  const person = ctx.people[0];

  if (ctx.intent === 'gift' && person) {
    // strip the date and the "za rođendan" tail, then look for the object
    const body = clean.replace(/\s*(?:za|for)\s+\S*(?:rođendan|rodendan|rodjendan|birthday|godišnjic|godisnjic|anniversary)\S*.*$/i, '').replace(/\s*\d{1,2}[./]\d{1,2}\.?(\s?\d{4})?\s*$/, '');
    const wants = /(?:želi|zeli|voli|treba|wants|would like|likes|needs)\s+(.+?)\s*$/i.exec(body);
    const gift = /(?:poklon|dar|gift|present)\s*[:\-–]?\s+(.+?)\s*$/i.exec(body);
    const object = wants?.[1] ?? gift?.[1] ?? null;
    let obj = object ? clip(object.replace(/^(neki|neka|neko|some|a|an)\s+/i, ''), 5) : '';
    // "Poklon Marti za rođendan" → the regex captures "Marti", i.e. the person, and the title became
    // "Marti: Marti". An object that is only the recipient's name (in any case form) is not an object.
    if (obj && ctx.people.some((p) => sameName(p, obj))) obj = '';
    return obj ? `${person}: ${cap(obj)}` : hr ? `Poklon za ${person}` : `Gift for ${person}`;
  }

  if (ctx.intent === 'future_need' && ctx.category) {
    const rec = /(?:preporučio|preporucio|preporučila|preporucila|preporuča|preporuca|recommended|recommends)\s+(.+?)\s*$/i.exec(clean);
    let subject = rec?.[1] ?? clean;
    subject = subject.replace(/\s+(?:za|for)\s+\S+$/i, '').replace(/^(?:mi|me)\s+/i, '');
    const label = CATEGORY_LABEL[ctx.category]?.[hr ? 'hr' : 'en'] ?? ctx.category.replace(/_/g, ' ');
    const s = clip(subject, 4);
    return s && s.toLowerCase() !== label ? `${cap(s)} · ${label}` : cap(label);
  }

  if (ctx.intent === 'task') {
    return cap(clip(clean, 6));
  }

  return cap(clip(clean, 6));
}

/** @deprecated kept for callers that only have text; prefer makeTitle. */
export function makeSummary(text: string): string {
  return cap(clip(text.replace(PREFIX, ''), 8));
}

export function heuristicEnrich(text: string, ctx: HeuristicContext): EnrichResult {
  const language = detectLanguage(text);
  const hr = language === 'hr';
  const people = extractPeople(text);

  let category: string | null = null;
  let intent: Intent = 'fact';
  let synonyms: string[] = [];
  const foldedForCategory = fold(text);
  for (const def of Object.values(CATEGORY_SYNONYMS)) {
    // Test the folded text too: dictation and fast typing drop diacritics ("sofersajba", "kvacilo", "dimnjacar"),
    // and \b does not behave next to š/č/ć in the raw string anyway. The patterns list both spellings.
    if (def.match.test(text) || def.match.test(foldedForCategory)) {
      category = def.category;
      intent = def.intent;
      synonyms = def.keywords;
      break;
    }
  }

  const folded = fold(text);
  const isBirthday = BIRTHDAY.test(folded);
  // A death anniversary is decided FIRST and suppresses the gift reading entirely — "godišnjica smrti" contains
  // "godišnjica", so without this it would fall through to the present-buying path.
  const isMemorialNote = isMemorial(folded);
  const isAnniversary = ANNIVERSARY.test(folded) && !isMemorialNote;
  // Explicit or relative — "5.9." and "u subotu" both date the occasion (statedOccasionDate).
  const statedDate = isBirthday || isAnniversary || isMemorialNote ? statedOccasionDate(text, ctx.now) : null;
  // A date next to "rođendan" is the anchor, not a task time.
  const time = statedDate ? null : extractTime(text, ctx.now, language);

  if (isMemorialNote) intent = 'fact'; // remembering a day, never a task and never a gift
  else if (TASK_VERBS.test(text) && time) intent = 'task';
  else if (TASK_VERBS.test(text) && intent === 'fact') intent = 'task';
  else if (isBirthday || isAnniversary) intent = 'gift';
  else if (RECOMMEND.test(text) && intent === 'fact') intent = 'future_need';
  else if (IDEA_HINTS.test(text) && intent === 'fact') intent = 'idea';
  if ((isBirthday || isAnniversary) && !isMemorialNote && !category) category = 'poklon';
  if (isMemorialNote) category = 'ostalo';

  const keywords = extractKeywords(text, [...synonyms, ...people]);
  const triggers: EnrichTrigger[] = [
    { type: 'semantic', certainty: 'high', label: hr ? 'kad tražiš' : 'when you search', keywords },
  ];
  const questions: EnrichResult['questions'] = [];
  let needs_anchor: EnrichResult['needs_anchor'] = null;

  if (time) {
    triggers.push({ type: 'time', certainty: time.certainty, label: time.label, iso_datetime: time.iso });
  }

  // E1: a gift for a person with no occasion named = birthday (the spec's canonical "Ana želi Dyson fen" has no
  // "rođendan" in it and still expects the birthday question). Anniversary only when the word is there.
  // "Godišnjica braka / vjenčanja" names no person — the anchor is the marriage itself ("Brak" → label
  // "Godišnjica braka", question "Kad je godišnjica braka?"), never a place or a relation guessed from context.
  const marriage = isAnniversary && isMarriageAnniversary(folded);
  // "Babi je god" — the anniversary of a death. Checked before the gift/birthday paths so it can never be
  // turned into a shopping reminder for someone who has died.
  const memorial = isMemorialNote && !marriage;

  // A date the app can look up (Valentinovo, Dan žena, Božić, Uskrs…) is known here too, not only in reconcile():
  // whenever the proxy is unreachable or out of quota the heuristic IS the enricher, and without this
  // "Poklon za Valentinovo" produced no date at all until several "Pročitaj ponovno" taps happened to reach a model.
  const knownHit = !statedDate && !marriage ? findKnownDate(text, new Date(ctx.now).getFullYear(), language) : null;
  // Naming a holiday is not the same as planning something for it. "Božić je moj najdraži blagdan" states a
  // preference; turning that into a reminder invents an intention the user never had. A note earns an anchor
  // only when it also says something to DO — a task verb, a gift, or a preposition that points at the day
  // ("za Božić", "na Veliku Gospu", "pred Novu godinu").
  // A statement about a holiday describes it ("Božić JE moj najdraži blagdan", "za Valentinovo JE gužva"); an
  // intention says what to do about it. The copula is the reliable divider — a plan almost never needs "je".
  const isStatement = /\b(je|su|bude|bude\w*|uvijek|nikad|najdraz\w*|guzva|volim|mrzim)\b/.test(folded) && !TASK_VERBS.test(text);
  const intentionalOccasion = !!knownHit && !isStatement && (TASK_VERBS.test(text) || intent === 'gift' || /\b(za|na|pred|uoci)\s/.test(folded));
  const known = intentionalOccasion ? knownHit : null;
  if (known) {
    const knownAnchor = findAnchor(ctx.anchors, known.key, known.kind);
    // The offset comes from the text when it names one ("tjedan prije Božića" → −7, "2 dana prije" → −2,
    // "na Božić" → 0); the default is a week's notice, which is what a holiday you must prepare for needs.
    const stated = parseTemporal(text, ctx.now).find((s) => s.type === 'offset_from_anchor');
    const onTheDay = /\b(na|za)\s+\w*\s*(bozic|uskrs|gospu|gospa|novu godinu|badnjak)/.test(folded) && !stated;
    const offset = stated?.type === 'offset_from_anchor' ? stated.offsetDays : onTheDay ? 0 : -7;
    triggers.push({
      type: 'anchor',
      certainty: 'high',
      label: offsetLabel(offset, hr ? 'hr' : 'en'),
      anchor_person: known.key,
      anchor_kind: known.kind,
      anchor_month_day: knownAnchor ? null : known.monthDay,
      offset_days: offset,
    });
  }

  const occasion = !known && (isBirthday || isAnniversary || memorial || intent === 'gift');
  const anchorPerson = marriage ? MARRIAGE_PERSON : people[0];
  if (occasion && anchorPerson) {
    const kind: AnchorKind = memorial ? 'memorial' : isAnniversary ? 'anniversary' : 'birthday';
    const person = anchorPerson;
    // A personal date is never recalled from a previous note — a name is not an identity, and the Marta here
    // need not be the Marta from before (see findAnchor). Either this note states the date, or we ask.
    triggers.push({
      type: 'anchor',
      certainty: 'high',
      label: memorial ? (hr ? 'tjedan prije' : 'a week before') : hr ? '3 tjedna prije' : '3 weeks before',
      anchor_person: person,
      anchor_kind: kind,
      anchor_month_day: statedDate ? formatMonthDay(statedDate.month, statedDate.day) : null,
      offset_days: kind === 'memorial' ? -7 : kind === 'birthday' ? -21 : -14,
    });
    if (!statedDate) {
      needs_anchor = { person, kind };
      // ingest() adds the date question; we don't duplicate it here.
    }
  }

  const summary = makeTitle(text, { intent, category, people, language });
  return {
    summary,
    language,
    category,
    intent,
    confidence: 0.5,
    entities: { people, orgs: [], places: [], keywords },
    needs_anchor,
    triggers,
    questions,
  };
}
