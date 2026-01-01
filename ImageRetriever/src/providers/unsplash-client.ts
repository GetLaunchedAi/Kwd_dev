import axios from 'axios';
import { BaseProvider } from './base-provider.js';
import { ImageCandidate } from '../types/candidate.js';
import dotenv from 'dotenv';

dotenv.config();

export class UnsplashClient implements BaseProvider {
  private readonly accessKey: string;
  private readonly baseUrl = 'https://api.unsplash.com';

  constructor() {
    this.accessKey = process.env['UNSPLASH_ACCESS_KEY'] || '';
    if (!this.accessKey) {
      console.warn('Unsplash access key is missing. Unsplash provider will not work.');
    }
  }

  async fetchCandidates(query: string, turn: number, count: number): Promise<ImageCandidate[]> {
    if (!this.accessKey) return [];

    try {
      const response = await axios.get(`${this.baseUrl}/search/photos`, {
        params: {
          query,
          per_page: count,
          page: turn + 1, // API pages are 1-indexed
        },
        headers: {
          Authorization: `Client-ID ${this.accessKey}`,
        },
      });

      const photos = response.data.results || [];
      return photos.map((photo: any) => ({
        id: photo.id,
        provider: 'unsplash',
        url: photo.urls.full,
        thumbnailUrl: photo.urls.small,
        width: photo.width,
        height: photo.height,
        photographer: photo.user.name,
        photoUrl: photo.links.html,
        description: photo.description || photo.alt_description,
      }));
    } catch (error) {
      console.error('Error fetching from Unsplash:', error instanceof Error ? error.message : error);
      return [];
    }
  }
}

