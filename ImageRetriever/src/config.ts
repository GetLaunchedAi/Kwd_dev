import dotenv from 'dotenv';

dotenv.config();

export interface GlobalConfig {
  unsplashAccessKey: string;
  googleApiKey: string;
  googleCx: string;
  openrouterApiKey: string;
  maxTurns: number;
  defaultOutputFolder: string;
  upscaylPath: string;
  upscaylModel: string;
}

export const config: GlobalConfig = {
  unsplashAccessKey: process.env.UNSPLASH_ACCESS_KEY || '',
  googleApiKey: process.env.GOOGLE_API_KEY || '',
  googleCx: process.env.GOOGLE_CX || '',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  maxTurns: parseInt(process.env.MAX_TURNS || '5', 10),
  defaultOutputFolder: process.env.OUTPUT_FOLDER || './downloads',
  upscaylPath: process.env.UPSCAYL_PATH || 'upscayl',
  upscaylModel: process.env.UPSCAYL_MODEL || 'realesrgan-x4plus',
};

if (!config.unsplashAccessKey || !config.googleApiKey || !config.googleCx || !config.openrouterApiKey) {
  console.warn('Warning: One or more API keys are missing from environment variables.');
}

