import { ImageCandidate } from '../types/candidate.js';
import { QUALIFICATION_CONFIG } from './config.js';

export class CropFitScorer {
  /**
   * Scores how well the candidate's aspect ratio matches the requested shape.
   * Returns a score between 0 and 100.
   */
  score(candidate: ImageCandidate, shape: 'landscape' | 'portrait' | 'square'): number {
    const aspectRatio = candidate.width / candidate.height;

    switch (shape) {
      case 'landscape':
        // Prefer width/height > 1.2
        if (aspectRatio >= QUALIFICATION_CONFIG.aspectRatios.landscape) return 100;
        if (aspectRatio > 1.0) return 70;
        return 30;

      case 'portrait':
        // Prefer width/height < 0.8
        if (aspectRatio <= QUALIFICATION_CONFIG.aspectRatios.portrait) return 100;
        if (aspectRatio < 1.0) return 70;
        return 30;

      case 'square':
        // Prefer 0.9 < width/height < 1.1
        const { min, max } = QUALIFICATION_CONFIG.aspectRatios.square;
        if (aspectRatio >= min && aspectRatio <= max) return 100;
        
        const diff = Math.abs(1 - aspectRatio);
        if (diff < 0.3) return 70;
        return 30;

      default:
        return 0;
    }
  }
}

