import { describe, it, expect } from 'vitest';
import { SafetyChecker } from './safety-checker.js';
import { QualificationPipeline } from './pipeline.js';
import { ImageCandidate } from '../types/candidate.js';

describe('Qualification Module', () => {
  const mockCandidate: ImageCandidate = {
    id: '1',
    provider: 'unsplash',
    url: 'https://images.unsplash.com/123.jpg',
    thumbnailUrl: 'thumb.jpg',
    width: 2000,
    height: 1500,
    photographer: 'John Doe',
    photoUrl: 'photo.url',
    description: 'A beautiful sunset on the beach',
  };

  describe('SafetyChecker', () => {
    const checker = new SafetyChecker();

    it('should pass a valid candidate', () => {
      expect(checker.check(mockCandidate)).toBe(100);
    });

    it('should NOT fail candidates with small dimensions anymore', () => {
      const small = { ...mockCandidate, width: 1 };
      expect(checker.check(small)).toBe(100);
    });

    it('should fail candidates with invalid URLs', () => {
      const invalidUrl = { ...mockCandidate, url: 'invalid' };
      expect(checker.check(invalidUrl)).toBe(0);
    });

    it('should fail candidates with error patterns in description', () => {
      const errorCandidate = { ...mockCandidate, description: 'Error loading image' };
      expect(checker.check(errorCandidate)).toBe(0);
    });
  });

  describe('QualificationPipeline', () => {
    it('should compute a final score and return a QualifiedCandidate', async () => {
      const pipeline = new QualificationPipeline('landscape', 'sunset');
      const qualified = await pipeline.qualify(mockCandidate);

      expect(qualified.scores).toBeDefined();
      expect(typeof qualified.scores.final).toBe('number');
      expect(qualified.scores.final).toBeGreaterThan(0);
      expect(qualified.passesThreshold).toBeTypeOf('boolean');
    });

    it('should fail if relevance is below threshold even if final score is high', async () => {
      const pipeline = new QualificationPipeline('landscape', 'totally unrelated keyword');
      const lowRelevanceCandidate: ImageCandidate = {
        ...mockCandidate,
        description: 'something else entirely'
      };
      const qualified = await pipeline.qualify(lowRelevanceCandidate);
      
      if (qualified.scores.relevance < 50) {
        expect(qualified.passesThreshold).toBe(false);
        expect(qualified.reasons.some((r: string) => r.includes('Low relevance score'))).toBe(true);
      }
    });
  });
});

