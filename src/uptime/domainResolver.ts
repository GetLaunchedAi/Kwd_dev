import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Normalizes a domain string to a full URL for monitoring.
 * 
 * Rules:
 * - If protocol missing -> assume https://
 * - Strip trailing spaces
 * - Preserve path if present
 */
export function normalizeDomainToUrl(domain: string): string {
  if (!domain) return '';
  
  let trimmed = domain.trim();
  if (!trimmed) return '';

  // If it already has a protocol, just return it
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  // Otherwise assume https
  return `https://${trimmed}`;
}

/**
 * Finds the client.json file for a given site slug and returns the domain URL.
 */
export async function resolveSiteUrl(siteSlug: string): Promise<string | null> {
  // The path in the plan was client-websites/<slug>/src/_data/client.json
  // But let's be safe and check if it exists
  const possiblePaths = [
    path.join(process.cwd(), 'client-websites', siteSlug, 'src', '_data', 'client.json'),
    path.join(process.cwd(), 'client-websites', siteSlug, 'client.json') // fallback
  ];

  for (const p of possiblePaths) {
    if (await fs.pathExists(p)) {
      try {
        const data = await fs.readJson(p);
        if (data.domain) {
          return normalizeDomainToUrl(data.domain);
        }
      } catch (err) {
        // Log error but continue
      }
    }
  }

  return null;
}




