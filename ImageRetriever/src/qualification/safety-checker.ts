import { ImageCandidate } from '../types/candidate.js';
import { QUALIFICATION_CONFIG } from './config.js';

export class SafetyChecker {
  /**
   * Basic safety filters.
   * Returns a score between 0 and 100.
   */
  check(candidate: ImageCandidate): number {
    // Check if the URL seems valid (very basic)
    if (!candidate.url || !candidate.url.startsWith('http')) {
      return 0;
    }

    // Check for common error placeholder patterns in descriptions or URLs
    const errorPatterns = [/error/i, /placeholder/i, /not found/i, /404/i];
    const textToMatch = `${candidate.description || ''} ${candidate.url}`.toLowerCase();
    
    if (errorPatterns.some(pattern => pattern.test(textToMatch))) {
      return 0;
    }

    // If all basic checks pass, return 100
    return 100;
  }
}

