import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface RunMetadata {
  taskId: string;
  workspacePath: string;
  baseCommit: string;
  startedAt: string;
  clientFolder: string;
  iteration: number;
}

/**
 * Saves run metadata to run.json in client folder
 */
export async function saveRunMetadata(metadata: RunMetadata): Promise<void> {
  const runPath = path.join(metadata.clientFolder, 'run.json');
  try {
    await fs.writeJson(runPath, metadata, { spaces: 2 });
    logger.info(`Run metadata saved to ${runPath}`);
    
    // Also save to run-specific history
    const historyDir = path.join(metadata.clientFolder, '.cursor', 'runs', `run_${metadata.iteration}`);
    await fs.ensureDir(historyDir);
    await fs.writeJson(path.join(historyDir, 'run.json'), metadata, { spaces: 2 });
  } catch (error: any) {
    logger.error(`Error saving run metadata: ${error.message}`);
  }
}

/**
 * Loads run metadata from run.json in a specific client folder
 */
export async function loadRunMetadata(clientFolder?: string): Promise<RunMetadata | null> {
  const runPath = clientFolder ? path.join(clientFolder, 'run.json') : path.join(process.cwd(), 'run.json');
  try {
    if (await fs.pathExists(runPath)) {
      return await fs.readJson(runPath);
    }
  } catch (error: any) {
    logger.error(`Error loading run metadata: ${error.message}`);
  }
  return null;
}

/**
 * Saves artifact to .cursor/artifacts/<taskId>/run_<iteration>/ in workspace root
 */
export async function saveArtifact(
  taskId: string,
  fileName: string,
  content: string | Buffer,
  workspaceRoot: string = process.cwd(),
  iteration: number = 0
): Promise<string> {
  const artifactDir = path.join(workspaceRoot, '.cursor', 'artifacts', taskId, `run_${iteration}`);
  await fs.ensureDir(artifactDir);
  
  const artifactPath = path.join(artifactDir, fileName);
  if (typeof content === 'string') {
    await fs.writeFile(artifactPath, content, 'utf-8');
  } else {
    await fs.writeFile(artifactPath, content);
  }
  
  logger.info(`Artifact saved: ${artifactPath}`);
  return artifactPath;
}




