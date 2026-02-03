import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';

// Mock modules before imports
vi.mock('simple-git', () => {
  return {
    default: vi.fn(() => ({
      revparse: vi.fn().mockResolvedValue('currenthash123'),
      catFile: vi.fn().mockResolvedValue('commit'),
      clean: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
      tag: vi.fn().mockResolvedValue(undefined),
      log: vi.fn().mockResolvedValue({
        all: [
          { hash: 'commit1', message: 'First commit', date: '2024-01-01', author_name: 'Test' },
          { hash: 'commit2', message: 'Second commit', date: '2024-01-02', author_name: 'Test' }
        ]
      }),
      diffSummary: vi.fn().mockResolvedValue({
        files: [
          { file: 'src/index.ts', insertions: 10, deletions: 5 },
          { file: 'src/app.ts', insertions: 20, deletions: 2 }
        ]
      }),
      status: vi.fn().mockResolvedValue({ isClean: () => true }),
      stash: vi.fn().mockResolvedValue(undefined)
    }))
  };
});

vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../src/state/checkpointService', () => ({
  validateCheckpoint: vi.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] })
}));

vi.mock('../src/state/stateManager', () => ({
  clearFailedStepMarker: vi.fn().mockResolvedValue({}),
  releaseRetryLock: vi.fn().mockResolvedValue(undefined),
  loadTaskState: vi.fn().mockResolvedValue({
    failedStep: { stepNumber: 2, stepName: 'copywriting' },
    branchName: 'main'
  }),
  updateTaskState: vi.fn().mockResolvedValue({}),
  WorkflowState: {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    ERROR: 'error'
  }
}));

// Import after mocks
import {
  rollbackToCheckpoint,
  cleanupFailedStepArtifacts,
  generateRollbackPreview,
  skipFailedStep
} from '../src/git/rollbackService';
import { StepCheckpoint } from '../src/state/stateManager';

