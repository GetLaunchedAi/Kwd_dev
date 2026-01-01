#!/usr/bin/env node
import { Command } from 'commander';
import { retrieveImage, ImagePickerInput } from './orchestrator.js';
import { config } from './config.js';
import * as path from 'path';

const program = new Command();

program
  .name('image-retriever')
  .description('A tool to retrieve and qualify images from multiple providers')
  .version('1.0.0');

program
  .requiredOption('-q, --query <string>', 'search query for providers')
  .requiredOption('-s, --shape <type>', 'desired image shape (landscape, portrait, square)')
  .requiredOption('-c, --context <string>', 'related text for relevance scoring')
  .option('-o, --output <path>', 'where to save the image', config.defaultOutputFolder)
  .option('-t, --turns <number>', 'maximum number of retrieval turns', config.maxTurns.toString())
  .action(async (options) => {
    const input: ImagePickerInput = {
      imageQuery: options.query,
      shape: options.shape as 'landscape' | 'portrait' | 'square',
      relatedText: options.context,
      outputFolder: path.resolve(options.output),
      maxTurns: parseInt(options.turns, 10),
    };

    if (!['landscape', 'portrait', 'square'].includes(input.shape)) {
      console.error('Error: Invalid shape. Must be one of: landscape, portrait, square');
      process.exit(1);
    }

    try {
      const result = await retrieveImage(input);
      if (result) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    } catch (error) {
      console.error('An unexpected error occurred:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program.parse();

