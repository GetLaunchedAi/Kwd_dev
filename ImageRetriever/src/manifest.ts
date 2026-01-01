import * as fs from 'fs/promises';
import * as path from 'path';
import { QualifiedCandidate } from './types/candidate.js';

export interface ManifestData {
  query: string;
  shape: string;
  relatedText: string;
  provider: string;
  photographer: string;
  photoUrl: string;
  filename: string;
  dimensions: { width: number; height: number };
  scores: {
    relevance: number;
    cropFit: number;
    quality: number;
    safety: number;
    final: number;
  };
  turnNumber: number;
  downloadedAt: string;
}

export async function writeManifest(
  candidate: QualifiedCandidate,
  input: { imageQuery: string; shape: string; relatedText: string; outputFolder: string },
  filename: string,
  turnNumber: number
): Promise<void> {
  const manifestPath = path.join(input.outputFolder, `${path.parse(filename).name}.json`);

  const manifest: ManifestData = {
    query: input.imageQuery,
    shape: input.shape,
    relatedText: input.relatedText,
    provider: candidate.provider,
    photographer: candidate.photographer,
    photoUrl: candidate.photoUrl,
    filename,
    dimensions: {
      width: candidate.width,
      height: candidate.height,
    },
    scores: candidate.scores,
    turnNumber,
    downloadedAt: new Date().toISOString(),
  };

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`Manifest written to ${manifestPath}`);
}

