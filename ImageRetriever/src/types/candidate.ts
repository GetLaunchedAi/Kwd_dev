export interface ImageCandidate {
  id: string;
  provider: 'unsplash' | 'google';
  url: string;              // Download URL
  thumbnailUrl: string;     // For preview
  width: number;
  height: number;
  photographer: string;
  photoUrl: string;         // Attribution link
  description?: string;
}

export interface QualifiedCandidate extends ImageCandidate {
  scores: {
    relevance: number;
    cropFit: number;
    quality: number;
    safety: number;
    final: number;
  };
  reasons: string[];
  passesThreshold: boolean;  // final >= 70
  aiVerified?: boolean;
  isBlurry?: boolean;
}
