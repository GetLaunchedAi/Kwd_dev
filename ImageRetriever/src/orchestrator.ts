import { getProviders } from './providers/index.js';
import { QualificationPipeline } from './qualification/pipeline.js';
import { selectBestCandidate } from './comparator.js';
import { downloadImage } from './downloader.js';
import { writeManifest } from './manifest.js';
import { upscaleImage } from './utils/enhancer.js';
import { config } from './config.js';
import { QualifiedCandidate } from './types/candidate.js';
import path from 'path';

export interface ImagePickerInput {
  shape: 'landscape' | 'portrait' | 'square';
  relatedText: string;
  outputFolder: string;
  imageQuery: string;
  maxTurns?: number;
}

export interface RetrievalResult {
  selected: QualifiedCandidate | null;
  options: QualifiedCandidate[];
}

export async function retrieveImage(input: ImagePickerInput): Promise<RetrievalResult> {
  const providers = getProviders();
  const pipeline = new QualificationPipeline(input.shape, input.relatedText);
  const maxTurns = input.maxTurns || config.maxTurns;
  const candidatesPerProvider = 2;

  console.log(`Starting image retrieval for query: "${input.imageQuery}" (${input.shape})`);

  let allQualifiedCandidates: QualifiedCandidate[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    console.log(`\nTurn ${turn + 1}/${maxTurns}...`);

    // 1. Fetch candidates from all providers in parallel
    const providerPromises = providers.map(async (provider) => {
      try {
        return await provider.fetchCandidates(input.imageQuery, turn, candidatesPerProvider);
      } catch (error) {
        console.error(`Error fetching from ${provider.constructor.name}:`, error instanceof Error ? error.message : error);
        return [];
      }
    });

    const results = await Promise.all(providerPromises);
    const validCandidates = results.flat();

    if (validCandidates.length === 0) {
      console.log('No candidates found in this turn.');
      continue;
    }

    // 2. Qualify all candidates in parallel (Stage 1: Text-based)
    const stage1Candidates = await Promise.all(
      validCandidates.map((c) => pipeline.qualify(c))
    );

    // 3. AI Vision Verification (Stage 2: Visual-based)
    // All candidates from this turn go through the AI vision checker
    const candidatesToVerify = [...stage1Candidates];

    console.log(`AI Vision verification for all ${candidatesToVerify.length} candidates (sequentially to avoid rate limits)...`);
    const verifiedCandidates: QualifiedCandidate[] = [];
    let earlyAccepted: QualifiedCandidate | null = null;

    for (const c of candidatesToVerify) {
      const verified = await pipeline.qualifyVisually(c);
      verifiedCandidates.push(verified);
      
      if (verified.scores.relevance === 0) {
        console.warn(`AI Vision scoring failed or returned 0 for candidate ${c.id}`);
      } else {
        console.log(`AI Vision score for ${c.id}: ${verified.scores.relevance} (Final: ${verified.scores.final})`);
      }

      if (verified.scores.final >= 89 && verified.passesThreshold) {
        console.log(`Candidate ${c.id} reached auto-acceptance score (${verified.scores.final}). Stopping search.`);
        earlyAccepted = verified;
        break;
      }

      // Small pause if using free models to avoid 429s
      if (candidatesToVerify.length > 1 && verifiedCandidates.length < candidatesToVerify.length) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Create the final list for this turn: 
    // verified candidates replace their stage1 versions, others stay stage1
    const qualifiedCandidates = stage1Candidates.map(c => {
      const verified = verifiedCandidates.find(v => v.id === c.id);
      return verified || c;
    });

    allQualifiedCandidates.push(...qualifiedCandidates);

    // 4. Pick the best candidate from the current turn
    const best = earlyAccepted || selectBestCandidate(qualifiedCandidates);

    if (best) {
      if (best.aiVerified) {
        console.log(`Best candidate from turn ${turn + 1} (AI Verified): ${best.provider} (Score: ${best.scores.final})`);
      } else {
        console.log(`Best candidate from turn ${turn + 1}: ${best.provider} (Score: ${best.scores.final})`);
      }
      
      if (best.passesThreshold) {
        console.log(`Found a suitable match! Downloading...`);
        try {
          const filename = await downloadImage(best, input.outputFolder);
          const fullPath = path.join(input.outputFolder, filename);
          
          let finalFilename = filename;
          const needsEnhancement = best.isBlurry || best.width < 1200 || best.height < 800;
          if (needsEnhancement) {
            console.log(`Image needs enhancement (Blurry: ${best.isBlurry}, Size: ${best.width}x${best.height}). Running Upscayl...`);
            finalFilename = await upscaleImage(fullPath, input.outputFolder);
          }

          await writeManifest(best, input, finalFilename, turn + 1);
          console.log(`Successfully retrieved and saved image: ${finalFilename}`);
          
          // Prepare options: unique, sorted by score, limited to 20
          const uniqueOptions = Array.from(new Map(allQualifiedCandidates.map(c => [`${c.provider}-${c.id}`, c])).values())
            .sort((a, b) => b.scores.final - a.scores.final)
            .slice(0, 20);

          return {
            selected: { ...best, url: finalFilename },
            options: uniqueOptions
          };
        } catch (error) {
          console.error(`Failed to download best candidate:`, error instanceof Error ? error.message : error);
          // If download fails, we might want to try the next best candidate or continue to next turn
        }
      } else {
        console.log(`Best candidate (score: ${best.scores.final}) did not pass threshold (${70}).`);
      }
    }
  }

  console.log(`\nFailed to find a suitable image after ${maxTurns} turns.`);

  // Prepare options for failure case as well
  const uniqueOptions = Array.from(new Map(allQualifiedCandidates.map(c => [`${c.provider}-${c.id}`, c])).values())
    .sort((a, b) => b.scores.final - a.scores.final)
    .slice(0, 20);

  return {
    selected: null,
    options: uniqueOptions
  };
}

