import { describe, it, expect } from 'vitest';
import { RelevanceScorer } from './relevance-scorer.js';
import { ImageCandidate } from '../types/candidate.js';

describe('RelevanceScorer', () => {
  const scorer = new RelevanceScorer();

  it('should return a high score for similar text', () => {
    const candidate: Partial<ImageCandidate> = {
      description: 'A beautiful sunset over the ocean'
    };
    const relatedText = 'sunset over ocean';
    const score = scorer.textScore(candidate as ImageCandidate, relatedText);
    expect(score).toBeGreaterThan(50);
  });

  it('should return 0 if no related text is provided', () => {
    const candidate: Partial<ImageCandidate> = {
      description: 'A beautiful sunset over the ocean'
    };
    const score = scorer.textScore(candidate as ImageCandidate, '');
    expect(score).toBe(0);
  });

  it('should return 0 if candidate has no description', () => {
    const candidate: Partial<ImageCandidate> = {
      description: undefined
    };
    const score = scorer.textScore(candidate as ImageCandidate, 'sunset');
    expect(score).toBe(0);
  });
});

