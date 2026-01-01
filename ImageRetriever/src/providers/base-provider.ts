import { ImageCandidate } from '../types/candidate.js';

export interface BaseProvider {
  /**
   * Fetches candidate images based on a query and turn.
   * @param query The search query.
   * @param turn The turn number for pagination.
   * @param count The number of candidates to fetch.
   * @returns A promise that resolves to an array of ImageCandidates.
   */
  fetchCandidates(query: string, turn: number, count: number): Promise<ImageCandidate[]>;
}

