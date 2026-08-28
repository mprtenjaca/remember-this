// When the app has to GUESS a deadline, it says so and offers a one-tap correction.
//
// A note with no time at all still gets a reminder — a note that looks filed with nothing scheduled is this
// project's characteristic failure. But the guess used to be silent, and "~6 months" is a reasonable rhythm
// for a car service and a coin toss for a one-off eye examination. So: guess either way, and ask ONLY when
// the category has no real rhythm behind it.

import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import { ingest, fallbackNeedsAsking } from './ingest';
import { heuristicEnrich } from './heuristic';
import { FakeClock } from '../clock';
import type { Anchor } from '../types';

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = local(2026, 8, 28, 12, 0);

const rctx = (anchors: Anchor[] = []) => ({ now: NOW, anchors, uiLang: 'hr' as const });
const ictx = (anchors: Anchor[] = []) => ({ existingTriggers: [], anchors, prefs: {}, clock: new FakeClock(NOW), uiLang: 'hr' as const });

/** The whole pipeline the app runs: heuristic → reconcile → ingest. */
const run = (text: string) => ingest(reconcile(heuristicEnrich(text, { now: NOW, anchors: [] }), text, rctx()), ictx());

const intervalQ = (text: string) => run(text).questions.find((q) => q.kind === 'interval') ?? null;
const timeDraft = (text: string) => run(text).drafts.find((d) => d.type === 'time') ?? null;

describe('fallbackNeedsAsking', () => {
  it('stays silent for categories with a real rhythm', () => {
    expect(fallbackNeedsAsking('auto_servis', 'servis auta')).toBe(false);
    expect(fallbackNeedsAsking('frizer', 'frizer')).toBe(false);
  });

  // "kontrola kod zubara" is a recurring appointment — 6 months is the rhythm, not a guess.
  it('stays silent for a routine health check-up', () => {
    expect(fallbackNeedsAsking('zdravlje', 'kontrola kod zubara za protezu')).toBe(false);
    expect(fallbackNeedsAsking('zdravlje', 'redovni pregled')).toBe(false);
    expect(fallbackNeedsAsking('zdravlje', 'godišnji sistematski')).toBe(false);
  });

  // A one-off examination has no cycle at all: it might be next month or in two years.
  it('asks for a one-off health note', () => {
    expect(fallbackNeedsAsking('zdravlje', 'veliki pregled kod oftalmologa oči i astigmatizam')).toBe(true);
  });

  it('asks when there is no category to reason from', () => {
    expect(fallbackNeedsAsking(null, 'nešto')).toBe(true);
  });

  it('reads the wording without diacritics', () => {
    expect(fallbackNeedsAsking('zdravlje', 'kontrola kod zubara')).toBe(false);
    expect(fallbackNeedsAsking('zdravlje', 'godisnji pregled')).toBe(false);
  });
});

describe('the guess is always written, question or not', () => {
  // The invariant that outranks the question: skipping it must never leave a note with no reminder.
  it('schedules the fallback for a one-off examination', () => {
    const d = timeDraft('veliki pregled kod oftalmologa oči i astigmatizam');
    expect(d?.fireAt).toBeGreaterThan(NOW);
    expect(d?.certainty).toBeLessThan(0.5); // shows as "nisam siguran"
  });

  it('schedules the fallback for a car service too', () => {
    expect(timeDraft('mali servis za auto')?.fireAt).toBeGreaterThan(NOW);
  });
});

describe('the correction offer', () => {
  it('offers three intervals for a one-off examination', () => {
    const q = intervalQ('veliki pregled kod oftalmologa oči i astigmatizam');
    expect(q).not.toBeNull();
    expect(q!.options).toEqual(['za 3 mj', 'za 6 mj', 'za godinu']);
    expect(q!.optionMonths).toEqual([3, 6, 12]);
  });

  it('names the guess in the question, so the offer explains itself', () => {
    expect(intervalQ('veliki pregled kod oftalmologa')?.text).toContain('~6');
  });

  // Marko's case: a denture check-up is a rhythm, so it is filed silently.
  it('does not ask about "kontrola kod zubara za protezu"', () => {
    expect(intervalQ('kontrola kod zubara za protezu')).toBeNull();
    expect(timeDraft('kontrola kod zubara za protezu')?.fireAt).toBeGreaterThan(NOW);
  });

  it('does not ask about a car service', () => {
    expect(intervalQ('mali servis za auto')).toBeNull();
  });

  // A note that already states a time has nothing to correct.
  it('does not ask when the note names its own date', () => {
    expect(intervalQ('pregled kod oftalmologa 15.9.')).toBeNull();
    expect(intervalQ('za 3 mjeseca pregled kod oftalmologa')).toBeNull();
  });

  it('keeps the two-question cap', () => {
    const out = run('veliki pregled kod oftalmologa oči i astigmatizam');
    expect(out.questions.length).toBeLessThanOrEqual(2);
  });

  // An interval answer moves a trigger; an 'options' answer is only kept as a keyword. Mislabelling it would
  // clear the question and change nothing — the silent failure again.
  it('is an interval question, never a plain options one', () => {
    const q = intervalQ('veliki pregled kod oftalmologa');
    expect(q?.kind).toBe('interval');
    expect(q?.optionMonths).toHaveLength(3);
  });
});
