// M0 gate. Reads fixtures/notes.jsonl, enriches each note, applies ingest() (the same
// post-processing the app uses), and reports the metrics from docs/00-PLAN.md.
//   GEMINI_KEY=... npm run p0
//   npm run p0 -- --heuristic

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ingest } from '../src/domain/enrich/ingest';
import { normalizeEnrichResult } from '../src/domain/enrich/normalize';
import { reconcile } from '../src/domain/enrich/reconcile';
import { FakeClock } from '../src/domain/clock';
import type { Anchor, EnrichResult, TriggerType } from '../src/domain/types';
import { enrichViaProxy, enrichWithGemini, enrichWithHeuristic, type HarnessContext } from './enrich';

interface Fixture {
  text: string;
  expected: { intent?: string; triggers?: TriggerType[]; needs_anchor?: boolean; category?: string };
  acceptable_questions?: string[]; // substrings; [] = no question acceptable
  answer?: string; // the correct option for an options question, if any
  anchors?: Array<{ person: string; kind: Anchor['kind']; monthDay: string }>;
  search_query?: string; // how the user would look for it 6 months later (semantic recall)
}

const args = new Set(process.argv.slice(2));
// Modes: --heuristic (local baseline) · --proxy (through the deployed worker, URL from EXPO_PUBLIC_AI_PROXY_URL or P0_PROXY_URL)
//        · default: direct Gemini with GEMINI_KEY; falls back to proxy if a URL exists, else heuristic.
const proxyUrl = process.env.P0_PROXY_URL || process.env.EXPO_PUBLIC_AI_PROXY_URL || readDotEnv('EXPO_PUBLIC_AI_PROXY_URL');
const mode: 'heuristic' | 'proxy' | 'gemini' = args.has('--heuristic')
  ? 'heuristic'
  : args.has('--proxy') || (!process.env.GEMINI_KEY && proxyUrl)
    ? 'proxy'
    : process.env.GEMINI_KEY
      ? 'gemini'
      : 'heuristic';
const useHeuristic = mode === 'heuristic';
// Free tier: 5 req/min per model; the worker falls back to a second model on 429, so ~8/min is safe. --rpm=N to change.
const rpmArg = process.argv.find((a) => a.startsWith('--rpm='));
const rpm = rpmArg ? Math.max(1, Number(rpmArg.slice(6))) : 8;
const spacingMs = Math.ceil(60_000 / rpm);

