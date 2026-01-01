import { describe, it, expect } from 'vitest';
import { CropFitScorer } from './crop-fit-scorer.js';
import { ImageCandidate } from '../types/candidate.js';

describe('CropFitScorer', () => {
  const scorer = new CropFitScorer();

  it('should return 100 for a perfect landscape', () => {
    const candidate: Partial<ImageCandidate> = { width: 1920, height: 1080 }; // ratio 1.77
    const score = scorer.score(candidate as ImageCandidate, 'landscape');
    expect(score).toBe(100);
  });

  it('should return 100 for a perfect portrait', () => {
    const candidate: Partial<ImageCandidate> = { width: 1080, height: 1920 }; // ratio 0.56
    const score = scorer.score(candidate as ImageCandidate, 'portrait');
    expect(score).toBe(100);
  });

  it('should return 100 for a perfect square', () => {
    const candidate: Partial<ImageCandidate> = { width: 1000, height: 1000 };
    const score = scorer.score(candidate as ImageCandidate, 'square');
    expect(score).toBe(100);
  });

  it('should return a lower score for a mismatching shape', () => {
    const candidate: Partial<ImageCandidate> = { width: 1920, height: 1080 };
    const score = scorer.score(candidate as ImageCandidate, 'portrait');
    expect(score).toBe(30);
  });
});

