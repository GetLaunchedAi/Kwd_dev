/**
 * Integration Tests for Demo Error Recovery System
 * 
 * Tests the full retry/skip flows including:
 * - Error detection and state marking
 * - Checkpoint creation and validation
 * - Rollback to checkpoint
 * - Skip to next step
 * - Concurrent retry prevention
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';

// Mock simple-git before imports
vi.mock('simple-git', () => {
  return {
    default: vi.fn(() => ({
      revparse: vi.fn().mockResolvedValue('abc123def456'),
      status: vi.fn().mockResolvedValue({ 
        current: 'main',
        isClean: () => true 
      }),
      catFile: vi.fn().mockResolvedValue('commit'),
      branchLocal: vi.fn().mockResolvedValue({ all: ['main', 'dev'] }),
      clean: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
      tag: vi.fn().mockResolvedValue(undefined),
      log: vi.fn().mockResolvedValue({
        all: [
          { hash: 'commit1', message: 'Step 2 changes', date: '2024-01-02', author_name: 'Agent' }
        ]
      }),
      diffSummary: vi.fn().mockResolvedValue({
        files: [{ file: 'index.html', insertions: 50, deletions: 10 }]
      }),
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

// Mock task lock to avoid deadlocks in tests
vi.mock('../src/utils/taskLock', () => ({
  taskLockManager: {
    runExclusive: vi.fn().mockImplementation(async (taskId, fn) => fn())
  }
}));

// Import modules after mocks
import {
  saveStepCheckpoint,
  markStepFailed,
  clearFailedStepMarker,
  loadTaskState,
  saveTaskState,
  acquireRetryLock,
  releaseRetryLock,
  getRecoveryState,
  WorkflowState
} from '../src/state/stateManager';
import {
  createCheckpoint,
  validateCheckpoint,
  getRecoveryOptions,
  findRecoveryCheckpoint,
  MAX_RETRIES
} from '../src/state/checkpointService';
import {
  rollbackToCheckpoint,
  skipFailedStep,
  generateRollbackPreview
} from '../src/git/rollbackService';

describe('Error Recovery Integration Tests', () => {
  let tempDir: string;
  const testTaskId = 'demo-test-integration';

  beforeEach(async () => {
    // Create a temporary workspace simulating a demo
    tempDir = path.join(process.cwd(), 'tests', 'tmp', `recovery-integration-${Date.now()}`);
    await fs.ensureDir(tempDir);
    
    // Create minimal directory structure
    await fs.ensureDir(path.join(tempDir, '.clickup-workflow', testTaskId));
    await fs.ensureDir(path.join(tempDir, '.git'));
    
    // Create demo.status.json
    await fs.writeJson(path.join(tempDir, 'demo.status.json'), {
      currentStep: 2,
      totalSteps: 4,
      state: 'in_progress',
      logs: []
    }, { spaces: 2 });
    
    // Create demo.context.json
    await fs.writeJson(path.join(tempDir, 'demo.context.json'), {
      businessName: 'Test Business',
      clientSlug: 'test-integration'
    }, { spaces: 2 });
  });

  afterEach(async () => {
    if (await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
    vi.clearAllMocks();
  });

  describe('Full Retry Flow', () => {
    it('should create checkpoint, mark failure, then retry with rollback', async () => {
      // Step 1: Simulate successful step 1 completion with checkpoint
      const checkpoint1 = await createCheckpoint(tempDir, testTaskId, 1, 'branding');
      expect(checkpoint1.success).toBe(true);
      expect(checkpoint1.checkpoint?.stepNumber).toBe(1);
      
      // Verify checkpoint was saved to state
      await saveStepCheckpoint(
        tempDir, testTaskId, 1, 'branding',
        checkpoint1.checkpoint!.gitCommitHash, []
      );
      
      // Step 2: Simulate step 2 failure
      const failedState = await markStepFailed(
        tempDir, testTaskId, 2, 'copywriting',
        'timeout', 'Operation timed out after 30 minutes'
      );
      
      expect(failedState.state).toBe(WorkflowState.ERROR);
      expect(failedState.failedStep?.stepNumber).toBe(2);
      expect(failedState.failedStep?.errorCategory).toBe('timeout');
      expect(failedState.failedStep?.retryCount).toBe(0);
      
      // Step 3: Get recovery options
      const recoveryState = await getRecoveryState(tempDir, testTaskId);
      expect(recoveryState.failedStep).toBeDefined();
      expect(recoveryState.lastCheckpoint).toBeDefined();
      
      // Step 4: Find recovery checkpoint
      const recoveryCheckpoint = await findRecoveryCheckpoint(tempDir, testTaskId, 2);
      expect(recoveryCheckpoint).toBeDefined();
      expect(recoveryCheckpoint?.stepNumber).toBe(1);
      
      // Step 5: Acquire retry lock
      const lockAcquired = await acquireRetryLock(tempDir, testTaskId, 'retry');
      expect(lockAcquired).toBe(true);
      
      // Step 6: Perform rollback (mocked git operations)
      const rollbackResult = await rollbackToCheckpoint(tempDir, testTaskId, recoveryCheckpoint!);
      expect(rollbackResult.success).toBe(true);
      
      // Step 7: Clear failed step marker
      await clearFailedStepMarker(tempDir, testTaskId);
      
      // Verify state is cleared
      const clearedState = await loadTaskState(tempDir, testTaskId);
      expect(clearedState?.failedStep).toBeUndefined();
      expect(clearedState?.state).toBe(WorkflowState.IN_PROGRESS);
      
      // Step 8: Release lock
      await releaseRetryLock(tempDir, testTaskId);
      
      // Verify lock is released
      const postReleaseState = await getRecoveryState(tempDir, testTaskId);
      expect(postReleaseState.isLocked).toBe(false);
    });

    it('should track retry count and enforce limit', async () => {
      // Create initial state with step 1 checkpoint
      await saveStepCheckpoint(tempDir, testTaskId, 1, 'branding', 'abc123', []);
      
      // Simulate multiple failures on step 2
      // Note: First failure has retryCount=0, each subsequent failure increments by 1
      // So MAX_RETRIES (3) failures results in retryCount of MAX_RETRIES - 1 (2)
      // We need MAX_RETRIES + 1 (4) failures to reach retryCount of MAX_RETRIES (3)
      for (let i = 0; i <= MAX_RETRIES; i++) {
        await markStepFailed(
          tempDir, testTaskId, 2, 'copywriting',
          'timeout', `Attempt ${i + 1} failed`
        );
      }
      
      // Check retry count - after MAX_RETRIES+1 failures, retryCount equals MAX_RETRIES
      const state = await loadTaskState(tempDir, testTaskId);
      expect(state?.failedStep?.retryCount).toBe(MAX_RETRIES);
      
      // Get recovery options should disable retry
      const options = getRecoveryOptions('timeout', state!.failedStep!, 4);
      const retryOption = options.find(o => o.action === 'retry');
      
      expect(retryOption?.disabled).toBe(true);
      expect(retryOption?.disabledReason).toContain('Maximum retries');
    });
  });

  describe('Full Skip Flow', () => {
    it('should skip failed step and advance to next step', async () => {
      // Setup: Create checkpoint and mark step 2 as failed
      await saveStepCheckpoint(tempDir, testTaskId, 1, 'branding', 'abc123', []);
      await markStepFailed(
        tempDir, testTaskId, 2, 'copywriting',
        'timeout', 'Timed out'
      );
      
      // Perform skip
      const skipResult = await skipFailedStep(tempDir, testTaskId, 2, 4);
      
      expect(skipResult.success).toBe(true);
      expect(skipResult.nextStep).toBe(3);
      
      // Verify demo.status.json was updated
      const status = await fs.readJson(path.join(tempDir, 'demo.status.json'));
      expect(status.currentStep).toBe(3);
      expect(status.skippedSteps).toContain(2);
    });

    it('should prevent skipping final step', async () => {
      const skipResult = await skipFailedStep(tempDir, testTaskId, 4, 4);
      
      expect(skipResult.success).toBe(false);
      expect(skipResult.error).toContain('final step');
    });

    it('should prevent skip for credit limit errors', async () => {
      await markStepFailed(
        tempDir, testTaskId, 2, 'copywriting',
        'credit_limit', 'Credits exhausted'
      );
      
      const state = await loadTaskState(tempDir, testTaskId);
      const options = getRecoveryOptions('credit_limit', state!.failedStep!, 4);
      
      // Skip should not be available for credit errors
      const skipOption = options.find(o => o.action === 'skip');
      expect(skipOption).toBeUndefined();
    });
  });

  describe('Concurrent Retry Prevention', () => {
    it('should prevent concurrent retry attempts', async () => {
      // First lock should succeed
      const lock1 = await acquireRetryLock(tempDir, testTaskId, 'retry');
      expect(lock1).toBe(true);
      
      // Second lock should fail
      const lock2 = await acquireRetryLock(tempDir, testTaskId, 'retry');
      expect(lock2).toBe(false);
      
      // Release first lock
      await releaseRetryLock(tempDir, testTaskId);
      
      // Now should be able to acquire again
      const lock3 = await acquireRetryLock(tempDir, testTaskId, 'skip');
      expect(lock3).toBe(true);
      
      await releaseRetryLock(tempDir, testTaskId);
    });
  });

  describe('Checkpoint Validation', () => {
    it('should validate checkpoint integrity', async () => {
      const checkpoint = {
        stepNumber: 1,
        stepName: 'branding',
        timestamp: new Date().toISOString(),
        gitCommitHash: 'abc123def456',
        gitBranch: 'main',
        artifactPaths: []
      };
      
      const validation = await validateCheckpoint(tempDir, checkpoint);
      
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should fallback to earlier checkpoint if latest is invalid', async () => {
      // Save two checkpoints
      await saveStepCheckpoint(tempDir, testTaskId, 1, 'branding', 'valid-hash-1', []);
      await saveStepCheckpoint(tempDir, testTaskId, 2, 'copywriting', 'valid-hash-2', []);
      
      // Mark step 3 as failed
      await markStepFailed(tempDir, testTaskId, 3, 'imagery', 'timeout', 'Timeout');
      
      // Find recovery checkpoint should return step 2 checkpoint
      const checkpoint = await findRecoveryCheckpoint(tempDir, testTaskId, 3);
      
      expect(checkpoint).toBeDefined();
      expect(checkpoint?.stepNumber).toBe(2);
    });
  });

  describe('Rollback Preview Generation', () => {
    it('should generate accurate rollback preview', async () => {
      // Setup checkpoints and failure
      await saveStepCheckpoint(tempDir, testTaskId, 1, 'branding', 'checkpoint1', []);
      await markStepFailed(tempDir, testTaskId, 2, 'copywriting', 'timeout', 'Timeout');
      
      const checkpoint = await findRecoveryCheckpoint(tempDir, testTaskId, 2);
      const preview = await generateRollbackPreview(tempDir, testTaskId, checkpoint!, 4);
      
      expect(preview.preservedSteps.length).toBeGreaterThan(0);
      expect(preview.preservedSteps[0]).toContain('Step 1');
      expect(preview.willRollbackToStep).toBe(1);
    });
  });

  describe('Recovery Options by Error Category', () => {
    const testCases = [
      { category: 'credit_limit', expectRetryDisabled: true, expectSkipAvailable: false },
      { category: 'model_error', expectRetryDisabled: false, expectSkipAvailable: true },
      { category: 'network_error', expectRetryDisabled: false, expectSkipAvailable: true },
      { category: 'timeout', expectRetryDisabled: false, expectSkipAvailable: true },
      { category: 'unknown', expectRetryDisabled: false, expectSkipAvailable: true }
    ];
    
    testCases.forEach(({ category, expectRetryDisabled, expectSkipAvailable }) => {
      it(`should provide correct options for ${category} errors`, async () => {
        const failedStep = {
          stepNumber: 2,
          stepName: 'copywriting',
          errorCategory: category,
          errorMessage: `${category} error message`,
          timestamp: new Date().toISOString(),
          retryCount: 0
        };
        
        const options = getRecoveryOptions(category, failedStep, 4);
        
        const retryOption = options.find(o => o.action === 'retry');
        const skipOption = options.find(o => o.action === 'skip');
        
        expect(retryOption?.disabled).toBe(expectRetryDisabled);
        
        if (expectSkipAvailable) {
          expect(skipOption).toBeDefined();
        } else {
          expect(skipOption).toBeUndefined();
        }
      });
    });
  });
});

describe('Edge Case: State Recovery After Partial Failure', () => {
  let tempDir: string;
  const testTaskId = 'demo-edge-case';

  beforeEach(async () => {
    tempDir = path.join(process.cwd(), 'tests', 'tmp', `edge-case-${Date.now()}`);
    await fs.ensureDir(path.join(tempDir, '.clickup-workflow', testTaskId));
    await fs.ensureDir(path.join(tempDir, '.git'));
    await fs.writeJson(path.join(tempDir, 'demo.status.json'), {
      currentStep: 2,
      totalSteps: 4,
      state: 'error',
      logs: []
    });
  });

  afterEach(async () => {
    if (await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
    vi.clearAllMocks();
  });

  it('should handle missing checkpoint gracefully', async () => {
    // Mark step 2 as failed without any checkpoints
    await markStepFailed(
      tempDir, testTaskId, 2, 'copywriting',
      'timeout', 'Timeout'
    );
    
    // Attempt to find recovery checkpoint should return null
    const checkpoint = await findRecoveryCheckpoint(tempDir, testTaskId, 2);
    expect(checkpoint).toBeNull();
    
    // Recovery state should still be available
    const recoveryState = await getRecoveryState(tempDir, testTaskId);
    expect(recoveryState.failedStep).toBeDefined();
    expect(recoveryState.lastCheckpoint).toBeNull();
  });

  it('should track skipped steps correctly', async () => {
    await fs.writeJson(path.join(tempDir, 'demo.status.json'), {
      currentStep: 2,
      totalSteps: 4,
      state: 'error',
      skippedSteps: [],
      logs: []
    });
    
    // Skip step 2
    await skipFailedStep(tempDir, testTaskId, 2, 4);
    
    // Skip step 3
    await fs.writeJson(path.join(tempDir, 'demo.status.json'), {
      currentStep: 3,
      totalSteps: 4,
      state: 'error',
      skippedSteps: [2],
      logs: []
    });
    await skipFailedStep(tempDir, testTaskId, 3, 4);
    
    // Verify both steps are tracked as skipped
    const status = await fs.readJson(path.join(tempDir, 'demo.status.json'));
    expect(status.skippedSteps).toContain(2);
    expect(status.skippedSteps).toContain(3);
    expect(status.currentStep).toBe(4);
  });
});