describe('RollbackService', () => {
  let tempDir: string;
  const testTaskId = 'demo-test-client';

  beforeEach(async () => {
    // Create a temporary workspace
    tempDir = path.join(process.cwd(), 'tests', 'tmp', `rollback-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
    
    // Create minimal directory structure
    await fs.ensureDir(path.join(tempDir, '.clickup-workflow', testTaskId));
    await fs.ensureDir(path.join(tempDir, '.git'));
  });

  afterEach(async () => {
    // Clean up temp directory
    if (await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
    vi.clearAllMocks();
  });

  describe('rollbackToCheckpoint', () => {
    it('should perform rollback successfully', async () => {
      const checkpoint: StepCheckpoint = {
        stepNumber: 1,
        stepName: 'branding',
        timestamp: new Date().toISOString(),
        gitCommitHash: 'checkpoint123',
        gitBranch: 'main',
        artifactPaths: []
      };

      const result = await rollbackToCheckpoint(tempDir, testTaskId, checkpoint);
      
      expect(result.success).toBe(true);
      expect(result.checkpoint).toEqual(checkpoint);
    });

    it('should create a safety tag before rollback', async () => {
      const checkpoint: StepCheckpoint = {
        stepNumber: 1,
        stepName: 'branding',
        timestamp: new Date().toISOString(),
        gitCommitHash: 'checkpoint123',
        gitBranch: 'main',
        artifactPaths: []
      };

      const result = await rollbackToCheckpoint(tempDir, testTaskId, checkpoint);
      
      expect(result.success).toBe(true);
      expect(result.safetyTagName).toContain('recovery');
    });

    it('should return discarded commit count', async () => {
      const checkpoint: StepCheckpoint = {
        stepNumber: 1,
        stepName: 'branding',
        timestamp: new Date().toISOString(),
        gitCommitHash: 'checkpoint123',
        gitBranch: 'main',
        artifactPaths: []
      };

      const result = await rollbackToCheckpoint(tempDir, testTaskId, checkpoint);
      
      expect(result.success).toBe(true);
      expect(result.discardedCommits).toBe(2); // From mock
    });
  });

  describe('cleanupFailedStepArtifacts', () => {
    it('should remove screenshot directories for failed step', async () => {
      // Create screenshot directory structure
      const screenshotsDir = path.join(process.cwd(), 'public', 'screenshots', testTaskId, 'after_200');
      await fs.ensureDir(screenshotsDir);
      await fs.writeFile(path.join(screenshotsDir, 'screenshot.png'), 'fake image');

      const cleaned = await cleanupFailedStepArtifacts(tempDir, testTaskId, 2);
      
      expect(cleaned).toContain(screenshotsDir);
      
      // Cleanup
      await fs.remove(path.join(process.cwd(), 'public', 'screenshots', testTaskId));
    });

    it('should remove temp files in client folder', async () => {
      // Create temp files
      await fs.writeFile(path.join(tempDir, '.workflow_history.tmp.json'), '{}');
      await fs.writeFile(path.join(tempDir, '.CURSOR_TASK.tmp.md'), '# Task');
      await fs.writeFile(path.join(tempDir, '.demo.status.tmp.json'), '{}');

      const cleaned = await cleanupFailedStepArtifacts(tempDir, testTaskId, 2);
      
      expect(cleaned.length).toBeGreaterThan(0);
      expect(await fs.pathExists(path.join(tempDir, '.workflow_history.tmp.json'))).toBe(false);
      expect(await fs.pathExists(path.join(tempDir, '.CURSOR_TASK.tmp.md'))).toBe(false);
      expect(await fs.pathExists(path.join(tempDir, '.demo.status.tmp.json'))).toBe(false);
    });

    it('should handle missing directories gracefully', async () => {
      // Don't create any artifacts
      const cleaned = await cleanupFailedStepArtifacts(tempDir, testTaskId, 2);
      
      // Should complete without error, may return empty array
      expect(Array.isArray(cleaned)).toBe(true);
    });
  });

  describe('generateRollbackPreview', () => {
    it('should return preserved and discarded steps', async () => {
      const checkpoint: StepCheckpoint = {
        stepNumber: 1,
        stepName: 'branding',
        timestamp: new Date().toISOString(),
        gitCommitHash: 'checkpoint123',
        gitBranch: 'main',
        artifactPaths: []
      };

      const preview = await generateRollbackPreview(tempDir, testTaskId, checkpoint, 4);
      
      expect(preview.preservedSteps.length).toBeGreaterThan(0);
      expect(preview.preservedSteps[0]).toContain('Step 1');
      expect(preview.willRollbackTo).toBe('checkpoint123');
      expect(preview.willRollbackToStep).toBe(1);
    });

    it('should include changed files in preview', async () => {
      const checkpoint: StepCheckpoint = {
        stepNumber: 1,
        stepName: 'branding',
        timestamp: new Date().toISOString(),
        gitCommitHash: 'checkpoint123',
        gitBranch: 'main',
        artifactPaths: []
      };

      const preview = await generateRollbackPreview(tempDir, testTaskId, checkpoint, 4);
      
      // From mock
      expect(preview.changedFiles).toContain('src/index.ts');
      expect(preview.changedFiles).toContain('src/app.ts');
    });

    it('should include discarded commits', async () => {
      const checkpoint: StepCheckpoint = {
        stepNumber: 1,
        stepName: 'branding',
        timestamp: new Date().toISOString(),
        gitCommitHash: 'checkpoint123',
        gitBranch: 'main',
        artifactPaths: []
      };

      const preview = await generateRollbackPreview(tempDir, testTaskId, checkpoint, 4);
      
      expect(preview.discardedCommits.length).toBe(2); // From mock
      expect(preview.discardedCommits[0].hash).toBe('commit1');
    });
  });

  describe('skipFailedStep', () => {
    it('should advance to next step when not on final step', async () => {
      // Create demo.status.json
      await fs.writeJson(path.join(tempDir, 'demo.status.json'), {
        currentStep: 2,
        totalSteps: 4,
        state: 'error',
        logs: []
      });

      const result = await skipFailedStep(tempDir, testTaskId, 2, 4);
      
      expect(result.success).toBe(true);
      expect(result.nextStep).toBe(3);
    });

    it('should fail when trying to skip final step', async () => {
      const result = await skipFailedStep(tempDir, testTaskId, 4, 4);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('final step');
    });

    it('should update demo.status.json with skip info', async () => {
      await fs.writeJson(path.join(tempDir, 'demo.status.json'), {
        currentStep: 2,
        totalSteps: 4,
        state: 'error',
        logs: []
      });

      await skipFailedStep(tempDir, testTaskId, 2, 4);
      
      const status = await fs.readJson(path.join(tempDir, 'demo.status.json'));
      expect(status.currentStep).toBe(3);
      expect(status.skippedSteps).toContain(2);
    });

    it('should record skip in logs', async () => {
      await fs.writeJson(path.join(tempDir, 'demo.status.json'), {
        currentStep: 2,
        totalSteps: 4,
        state: 'error',
        logs: []
      });

      await skipFailedStep(tempDir, testTaskId, 2, 4);
      
      const status = await fs.readJson(path.join(tempDir, 'demo.status.json'));
      expect(status.logs.length).toBeGreaterThan(0);
      expect(status.logs[0]).toContain('skipped');
    });
  });
});

describe('RollbackService Exports', () => {
  it('should export rollbackToCheckpoint', () => {
    expect(typeof rollbackToCheckpoint).toBe('function');
  });

  it('should export cleanupFailedStepArtifacts', () => {
    expect(typeof cleanupFailedStepArtifacts).toBe('function');
  });

  it('should export generateRollbackPreview', () => {
    expect(typeof generateRollbackPreview).toBe('function');
  });

  it('should export skipFailedStep', () => {
    expect(typeof skipFailedStep).toBe('function');
  });
});