function readDotEnv(key: string): string | undefined {
  try {
    const line = readFileSync(resolve(__dirname, '../.env'), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`));
    return line?.slice(key.length + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}
const fixturesPath = resolve(__dirname, 'fixtures/notes.jsonl');
const reportPath = resolve(__dirname, 'report.md');

const fixtures: Fixture[] = readFileSync(fixturesPath, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('//') && !l.startsWith('#'))
  .map((l) => JSON.parse(l) as Fixture);

const NOW = Date.parse('2026-08-25T14:32:00');
const clock = new FakeClock(NOW);

function toAnchors(f: Fixture): Anchor[] {
  return (f.anchors ?? []).map((a, i) => ({
    id: `a${i}`,
    label: `${a.person}`,
    person: a.person,
    kind: a.kind,
    monthDay: a.monthDay,
    year: null,
    contactId: null,
    source: 'user',
    createdAt: 0,
    updatedAt: 0,
  }));
}

function pct(n: number, d: number) {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

function percentile(xs: number[], p: number) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

function keywordRecall(result: EnrichResult, query: string | undefined): boolean | null {
  if (!query) return null;
  const q = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  const kws = new Set<string>();
  for (const t of result.triggers) if (t.type === 'semantic') t.keywords?.forEach((k) => kws.add(k.toLowerCase()));
  result.entities?.keywords?.forEach((k) => kws.add(k.toLowerCase()));
  const all = Array.from(kws).join(' ');
  return q.some((w) => all.includes(w.slice(0, Math.max(4, w.length - 2))));
}

async function main() {
  console.log(`p0 harness — ${fixtures.length} notes — mode: ${mode}\n`);
  const rows: string[] = [];
  const latencies: number[] = [];
  let valid = 0;
  let questionsTotal = 0;
  let zeroQ = 0;
  let intentHit = 0;
  let triggerHit = 0;
  let anchorHit = 0;
  let anchorTotal = 0;
  let optionHit = 0;
  let optionTotal = 0;
  let recallHit = 0;
  let recallTotal = 0;
  let unacceptableQ = 0;

  for (const f of fixtures) {
    const anchors = toAnchors(f);
    const ctx: HarnessContext = { now: NOW, timezone: 'Europe/Zagreb', anchors, prefs: {} };
    if (mode !== 'heuristic' && rows.length > 0) await new Promise((r) => setTimeout(r, spacingMs)); // respect free-tier RPM
    const out =
      mode === 'heuristic' ? await enrichWithHeuristic(f.text, ctx) : mode === 'proxy' ? await enrichViaProxy(f.text, ctx, proxyUrl!) : await enrichWithGemini(f.text, ctx);
    if (mode !== 'heuristic') process.stdout.write('.');
    latencies.push(out.ms);
    if (!out.result) {
      rows.push(`| ${f.text} | ✗ ${out.error ?? 'invalid'} | | | |`);
      continue;
    }
    const r = normalizeEnrichResult(out.result, f.text);
    if (!r) {
      rows.push(`| ${f.text} | ✗ unusable JSON (no summary) | | | |`);
      continue;
    }
    valid++;
    const reconciled = useHeuristic ? r : reconcile(r, f.text, { now: NOW, anchors });
    const ing = ingest(reconciled, { existingTriggers: [], anchors, prefs: {}, clock });

    const nq = ing.questions.length;
    questionsTotal += nq;
    if (nq === 0) zeroQ++;

    const acceptable = f.acceptable_questions ?? [];
    const badQ = ing.questions.filter((q) => !acceptable.some((a) => q.text.toLowerCase().includes(a.toLowerCase())));
    if (badQ.length) unacceptableQ++;

    if (f.expected.intent && reconciled.intent === f.expected.intent) intentHit++;
    const types = new Set(ing.drafts.map((d) => d.type));
    const wantTypes = f.expected.triggers ?? [];
    if (wantTypes.every((t) => types.has(t))) triggerHit++;
    if (f.expected.needs_anchor != null) {
      anchorTotal++;
      if (Boolean(ing.needsAnchor) === f.expected.needs_anchor) anchorHit++;
    }
    if (f.answer) {
      optionTotal++;
      if (ing.questions.some((q) => q.options?.some((o) => o.toLowerCase().includes(f.answer!.toLowerCase())))) optionHit++;
    }
    const rec = keywordRecall(reconciled, f.search_query);
    if (rec != null) {
      recallTotal++;
      if (rec) recallHit++;
    }

    rows.push(
      `| ${f.text} | ${reconciled.intent}${f.expected.intent && reconciled.intent !== f.expected.intent ? ` (want ${f.expected.intent})` : ''} | ${Array.from(types).join(', ')} | ${nq}${badQ.length ? ' ⚠' : ''} ${ing.questions.map((q) => `"${q.text}"`).join(' ')} | ${Math.round(out.ms)} ms |`,
    );
  }

  const n = fixtures.length;
  const avgQ = valid ? questionsTotal / valid : 0;
  const metrics = [
    ['questions_per_note', avgQ.toFixed(2), '< 0.8', '< 0.4', avgQ < 0.8],
    ['zero_question_rate', `${pct(zeroQ, valid)}%`, '> 60%', '> 75%', pct(zeroQ, valid) > 60],
    ['unacceptable_question_rate', `${pct(unacceptableQ, valid)}%`, '< 10%', '0%', pct(unacceptableQ, valid) < 10],
    ['intent_accuracy', `${pct(intentHit, valid)}%`, '> 80%', '> 90%', pct(intentHit, valid) > 80],
    ['expected_trigger_types', `${pct(triggerHit, valid)}%`, '> 80%', '> 90%', pct(triggerHit, valid) > 80],
    ['needs_anchor_accuracy', anchorTotal ? `${pct(anchorHit, anchorTotal)}%` : 'n/a', '> 90%', '100%', anchorTotal === 0 || pct(anchorHit, anchorTotal) > 90],
    ['option_hit_rate', optionTotal ? `${pct(optionHit, optionTotal)}%` : 'n/a', '> 80%', '> 90%', optionTotal === 0 || pct(optionHit, optionTotal) > 80],
    ['semantic_recall (keyword proxy)', recallTotal ? `${pct(recallHit, recallTotal)}%` : 'n/a', '> 70%', '> 85%', recallTotal === 0 || pct(recallHit, recallTotal) > 70],
    ['schema_valid', `${pct(valid, n)}%`, '100%', '100%', valid === n],
    ['latency_p50', `${Math.round(percentile(latencies, 50))} ms`, '< 2500', '< 1500', percentile(latencies, 50) < 2500],
    ['latency_p95', `${Math.round(percentile(latencies, 95))} ms`, '< 5000', '< 3000', percentile(latencies, 95) < 5000],
  ] as const;

  const gatePass = metrics.every((m) => m[4]);
  const md = [
    `# p0 report — ${new Date().toISOString()} — mode: ${mode}`,
    '',
    `**Gate: ${gatePass ? 'PASS ✅' : 'FAIL ❌'}** — ${n} notes`,
    '',
    '| Metric | Value | Gate | Target | |',
    '|---|---|---|---|---|',
    ...metrics.map((m) => `| ${m[0]} | ${m[1]} | ${m[2]} | ${m[3]} | ${m[4] ? '✅' : '❌'} |`),
    '',
    '## Per note',
    '',
    '| Note | Intent | Trigger types | Questions | Latency |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '_semantic_recall here is a keyword proxy. The real metric embeds query + note and checks top-5 — run it once embeddings are wired (needs GEMINI_KEY)._',
  ].join('\n');

  writeFileSync(reportPath, md, 'utf8');
  console.log(md);
  process.exit(gatePass ? 0 : 1);
}

void main();
