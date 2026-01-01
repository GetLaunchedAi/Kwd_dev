import { QualifiedCandidate } from './types/candidate.js';

export function selectBestCandidate(candidates: QualifiedCandidate[]): QualifiedCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  // Sort by final score descending
  const sorted = [...candidates].sort((a, b) => b.scores.final - a.scores.final);
  
  return sorted[0] || null;
}

