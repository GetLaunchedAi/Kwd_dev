import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import axios from 'axios';
import { downloadImage } from './downloader.js';
import { writeManifest } from './manifest.js';
import { QualifiedCandidate } from './types/candidate.js';
import { Stream } from 'stream';

vi.mock('fs');
vi.mock('fs/promises');
vi.mock('axios');

describe('Orchestration Helpers', () => {
  const mockCandidate: QualifiedCandidate = {
    id: '123',
    provider: 'unsplash',
    url: 'https://example.com/image.jpg',
    thumbnailUrl: 'thumb.jpg',
    width: 1000,
    height: 800,
    photographer: 'Author',
    photoUrl: 'link',
    description: 'desc',
    scores: {
      relevance: 80,
      cropFit: 90,
      quality: 85,
      safety: 100,
      final: 88,
    },
    passesThreshold: true,
    reasons: [],
  };

  describe('downloadImage', () => {
    it('should download and save an image', async () => {
      const mockStream = new Stream.Readable();
      mockStream._read = () => {
        mockStream.push(null); // End of stream
      };
      
      const mockWriter = new Stream.Writable();
      (mockWriter as any).close = vi.fn();
      
      vi.mocked(axios).mockResolvedValueOnce({ data: mockStream });
      vi.mocked(fs.createWriteStream).mockReturnValueOnce(mockWriter as any);
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const downloadPromise = downloadImage(mockCandidate, './output');
      
      // We need to trigger the close event on the writer
      // In a real pipe, this happens when the source ends and the destination closes.
      setImmediate(() => {
        mockWriter.emit('close');
      });

      const filename = await downloadPromise;
      expect(filename).toBe('unsplash-123.jpg');
      expect(fs.createWriteStream).toHaveBeenCalled();
    });
  });

  describe('writeManifest', () => {
    it('should write a manifest file', async () => {
      const input = {
        imageQuery: 'test query',
        shape: 'landscape' as const,
        relatedText: 'context',
        outputFolder: './output',
      };

      await writeManifest(mockCandidate, input, 'test.jpg', 1);

      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('test.json'),
        expect.stringContaining('"query": "test query"'),
        'utf-8'
      );
    });
  });
});

