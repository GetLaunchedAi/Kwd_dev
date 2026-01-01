import { ImageCandidate, QualifiedCandidate } from '../types/candidate.js';
import { RelevanceScorer } from './relevance-scorer.js';
import { CropFitScorer } from './crop-fit-scorer.js';
import { QualityScorer } from './quality-scorer.js';
import { SafetyChecker } from './safety-checker.js';
import { QUALIFICATION_CONFIG } from './config.js';

export class QualificationPipeline {
  private relevanceScorer = new RelevanceScorer();
  private cropFitScorer = new CropFitScorer();
  private qualityScorer = new QualityScorer();
  private safetyChecker = new SafetyChecker();

  constructor(
    private shape: 'landscape' | 'portrait' | 'square',
    private relatedText: string
  ) {}

  /**
   * Qualifies a single image candidate by running all scorers and computing a final weighted score.
   */
  async qualify(candidate: ImageCandidate): Promise<QualifiedCandidate> {
    const relevance = this.relevanceScorer.textScore(candidate, this.relatedText);
    const cropFit = this.cropFitScorer.score(candidate, this.shape);
    const quality = this.qualityScorer.score(candidate);
    const safety = this.safetyChecker.check(candidate);

    const final = this.calculateFinalScore(relevance, cropFit, safety);
    const { passesThreshold, reasons } = this.evaluateThresholds(relevance, cropFit, safety, final);

    return {
      ...candidate,
      scores: {
        relevance,
        cropFit,
        quality,
        safety,
        final,
      },
      reasons,
      passesThreshold,
    };
  }

  /**
   * Re-evaluates relevance using AI Vision and updates the candidate's scores.
   */
  async qualifyVisually(candidate: QualifiedCandidate): Promise<QualifiedCandidate> {
    const { score: visualRelevance, isBlurry } = await this.relevanceScorer.visualScore(candidate, this.relatedText);
    
    // Update relevance to visual score
    const relevance = visualRelevance;
    const cropFit = candidate.scores.cropFit;
    const safety = candidate.scores.safety;
    const quality = candidate.scores.quality;

    const final = this.calculateFinalScore(relevance, cropFit, safety);
    const { passesThreshold, reasons } = this.evaluateThresholds(relevance, cropFit, safety, final);

    return {
      ...candidate,
      scores: {
        relevance,
        cropFit,
        quality,
        safety,
        final,
      },
      reasons,
      passesThreshold,
      aiVerified: true,
      isBlurry
    };
  }

  private calculateFinalScore(relevance: number, cropFit: number, safety: number): number {
    const { weights } = QUALIFICATION_CONFIG;
    return Math.round(
      relevance * weights.relevance +
      cropFit * weights.cropFit +
      safety * weights.safety
    );
  }

  private evaluateThresholds(relevance: number, cropFit: number, safety: number, final: number) {
    const { thresholds } = QUALIFICATION_CONFIG;
    const reasons: string[] = [];
    if (relevance < thresholds.minRelevance) reasons.push(`Low relevance score: ${relevance} (min: ${thresholds.minRelevance})`);
    if (cropFit < 50) reasons.push(`Poor crop fit for ${this.shape}: ${cropFit}`);
    if (safety === 0) reasons.push('Failed safety check');

    // Requirement: Must pass crop check (50+), safety check (100), and meet relevance + final score
    const passesThreshold = final >= thresholds.finalScore && 
                           relevance >= thresholds.minRelevance && 
                           cropFit >= 50 && 
                           safety === 100;
    
    return { passesThreshold, reasons };
  }
}
