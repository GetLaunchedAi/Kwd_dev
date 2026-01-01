import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retrieveImage, ImagePickerInput } from './orchestrator.js';
import * as providersModule from './providers/index.js';
import * as downloaderModule from './downloader.js';
import * as manifestModule from './manifest.js';
import { RelevanceScorer } from './qualification/relevance-scorer.js';
import { QualifiedCandidate } from './types/candidate.js';

vi.mock('./downloader.js');
vi.mock('./manifest.js');
vi.mock('./providers/index.js');
vi.mock('./qualification/relevance-scorer.js');

describe('E2E Orchestration Flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    
    // Mock RelevanceScorer behavior
    vi.spyOn(RelevanceScorer.prototype, 'textScore').mockReturnValue(100);
    vi.spyOn(RelevanceScorer.prototype, 'visualScore').mockResolvedValue({ score: 100, isBlurry: false });
  });

  it('should successfully retrieve, qualify, and download an image', async () => {
    const mockCandidate = {
      id: '1',
      provider: 'unsplash' as const,
      url: 'https://example.com/image.jpg',
      thumbnailUrl: 'thumb.jpg',
      width: 2000,
      height: 1500,
      photographer: 'Author',
      photoUrl: 'link',
      description: 'sunset beach',
    };

    const mockProvider = {
      fetchCandidates: vi.fn().mockResolvedValue([mockCandidate]),
    };

    vi.mocked(providersModule.getProviders).mockReturnValue([mockProvider as any]);
    vi.mocked(downloaderModule.downloadImage).mockResolvedValue('test-image.jpg');
    vi.mocked(manifestModule.writeManifest).mockResolvedValue(undefined);

    const input: ImagePickerInput = {
      imageQuery: 'sunset',
      shape: 'landscape',
      relatedText: 'sunset beach',
      outputFolder: './output',
      maxTurns: 1,
    };

    const result = await retrieveImage(input);

    expect(result.selected).not.toBeNull();
    expect(result.selected?.provider).toBe('unsplash');
    expect(downloaderModule.downloadImage).toHaveBeenCalled();
    expect(manifestModule.writeManifest).toHaveBeenCalled();
  });

  it('should retry if no candidate passes threshold', async () => {
    const lowQualityCandidate = {
      id: '1',
      provider: 'unsplash' as const,
      url: 'https://example.com/image.jpg',
      thumbnailUrl: 'thumb.jpg',
      width: 100, // Very small, should fail safety/quality
      height: 100,
      photographer: 'Author',
      photoUrl: 'link',
      description: 'sunset beach',
    };

    const mockProvider = {
      fetchCandidates: vi.fn().mockResolvedValue([lowQualityCandidate]),
    };

    vi.mocked(providersModule.getProviders).mockReturnValue([mockProvider as any]);

    const input: ImagePickerInput = {
      imageQuery: 'sunset',
      shape: 'landscape',
      relatedText: 'beach vacation',
      outputFolder: './output',
      maxTurns: 2,
    };

    const result = await retrieveImage(input);

    expect(result.selected).toBeNull();
    expect(mockProvider.fetchCandidates).toHaveBeenCalledTimes(2);
    expect(downloaderModule.downloadImage).not.toHaveBeenCalled();
  });
});

