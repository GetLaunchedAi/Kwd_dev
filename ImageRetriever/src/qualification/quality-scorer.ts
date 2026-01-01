import { ImageCandidate } from '../types/candidate.js';

export class QualityScorer {
  /**
   * Scores based on resolution.
   * Returns a score between 0 and 100.
   */
  score(candidate: ImageCandidate): number {
    const { width, height } = candidate;
    const totalPixels = width * height;

    // Ideal resolution (e.g., 1920x1080 or better)
    const idealPixels = 1920 * 1080;

    if (totalPixels >= idealPixels) return 100;
    
    // Minimum acceptable pixels (e.g., 800x600)
    const minPixels = 800 * 600;
    
    if (totalPixels < minPixels) return 20;

    // Linear scaling between min and ideal
    const score = 20 + ((totalPixels - minPixels) / (idealPixels - minPixels)) * 80;
    return Math.round(score);
  }
}

