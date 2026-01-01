import * as fs from 'fs-extra';
import * as path from 'path';
import { ClickUpTask } from '../clickup/apiClient';
import { config } from '../config/config';
import { logger } from './logger';
import { findClientFolder } from '../git/repoManager';
import { getClientMapping, checkPatternMappings } from './clientMappingManager';

export interface ExtractionResult {
  clientName: string | null;
  confidence: 'high' | 'medium' | 'low';
  suggestions?: string[];
  validated?: boolean;
  method?: 'manual' | 'pattern' | 'extracted' | 'folder';
}

/**
 * Gets all available client folder names for validation
 */
async function getAvailableClientFolders(): Promise<string[]> {
  try {
    const githubCloneAllDir = path.resolve(config.git.githubCloneAllDir || '');
    if (!fs.existsSync(githubCloneAllDir)) {
      return [];
    }
    
    const entries = await fs.readdir(githubCloneAllDir, { withFileTypes: true });
    return entries
      .filter((entry: any) => entry.isDirectory())
      .map((entry: any) => entry.name);
  } catch (error: any) {
    logger.warn(`Error getting client folders: ${error.message}`);
    return [];
  }
}

/**
 * Calculates Levenshtein distance between two strings for fuzzy matching
 */
function levenshteinDistance(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  const matrix: number[][] = [];

  for (let i = 0; i <= s2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= s1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s2.length; i++) {
    for (let j = 1; j <= s1.length; j++) {
      if (s2[i - 1] === s1[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[s2.length][s1.length];
}

/**
 * Finds closest matching client folder names using fuzzy matching
 */
async function findClosestMatches(extractedName: string, maxResults: number = 5): Promise<string[]> {
  const availableFolders = await getAvailableClientFolders();
  if (availableFolders.length === 0) {
    return [];
  }

  const matches = availableFolders.map(folder => ({
    folder,
    distance: levenshteinDistance(extractedName, folder),
    similarity: 1 - (levenshteinDistance(extractedName, folder) / Math.max(extractedName.length, folder.length))
  }));

  // Sort by similarity (highest first) and return top matches
  matches.sort((a, b) => b.similarity - a.similarity);
  
  // Filter matches with at least 50% similarity
  const goodMatches = matches
    .filter(m => m.similarity >= 0.5)
    .slice(0, maxResults)
    .map(m => m.folder);

  return goodMatches;
}

/**
 * Validates extracted client name against actual folder structure
 */
async function validateClientName(clientName: string): Promise<{ isValid: boolean; actualName?: string }> {
  const folderInfo = await findClientFolder(clientName);
  if (folderInfo && folderInfo.isValid) {
    return { isValid: true, actualName: folderInfo.name };
  }
  return { isValid: false };
}

/**
 * Enhanced extraction with improved patterns and fuzzy matching
 */
async function extractWithEnhancedPatterns(taskName: string): Promise<string | null> {
  // Enhanced patterns with more variations
  const patterns = [
    // Pattern: "for ClientName", "in ClientName", "to ClientName", "from ClientName"
    /(?:for|in|to|from|with|at)\s+([A-Z][a-zA-Z0-9\-]+(?:\s+[A-Z][a-zA-Z0-9\-]+)*)/g,
    // Pattern: "Client: ClientName", "Project: ClientName", etc.
    /(?:client|project|repo|website|customer|account)[\s:]+([A-Z][a-zA-Z0-9\-]+(?:\s+[A-Z][a-zA-Z0-9\-]+)*)/gi,
    // Pattern: "ClientName website", "ClientName site", etc.
    /([A-Z][a-zA-Z0-9\-]+(?:\s+[A-Z][a-zA-Z0-9\-]+)*)\s+(?:website|site|web|project|app|repo|repository)/gi,
    // Pattern: "Update ClientName", "Fix ClientName", etc.
    /(?:update|fix|create|build|develop|design|implement|improve|enhance|refactor|add|remove|change|modify)\s+([A-Z][a-zA-Z0-9\-]+(?:\s+[A-Z][a-zA-Z0-9\-]+)*)/gi,
    // Pattern: "ClientName - Description" or "ClientName: Description"
    /^([A-Z][a-zA-Z0-9\-]+(?:\s+[A-Z][a-zA-Z0-9\-]+)*)[\s\-:]/gm,
    // Pattern: Multiple capitalized words (likely client name)
    /([A-Z][a-zA-Z0-9\-]+(?:\s+[A-Z][a-zA-Z0-9\-]+){1,3})/g,
  ];

  for (const pattern of patterns) {
    const matches = [...taskName.matchAll(pattern)];
    if (matches.length > 0) {
      // Get the first capture group from the first match
      const match = matches[0][1]?.trim();
      if (match && match.length > 2) {
        logger.debug(`Extracted client name using enhanced pattern: ${match}`);
        return match;
      }
    }
  }

  return null;
}

/**
 * Extracts client/repository name from ClickUp task name with enhanced logic
 * 
 * @param taskName - The task name to extract from
 * @param taskId - Optional task ID for manual mapping lookup
 * @param fullTask - Optional full ClickUp task object for folder name fallback
 * @returns ExtractionResult with client name, confidence, and suggestions
 */
export async function extractClientName(
  taskName: string,
  taskId?: string,
  fullTask?: ClickUpTask
): Promise<ExtractionResult> {
  logger.debug(`Extracting client name from task: ${taskName}${taskId ? ` (taskId: ${taskId})` : ''}`);

  // Step 1: Check manual task mapping first (highest priority)
  if (taskId) {
    const manualMapping = await getClientMapping(taskId);
    if (manualMapping) {
      logger.debug(`Found manual mapping for task ${taskId}: ${manualMapping}`);
      const validation = await validateClientName(manualMapping);
      if (validation.isValid) {
        return {
          clientName: validation.actualName || manualMapping,
          confidence: 'high',
          validated: true,
          method: 'manual',
        };
      }
    }
  }

  // Step 2: Check folder name as high-priority fallback
  if (fullTask?.folder?.name) {
    const folderName = fullTask.folder.name;
    logger.debug(`Checking ClickUp folder name as fallback: ${folderName}`);
    
    // Try the folder name directly
    let validation = await validateClientName(folderName);
    if (validation.isValid) {
      return {
        clientName: validation.actualName || folderName,
        confidence: 'high',
        validated: true,
        method: 'folder',
      };
    }

    // Try hyphenated version of folder name (e.g., "Jacks Roofing LLC" -> "jacks-roofing-llc")
    const hyphenatedName = folderName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    logger.debug(`Trying hyphenated folder name: ${hyphenatedName}`);
    validation = await validateClientName(hyphenatedName);
    if (validation.isValid) {
      return {
        clientName: validation.actualName || hyphenatedName,
        confidence: 'high',
        validated: true,
        method: 'folder',
      };
    }
    
    // Try without common suffixes like "LLC"
    const cleanedName = folderName.replace(/\s+LLC$/i, '').trim();
    if (cleanedName !== folderName) {
      const hyphenatedCleaned = cleanedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      logger.debug(`Trying cleaned hyphenated name: ${hyphenatedCleaned}`);
      validation = await validateClientName(hyphenatedCleaned);
      if (validation.isValid) {
        return {
          clientName: validation.actualName || hyphenatedCleaned,
          confidence: 'high',
          validated: true,
          method: 'folder',
        };
      }
    }
  }

  // Step 3: Check pattern mappings
  const patternMatch = await checkPatternMappings(taskName);
  if (patternMatch) {
    const validation = await validateClientName(patternMatch);
    if (validation.isValid) {
      return {
        clientName: validation.actualName || patternMatch,
        confidence: 'high',
        validated: true,
        method: 'pattern',
      };
    }
  }

  // Step 3: Check config folder mapping
  if (config.git.folderMapping) {
    for (const [key, folderName] of Object.entries(config.git.folderMapping)) {
      if (taskName.toLowerCase().includes(key.toLowerCase())) {
        logger.debug(`Found mapped folder: ${folderName} for key: ${key}`);
        const validation = await validateClientName(folderName);
        if (validation.isValid) {
          return {
            clientName: validation.actualName || folderName,
            confidence: 'high',
            validated: true,
          };
        }
      }
    }
  }

  // Step 4: Enhanced pattern extraction
  const extractedName = await extractWithEnhancedPatterns(taskName);
  if (extractedName) {
    const validation = await validateClientName(extractedName);
    if (validation.isValid) {
      return {
        clientName: validation.actualName || extractedName,
        confidence: 'medium',
        validated: true,
      };
    } else {
      // Found a name but it doesn't match a folder - get suggestions
      const suggestions = await findClosestMatches(extractedName);
      return {
        clientName: extractedName,
        confidence: 'low',
        validated: false,
        suggestions,
      };
    }
  }

  // Step 5: Fallback - try to find capitalized words
  const words = taskName.split(/\s+/);
  const candidates: string[] = [];
  
  for (const word of words) {
    if (word.length > 2 && /^[A-Z][a-zA-Z0-9\-]+$/.test(word)) {
      candidates.push(word);
    }
  }

  // Try each candidate
  for (const candidate of candidates) {
    const validation = await validateClientName(candidate);
    if (validation.isValid) {
      logger.debug(`Extracted client name as capitalized word: ${candidate}`);
      return {
        clientName: validation.actualName || candidate,
        confidence: 'low',
        validated: true,
      };
    }
  }

  // If we have candidates but none validated, return suggestions
  if (candidates.length > 0) {
    const allSuggestions: string[] = [];
    for (const candidate of candidates) {
      const suggestions = await findClosestMatches(candidate);
      allSuggestions.push(...suggestions);
    }
    // Remove duplicates and limit
    const uniqueSuggestions = [...new Set(allSuggestions)].slice(0, 5);
    
    return {
      clientName: candidates[0],
      confidence: 'low',
      validated: false,
      suggestions: uniqueSuggestions,
    };
  }

  logger.warn(`Could not extract client name from task: ${taskName}`);
  return {
    clientName: null,
    confidence: 'low',
    validated: false,
  };
}

/**
 * Extracts client name (backward compatible wrapper)
 * @deprecated Use extractClientName with taskId parameter for better results
 */
export function extractClientNameSync(taskName: string): string | null {
  logger.debug(`Extracting client name from task (sync): ${taskName}`);

  // Check folder mapping first
  if (config.git.folderMapping) {
    for (const [key, folderName] of Object.entries(config.git.folderMapping)) {
      if (taskName.toLowerCase().includes(key.toLowerCase())) {
        logger.debug(`Found mapped folder: ${folderName} for key: ${key}`);
        return folderName;
      }
    }
  }

  // Common patterns to extract client names
  const patterns = [
    /(?:for|in|to|from)\s+([A-Z][a-zA-Z0-9\-]+)/g,
    /(?:client|project|repo|website)[\s:]+([A-Z][a-zA-Z0-9\-]+)/gi,
    /([A-Z][a-zA-Z0-9\-]+\s+(?:website|site|web|project|app))/gi,
  ];

  for (const pattern of patterns) {
    const matches = [...taskName.matchAll(pattern)];
    if (matches.length > 0) {
      const match = matches[0][1].trim();
      logger.debug(`Extracted client name using pattern: ${match}`);
      return match;
    }
  }

  // Fallback: try to find capitalized words
  const words = taskName.split(/\s+/);
  for (const word of words) {
    if (word.length > 2 && /^[A-Z][a-zA-Z0-9\-]+$/.test(word)) {
      logger.debug(`Extracted client name as capitalized word: ${word}`);
      return word;
    }
  }

  logger.warn(`Could not extract client name from task: ${taskName}`);
  return null;
}

/**
 * Sanitizes a string for use in Git branch names
 */
export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}















