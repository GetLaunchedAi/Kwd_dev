import { BaseProvider } from './base-provider.js';
import { UnsplashClient } from './unsplash-client.js';
import { GoogleClient } from './google-client.js';

export * from './base-provider.js';
export * from './unsplash-client.js';
export * from './google-client.js';

/**
 * Registry of available providers.
 */
export function getProviders(): BaseProvider[] {
  return [
    new UnsplashClient(),
    new GoogleClient(),
  ];
}

