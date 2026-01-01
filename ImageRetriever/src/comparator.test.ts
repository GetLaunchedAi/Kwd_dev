import { describe, it, expect } from 'vitest';
import { selectBestCandidate } from './comparator.js';
import { QualifiedCandidate } from './types/candidate.js';

describe('selectBestCandidate', () => {
  it('should return the candidate with the highest final score', () => {
    const candidates: Partial<QualifiedCandidate>[] = [
      { provider: 'unsplash', scores: { final: 50, relevance: 50, cropFit: 50, quality: 50, safety: 100 } },
      { provider: 'google', scores: { final: 90, relevance: 90, cropFit: 90, quality: 90, safety: 100 } }
    ];

    const best = selectBestCandidate(candidates as QualifiedCandidate[]);
    expect(best?.provider).toBe('google');
    expect(best?.scores.final).toBe(90);
  });

  it('should return null for an empty array', () => {
    const best = selectBestCandidate([]);
    expect(best).toBeNull();
  });
});

