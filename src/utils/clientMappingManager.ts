import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from './logger';

export interface TaskClientMappings {
  mappings: Record<string, string>; // taskId -> clientName
  patternMappings: Array<{
    pattern: string;
    client: string;
  }>;
}

const MAPPINGS_FILE = path.join(process.cwd(), 'config', 'task-client-mappings.json');

/**
 * Loads task-client mappings from file
 */
export async function loadMappings(): Promise<TaskClientMappings> {
  try {
    if (await fs.pathExists(MAPPINGS_FILE)) {
      const content = await fs.readJson(MAPPINGS_FILE);
      return {
        mappings: content.mappings || {},
        patternMappings: content.patternMappings || [],
      };
    }
  } catch (error: any) {
    logger.warn(`Error loading mappings file: ${error.message}`);
  }
  
  return {
    mappings: {},
    patternMappings: [],
  };
}

/**
 * Saves task-client mappings to file
 */
export async function saveMappings(mappings: TaskClientMappings): Promise<void> {
  try {
    await fs.ensureDir(path.dirname(MAPPINGS_FILE));
    await fs.writeJson(MAPPINGS_FILE, mappings, { spaces: 2 });
    logger.debug(`Saved mappings to ${MAPPINGS_FILE}`);
  } catch (error: any) {
    logger.error(`Error saving mappings file: ${error.message}`);
    throw error;
  }
}

/**
 * Gets client mapping for a specific task ID
 */
export async function getClientMapping(taskId: string): Promise<string | null> {
  const mappings = await loadMappings();
  return mappings.mappings[taskId] || null;
}

/**
 * Maps a task to a client name
 */
export async function mapTaskToClient(taskId: string, clientName: string): Promise<void> {
  const mappings = await loadMappings();
  mappings.mappings[taskId] = clientName;
  await saveMappings(mappings);
  logger.info(`Mapped task ${taskId} to client: ${clientName}`);
}

/**
 * Checks if a task name matches any pattern mapping
 */
export async function checkPatternMappings(taskName: string): Promise<string | null> {
  const mappings = await loadMappings();
  
  for (const patternMapping of mappings.patternMappings) {
    try {
      const regex = new RegExp(patternMapping.pattern, 'i');
      if (regex.test(taskName)) {
        logger.debug(`Task name matched pattern mapping: ${patternMapping.pattern} -> ${patternMapping.client}`);
        return patternMapping.client;
      }
    } catch (error: any) {
      logger.warn(`Invalid regex pattern in mapping: ${patternMapping.pattern} - ${error.message}`);
    }
  }
  
  return null;
}

/**
 * Adds a pattern mapping
 */
export async function addPatternMapping(pattern: string, clientName: string): Promise<void> {
  const mappings = await loadMappings();
  
  // Check if pattern already exists
  const existingIndex = mappings.patternMappings.findIndex(pm => pm.pattern === pattern);
  if (existingIndex >= 0) {
    mappings.patternMappings[existingIndex].client = clientName;
  } else {
    mappings.patternMappings.push({ pattern, client: clientName });
  }
  
  await saveMappings(mappings);
  logger.info(`Added pattern mapping: ${pattern} -> ${clientName}`);
}

/**
 * Removes a pattern mapping
 */
export async function removePatternMapping(pattern: string): Promise<void> {
  const mappings = await loadMappings();
  const initialLength = mappings.patternMappings.length;
  mappings.patternMappings = mappings.patternMappings.filter(pm => pm.pattern !== pattern);
  
  if (mappings.patternMappings.length !== initialLength) {
    await saveMappings(mappings);
    logger.info(`Removed pattern mapping: ${pattern}`);
  }
}

/**
 * Removes a task mapping
 */
export async function removeTaskMapping(taskId: string): Promise<void> {
  const mappings = await loadMappings();
  if (mappings.mappings[taskId]) {
    delete mappings.mappings[taskId];
    await saveMappings(mappings);
    logger.info(`Removed mapping for task ${taskId}`);
  }
}

