import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';

// Mock modules before imports
vi.mock('simple-git', () => {
  return {
    default: vi.fn(() => ({
      revparse: vi.fn().mockResolvedValue('abc123def456'),
      status: vi.fn().mockResolvedValue({ current: 'main' }),
      catFile: vi.fn().mockResolvedValue('commit'),
      branchLocal: vi.fn().mockResolvedValue({ all: ['main', 'dev'] })
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

// Import after mocks
import {
  createCheckpoint,
  validateCheckpoint,
  getRecoveryOptions,
  getRecoveryOptionsResponse,
  findRecoveryCheckpoint,
  MAX_RETRIES
} from '../src/state/checkpointService';
import { StepCheckpoint, FailedStepInfo } from '../src/state/stateManager';

describe('CheckpointService', () => {
  let tempDir: string;
  const testTaskId = 'demo-test-client';

  beforeEach(async () => {
    // Create a temporary workspace
    tempDir = path.join(process.cwd(), 'tests', 'tmp', `checkpoint-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
    
    // Create minimal state directory structure
    await fs.ensureDir(path.join(tempDir, '.clickup-workflow', testTaskId));
  });

  afterEach(async () => {
    // Clean up temp directory
    if (await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
    vi.clearAllMocks();
  });

  describe('createCheckpoint', () => {
    it('should create a checkpoint with git commit hash', async () => {
      // Create demo.context.json
      await fs.writeJson(path.join(tempDir, 'demo.context.json'), {
        businessName: 'Test Business',
        clientSlug: 'test-client'
      });

      const result = await createCheckpoint(tempDir, testTaskId, 1, 'branding');
      
      expect(result.success).toBe(true);
      expect(result.checkpoint).toBeDefined();
      expect(result.checkpoint?.stepNumber).toBe(1);
      expect(result.checkpoint?.stepName).toBe('branding');
      expect(result.checkpoint?.gitCommitHash).toBe('abc123def456');
      expect(result.checkpoint?.gitBranch).toBe('main');
    });

    it('should include context snapshot if demo.context.json exists', async () => {
      const context = { businessName: 'Test', services: 'Plumbing' };
      await fs.writeJson(path.join(tempDir, 'demo.context.json'), context);

      const result = await createCheckpoint(tempDir, testTaskId, 1);
      
      expect(result.success).toBe(true);
      expect(result.checkpoint?.contextSnapshot).toEqual(context);
    });

    it('should use default step name if not provided', async () => {
      const result = await createCheckpoint(tempDir, testTaskId, 2);
      
      expect(result.success).toBe(true);
      expect(result.checkpoint?.stepName).toBe('copywriting');
    });
  });

  describe('validateCheckpoint', () => {
    it('should return valid for a valid checkpoint', async () => {
      const checkpoint: StepCheckpoint = {
        stepNumber: 1,
        stepName: 'branding',
        timestamp: new Date().toISOString(),
        gitCommitHash: 'abc123def456',
        gitBranch: 'main',
        artifactPaths: []
      };

      const result = await validateCheckpoint(tempDir, checkpoint);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should add warnings for missing artifact paths', async () => {
      const checkpoint: StepCheckpoint = {
        stepNumber: 1,
        stepName: 'branding',
        timestamp: new Date().toISOString(),
        gitCommitHash: 'abc123def456',
        gitBranch: 'main',
        artifactPaths: ['/nonexistent/path']
      };

      const result = await validateCheckpoint(tempDir, checkpoint);
      
      expect(result.valid).toBe(true); // Missing artifacts are warnings, not errors
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('/nonexistent/path');
    });
  });

  describe('getRecoveryOptions', () => {
    it('should return retry as primary action for model errors', () => {
      const failedStep: FailedStepInfo = {
        stepNumber: 2,
        stepName: 'copywriting',
        errorCategory: 'model_error',
        errorMessage: 'Model unavailable',
        timestamp: new Date().toISOString(),
        retryCount: 0
      };

      const options = getRecoveryOptions('model_error', failedStep, 4);
      
      expect(options[0].action).toBe('retry');
      expect(options[0].disabled).toBe(false);
    });

    it('should disable retry for credit limit errors', () => {
      const failedStep: FailedStepInfo = {
        stepNumber: 2,
        stepName: 'copywriting',
        errorCategory: 'credit_limit',
        errorMessage: 'Credits exhausted',
        timestamp: new Date().toISOString(),
        retryCount: 0
      };

      const options = getRecoveryOptions('credit_limit', failedStep, 4);
      
      const retryOption = options.find(o => o.action === 'retry');
      expect(retryOption?.disabled).toBe(true);
      
      // Should have a wait option for credit errors
      const waitOption = options.find(o => o.action === 'wait');
      expect(waitOption).toBeDefined();
    });

    it('should disable skip for final step', () => {
      const failedStep: FailedStepInfo = {
        stepNumber: 4,
        stepName: 'review',
        errorCategory: 'timeout',
        errorMessage: 'Timeout',
        timestamp: new Date().toISOString(),
        retryCount: 0
      };

      const options = getRecoveryOptions('timeout', failedStep, 4);
      
      const skipOption = options.find(o => o.action === 'skip');
      expect(skipOption).toBeUndefined(); // Skip not available for final step
    });

    it('should allow skip for non-final steps with skippable errors', () => {
      const failedStep: FailedStepInfo = {
        stepNumber: 2,
        stepName: 'copywriting',
        errorCategory: 'timeout',
        errorMessage: 'Timeout',
        timestamp: new Date().toISOString(),
        retryCount: 0
      };

      const options = getRecoveryOptions('timeout', failedStep, 4);
      
      const skipOption = options.find(o => o.action === 'skip');
      expect(skipOption).toBeDefined();
      expect(skipOption?.disabled).toBe(false);
    });

    it('should disable retry when max retries reached', () => {
      const failedStep: FailedStepInfo = {
        stepNumber: 2,
        stepName: 'copywriting',
        errorCategory: 'timeout',
        errorMessage: 'Timeout',
        timestamp: new Date().toISOString(),
        retryCount: MAX_RETRIES // At limit
      };

      const options = getRecoveryOptions('timeout', failedStep, 4);
      
      const retryOption = options.find(o => o.action === 'retry');
      expect(retryOption?.disabled).toBe(true);
      expect(retryOption?.disabledReason).toContain('Maximum retries');
    });

    it('should always include abort option', () => {
      const failedStep: FailedStepInfo = {
        stepNumber: 2,
        stepName: 'copywriting',
        errorCategory: 'unknown',
        errorMessage: 'Unknown error',
        timestamp: new Date().toISOString(),
        retryCount: 0
      };

      const options = getRecoveryOptions('unknown', failedStep, 4);
      
      const abortOption = options.find(o => o.action === 'abort');
      expect(abortOption).toBeDefined();
      expect(abortOption?.variant).toBe('danger');
    });
  });

  describe('MAX_RETRIES', () => {
    it('should export MAX_RETRIES constant', () => {
      expect(MAX_RETRIES).toBe(3);
    });
  });
});

describe('Recovery Options Response', () => {
  it('should export getRecoveryOptionsResponse function', () => {
    expect(typeof getRecoveryOptionsResponse).toBe('function');
  });

  it('should export findRecoveryCheckpoint function', () => {
    expect(typeof findRecoveryCheckpoint).toBe('function');
  });
});
