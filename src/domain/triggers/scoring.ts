import type { Reaction } from '../types';

export const FATIGUE = {
  maxPushPerDay: 2,
  quietHours: [21, 8] as const, // [start, end) — no pushes from 21:00 until 08:00
  maxFiresPerNote: 3,
  cooldownDays: [7, 30, Infinity] as const,
  fatiguePenaltyDays: 7,
  fatiguePenalty: 0.3,
} as const;

export interface ScoreInput {
  cosine: number; // 0..1 semantic similarity
  certainty: number; // 0..1 from trigger
  recencyRelevance: number; // 0..1, old future_need notes grow
  categoryFeedback: number; // −1..1 from surfacings.reaction on the category
  fatiguePenalty: number; // 0 or FATIGUE.fatiguePenalty
}

export function relevanceScore(n: ScoreInput): number {
  return 0.55 * n.cosine + 0.2 * n.certainty + 0.15 * n.recencyRelevance + 0.1 * n.categoryFeedback - n.fatiguePenalty;
}

/**
 * Notes about future needs become MORE relevant as they age (up to ~6 months),
 * then plateau. Tasks/facts do not grow.
 */
export function recencyRelevance(ageMs: number, intent: string | null): number {
  const months = ageMs / (30 * 86_400_000);
  if (intent === 'future_need' || intent === 'idea') return Math.min(1, 0.4 + months / 10);
  return Math.max(0.2, 1 - months / 12);
}

export const THRESHOLD = {
  initial: 0.62,
  min: 0.45,
  max: 0.85,
  onWrong: 0.05, // surfaced noise → raise the bar (the costly mistake)
  onUseful: 0.03, // surfaced correctly → be slightly more generous
  onNotNow: 0.01,
} as const;

/**
 * Adaptive semantic threshold, persisted in prefs as 'threshold.semantic'.
 * 👎 raises the bar more than 👍 lowers it — "better to miss than to falsely call".
 * Clamp [0.45, 0.85].
 */
export function adjustThreshold(current: number, reaction: Reaction): number {
  let next = current;
  if (reaction === 'useful' || reaction === 'done') next -= THRESHOLD.onUseful;
  else if (reaction === 'wrong') next += THRESHOLD.onWrong;
  else if (reaction === 'not_now') next += THRESHOLD.onNotNow;
  return Math.min(THRESHOLD.max, Math.max(THRESHOLD.min, Number(next.toFixed(3))));
}

export function categoryFeedbackScore(reactions: Reaction[]): number {
  if (reactions.length === 0) return 0;
  let sum = 0;
  for (const r of reactions) {
    if (r === 'useful' || r === 'done') sum += 1;
    else if (r === 'wrong') sum -= 1;
    else if (r === 'not_now') sum -= 0.25;
  }
  return Math.max(-1, Math.min(1, sum / reactions.length));
}
