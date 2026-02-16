import { getDiff, getStatus } from '../git/branchManager';
import { config } from '../config/config';
import { logger } from '../utils/logger';

export interface ChangeSummary {
  filesModified: number;
  filesAdded: number;
  filesDeleted: number;
  linesAdded: number;
  linesRemoved: number;
  fileList: Array<{
    path: string;
    status: string;
    additions?: number;
    deletions?: number;
  }>;
  diffPreview: string;
  fullDiff: string;
}

/**
 * Generates a summary of changes between branches
 */
export async function generateChangeSummary(
  folderPath: string,
  branchName: string,
  baseRevision?: string
): Promise<ChangeSummary> {
  logger.info(`Generating change summary for branch: ${branchName}${baseRevision ? ` (base: ${baseRevision})` : ''}`);

  // Get diff between base revision (or default branch) and current working tree (live)
  const base = baseRevision || config.git.defaultBranch;
  let fullDiff = '';
  
  try {
    fullDiff = await getDiff(folderPath, base);
  } catch (error: any) {
    logger.warn(`Could not get diff against ${base}: ${error.message}. Falling back to HEAD.`);
    try {
      // Fallback to diffing against current HEAD (shows working tree changes if any)
      fullDiff = await getDiff(folderPath, 'HEAD');
    } catch (fallbackError: any) {
      logger.error(`Fallback diff failed: ${fallbackError.message}`);
      fullDiff = ''; // Return empty diff rather than crashing
    }
  }
  
  // Get git status to see file changes
  let status: any = null;
  try {
    status = await getStatus(folderPath);
  } catch (statusError: any) {
    logger.error(`Error getting git status: ${statusError.message}`);
    // Continue with null status — buildFileList handles it gracefully
  }
  
  // Parse diff to extract statistics
  const diffStats = parseDiffStats(fullDiff);
  
  // Build file list from status
  const fileList = buildFileList(status, diffStats);

  // Filter fullDiff to exclude internal files
  const filteredDiff = filterDiff(fullDiff);
  const diffPreview = generateDiffPreview(filteredDiff, 100);

  return {
    filesModified: diffStats.filesModified,
    filesAdded: diffStats.filesAdded,
    filesDeleted: diffStats.filesDeleted,
    linesAdded: diffStats.linesAdded,
    linesRemoved: diffStats.linesRemoved,
    fileList,
    diffPreview,
    fullDiff: filteredDiff,
  };
}

/**
 * Filters a git diff string to remove internal system files
 */
function filterDiff(diff: string): string {
  const isInternalFile = (filePath: string) => {
    return filePath.startsWith('.clickup-workflow/') || 
           filePath.startsWith('.cursor/') || 
           filePath.startsWith('logs/');
  };

  const sections = diff.split('diff --git ');
  if (sections.length <= 1) return diff;

  const header = sections[0]; // Usually empty or some git headers
  const filteredSections = sections.slice(1).filter(section => {
    const match = section.match(/^a\/(.+?) b\/(.+?)\n/);
    if (match) {
      const filePath = match[2];
      return !isInternalFile(filePath);
    }
    return true;
  });

  if (filteredSections.length === 0) return header;
  
  return header + filteredSections.map(s => 'diff --git ' + s).join('');
}

/**
 * Parses diff output to extract statistics
 */
function parseDiffStats(diff: string): {
  filesModified: number;
  filesAdded: number;
  filesDeleted: number;
  linesAdded: number;
  linesRemoved: number;
  fileStats: Map<string, { additions: number; deletions: number }>;
} {
  const lines = diff.split('\n');
  const fileStats = new Map<string, { additions: number; deletions: number }>();
  let currentFile: string | null = null;
  let filesModified = 0;
  let filesAdded = 0;
  let filesDeleted = 0;
  let linesAdded = 0;
  let linesRemoved = 0;

  const isInternalFile = (filePath: string) => {
    return filePath.startsWith('.clickup-workflow/') || 
           filePath.startsWith('.cursor/') || 
           filePath.startsWith('logs/');
  };

  for (const line of lines) {
    // Detect file header
    if (line.startsWith('diff --git')) {
      const match = line.match(/diff --git a\/(.+?) b\/(.+?)$/);
      if (match) {
        currentFile = match[2];
        if (isInternalFile(currentFile)) {
          currentFile = null;
          continue;
        }
        fileStats.set(currentFile, { additions: 0, deletions: 0 });
        filesModified++;
      }
    } else if (line.startsWith('new file mode')) {
      if (currentFile) filesAdded++;
    } else if (line.startsWith('deleted file mode')) {
      if (currentFile) filesDeleted++;
    } else if (line.startsWith('+++') || line.startsWith('---')) {
      // File header
      continue;
    } else if (line.startsWith('@@')) {
      // Hunk header
      continue;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      // Added line
      if (currentFile && fileStats.has(currentFile)) {
        linesAdded++;
        fileStats.get(currentFile)!.additions++;
      }
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // Removed line
      if (currentFile && fileStats.has(currentFile)) {
        linesRemoved++;
        fileStats.get(currentFile)!.deletions++;
      }
    }
  }

  return {
    filesModified,
    filesAdded,
    filesDeleted,
    linesAdded,
    linesRemoved,
    fileStats,
  };
}

/**
 * Generates a preview of the diff (first N lines)
 */
function generateDiffPreview(diff: string, maxLines: number): string {
  const lines = diff.split('\n');
  
  if (lines.length <= maxLines) {
    return diff;
  }

  // Try to include file headers and first hunks
  const preview: string[] = [];
  let lineCount = 0;
  let inFileHeader = false;

  for (const line of lines) {
    if (line.startsWith('diff --git') || line.startsWith('+++') || line.startsWith('---')) {
      inFileHeader = true;
      preview.push(line);
      lineCount++;
    } else if (inFileHeader && line.startsWith('@@')) {
      preview.push(line);
      lineCount++;
      inFileHeader = false;
    } else if (lineCount < maxLines) {
      preview.push(line);
      lineCount++;
    } else {
      break;
    }
  }

  preview.push(`\n... (${lines.length - preview.length} more lines)`);
  return preview.join('\n');
}

/**
 * Builds file list with statistics, filtering out internal system files
 */
function buildFileList(
  status: any,
  diffStats: { fileStats: Map<string, { additions: number; deletions: number }> }
): Array<{ path: string; status: string; additions?: number; deletions?: number }> {
  const fileList: Array<{ path: string; status: string; additions?: number; deletions?: number }> = [];

  if (!status) return fileList; // No status available (git error) — return empty list

  const isInternalFile = (filePath: string) => {
    return filePath.startsWith('.clickup-workflow/') || 
           filePath.startsWith('.cursor/') || 
           filePath.startsWith('logs/');
  };

  // Add modified files
  for (const file of status.modified || []) {
    if (isInternalFile(file)) continue;
    const stats = diffStats.fileStats.get(file) || { additions: 0, deletions: 0 };
    fileList.push({
      path: file,
      status: 'modified',
      additions: stats.additions,
      deletions: stats.deletions,
    });
  }

  // Add created files
  for (const file of status.created || []) {
    if (isInternalFile(file)) continue;
    const stats = diffStats.fileStats.get(file) || { additions: 0, deletions: 0 };
    fileList.push({
      path: file,
      status: 'created',
      additions: stats.additions,
      deletions: stats.deletions,
    });
  }

  // Add deleted files
  for (const file of status.deleted || []) {
    if (isInternalFile(file)) continue;
    fileList.push({
      path: file,
      status: 'deleted',
    });
  }

  return fileList;
}















