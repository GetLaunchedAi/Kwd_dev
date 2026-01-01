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
  branchName: string
): Promise<ChangeSummary> {
  logger.info(`Generating change summary for branch: ${branchName}`);

  // Get diff between default branch and feature branch
  const defaultBranch = config.git.defaultBranch;
  const fullDiff = await getDiff(folderPath, defaultBranch, branchName);
  
  // Get git status to see file changes
  const status = await getStatus(folderPath);
  
  // Parse diff to extract statistics
  const diffStats = parseDiffStats(fullDiff);
  
  // Generate preview (first 100 lines or key sections)
  const diffPreview = generateDiffPreview(fullDiff, 100);

  // Build file list from status
  const fileList = buildFileList(status, diffStats);

  return {
    filesModified: diffStats.filesModified,
    filesAdded: diffStats.filesAdded,
    filesDeleted: diffStats.filesDeleted,
    linesAdded: diffStats.linesAdded,
    linesRemoved: diffStats.linesRemoved,
    fileList,
    diffPreview,
    fullDiff,
  };
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

  for (const line of lines) {
    // Detect file header
    if (line.startsWith('diff --git')) {
      const match = line.match(/diff --git a\/(.+?) b\/(.+?)$/);
      if (match) {
        currentFile = match[2];
        fileStats.set(currentFile, { additions: 0, deletions: 0 });
        filesModified++;
      }
    } else if (line.startsWith('new file mode')) {
      filesAdded++;
    } else if (line.startsWith('deleted file mode')) {
      filesDeleted++;
    } else if (line.startsWith('+++') || line.startsWith('---')) {
      // File header
      continue;
    } else if (line.startsWith('@@')) {
      // Hunk header
      continue;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      // Added line
      linesAdded++;
      if (currentFile && fileStats.has(currentFile)) {
        fileStats.get(currentFile)!.additions++;
      }
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      // Removed line
      linesRemoved++;
      if (currentFile && fileStats.has(currentFile)) {
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
 * Builds file list with statistics
 */
function buildFileList(
  status: any,
  diffStats: { fileStats: Map<string, { additions: number; deletions: number }> }
): Array<{ path: string; status: string; additions?: number; deletions?: number }> {
  const fileList: Array<{ path: string; status: string; additions?: number; deletions?: number }> = [];

  // Add modified files
  for (const file of status.modified || []) {
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
    fileList.push({
      path: file,
      status: 'deleted',
    });
  }

  return fileList;
}















