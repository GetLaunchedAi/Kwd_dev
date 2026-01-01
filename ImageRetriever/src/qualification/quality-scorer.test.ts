import { describe, it, expect } from 'vitest';
import { QualityScorer } from './quality-scorer.js';
import { ImageCandidate } from '../types/candidate.js';

describe('QualityScorer', () => {
  const scorer = new QualityScorer();

  it('should return 100 for high resolution images', () => {
    const candidate: Partial<ImageCandidate> = { width: 3840, height: 2160 };
    const score = scorer.score(candidate as ImageCandidate);
    expect(score).toBe(100);
  });

  it('should return 20 for very low resolution images', () => {
    const candidate: Partial<ImageCandidate> = { width: 100, height: 100 };
    const score = scorer.score(candidate as ImageCandidate);
    expect(score).toBe(20);
  });

  it('should return a mid-range score for medium resolution images', () => {
    const candidate: Partial<ImageCandidate> = { width: 1280, height: 720 };
    const score = scorer.score(candidate as ImageCandidate);
    expect(score).toBeGreaterThan(20);
    expect(score).toBeLessThan(100);
  });
});

