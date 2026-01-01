import axios from 'axios';
import { BaseProvider } from './base-provider.js';
import { ImageCandidate } from '../types/candidate.js';
import dotenv from 'dotenv';

dotenv.config();

export class GoogleClient implements BaseProvider {
  private readonly apiKey: string;
  private readonly cx: string;
  private readonly baseUrl = 'https://www.googleapis.com/customsearch/v1';

  constructor() {
    this.apiKey = process.env['GOOGLE_API_KEY'] || '';
    this.cx = process.env['GOOGLE_CX'] || '';
    if (!this.apiKey || !this.cx) {
      console.warn('Google API key or Search Engine ID (CX) is missing. Google provider will not work.');
    }
  }

  async fetchCandidates(query: string, turn: number, count: number): Promise<ImageCandidate[]> {
    if (!this.apiKey || !this.cx) return [];

    try {
      // Google Custom Search uses 'start' for pagination (1-indexed).
      // 'num' can be at most 10.
      const num = Math.min(count, 10);
      const start = turn * num + 1;

      const response = await axios.get(this.baseUrl, {
        params: {
          key: this.apiKey,
          cx: this.cx,
          q: `${query} -site:pixabay.com`,
          searchType: 'image',
          num: num,
          start: start,
        },
      });

      const items = response.data.items || [];
      return items.map((item: any, index: number) => ({
        id: `google-${start}-${index}`,
        provider: 'google',
        url: item.link,
        thumbnailUrl: item.image?.thumbnailLink || item.link,
        width: item.image?.width || 0,
        height: item.image?.height || 0,
        photographer: item.displayLink || 'Google Search',
        photoUrl: item.image?.contextLink || item.link,
        description: item.title,
      }));
    } catch (error) {
      console.error('Error fetching from Google:', error instanceof Error ? (error as any).response?.data?.error?.message || error.message : error);
      return [];
    }
  }
}

