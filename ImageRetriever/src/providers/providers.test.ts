import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { UnsplashClient } from './unsplash-client.js';

vi.mock('axios');

describe('Provider Clients', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env['UNSPLASH_ACCESS_KEY'] = 'test-unsplash-key';
  });

  describe('UnsplashClient', () => {
    it('should fetch and normalize candidates from Unsplash', async () => {
      const client = new UnsplashClient();
      const mockResponse = {
        data: {
          results: [
            {
              id: 'abc',
              urls: { full: 'full-url', small: 'small-url' },
              width: 1200,
              height: 900,
              user: { name: 'Unsplash User' },
              links: { html: 'html-link' },
              description: 'Unsplash desc',
            },
          ],
        },
      };
      vi.mocked(axios.get).mockResolvedValueOnce(mockResponse);

      const candidates = await client.fetchCandidates('test', 0, 1);

      expect(candidates[0]).toEqual({
        id: 'abc',
        provider: 'unsplash',
        url: 'full-url',
        thumbnailUrl: 'small-url',
        width: 1200,
        height: 900,
        photographer: 'Unsplash User',
        photoUrl: 'html-link',
        description: 'Unsplash desc',
      });
    });
  });
});

