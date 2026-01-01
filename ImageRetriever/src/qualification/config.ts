export const QUALIFICATION_CONFIG = {
  thresholds: {
    finalScore: 70,
    minWidth: 1,
    minHeight: 1,
    minRelevance: 50,
  },
  weights: {
    relevance: 0.40,
    cropFit: 0.35,
    quality: 0,
    safety: 0.25,
  },
  aspectRatios: {
    landscape: 1.2,
    portrait: 0.8,
    square: {
      min: 0.9,
      max: 1.1,
    }
  }
};

