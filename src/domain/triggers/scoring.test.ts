import { describe, it, expect } from 'vitest';
import { relevanceScore, adjustThreshold, THRESHOLD, recencyRelevance, categoryFeedbackScore, FATIGUE } from './scoring';

describe('relevanceScore', () => {
  it('weights cosine most heavily', () => {
    const base = { certainty: 0.5, recencyRelevance: 0.5, categoryFeedback: 0, fatiguePenalty: 0 };
    expect(relevanceScore({ ...base, cosine: 0.9 })).toBeGreaterThan(relevanceScore({ ...base, cosine: 0.5 }));
    expect(relevanceScore({ cosine: 1, certainty: 1, recencyRelevance: 1, categoryFeedback: 1, fatiguePenalty: 0 })).toBeCloseTo(1);
  });
  it('fatigue penalty subtracts directly', () => {
    const a = { cosine: 0.8, certainty: 0.6, recencyRelevance: 0.5, categoryFeedback: 0, fatiguePenalty: 0 };
    expect(relevanceScore(a) - relevanceScore({ ...a, fatiguePenalty: FATIGUE.fatiguePenalty })).toBeCloseTo(0.3);
  });
});

describe('adjustThreshold', () => {
  it('👎 raises, 👍 lowers, clamped', () => {
    expect(adjustThreshold(THRESHOLD.initial, 'wrong')).toBeCloseTo(0.67);
    expect(adjustThreshold(THRESHOLD.initial, 'useful')).toBeCloseTo(0.59);
    expect(adjustThreshold(0.84, 'wrong')).toBe(THRESHOLD.max);
    expect(adjustThreshold(0.46, 'useful')).toBe(THRESHOLD.min);
    expect(adjustThreshold(0.6, 'ignored')).toBe(0.6);
  });
});

describe('recencyRelevance', () => {
  it('future_need grows with age, task decays', () => {
    const m = 30 * 86_400_000;
    expect(recencyRelevance(6 * m, 'future_need')).toBeGreaterThan(recencyRelevance(0, 'future_need'));
    expect(recencyRelevance(6 * m, 'task')).toBeLessThan(recencyRelevance(0, 'task'));
    expect(recencyRelevance(100 * m, 'future_need')).toBeLessThanOrEqual(1);
  });
});

describe('categoryFeedbackScore', () => {
  it('averages reactions into [−1, 1]', () => {
    expect(categoryFeedbackScore([])).toBe(0);
    expect(categoryFeedbackScore(['useful', 'useful'])).toBe(1);
    expect(categoryFeedbackScore(['wrong', 'useful'])).toBe(0);
    expect(categoryFeedbackScore(['wrong'])).toBe(-1);
  });
});
