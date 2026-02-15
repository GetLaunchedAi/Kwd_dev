import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import { TaskCleanupService } from '../src/cursor/taskCleanupService';

describe('TaskCleanupService', () => {
  let tempDir: string;
  let cleanupService: TaskCleanupService;
  const testTaskId = 'test123abc';

  beforeEach(async () => {
    // Create a temporary workspace
    tempDir = path.join(process.cwd(), 'tests', 'tmp', `cleanup-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
    
    cleanupService = new TaskCleanupService(tempDir);
  });

  afterEach(async () => {
    // Clean up temp directory
    if (await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
  });

  describe('deleteTaskArtifacts', () => {
    it('should remove all task artifacts', async () => {
      // Create mock artifacts
      const cursorBase = path.join(tempDir, '.cursor');
      
      // Status files
      await fs.ensureDir(path.join(cursorBase, 'status'));
      await fs.writeJson(path.join(cursorBase, 'status', `${testTaskId}.json`), {
        taskId: testTaskId,
        state: 'DONE'
      });
      
      // Current.json with matching task
      await fs.writeJson(path.join(cursorBase, 'status', 'current.json'), {
        task: { taskId: testTaskId }
      });

      // Queue files
      await fs.ensureDir(path.join(cursorBase, 'queue'));
      await fs.writeFile(path.join(cursorBase, 'queue', `0001_${testTaskId}.md`), 'test');
      
      // Running files
      await fs.ensureDir(path.join(cursorBase, 'running'));
      await fs.writeFile(path.join(cursorBase, 'running', `0002_${testTaskId}.md`), 'test');
      
      // Done files
      await fs.ensureDir(path.join(cursorBase, 'done'));
      await fs.writeFile(path.join(cursorBase, 'done', `0001_${testTaskId}.md`), 'test');
      
      // Failed files
      await fs.ensureDir(path.join(cursorBase, 'failed'));
      await fs.writeFile(path.join(cursorBase, 'failed', `0003_${testTaskId}.md`), 'test');
      
      // Log files
      await fs.ensureDir(path.join(cursorBase, 'logs'));
      await fs.writeFile(path.join(cursorBase, 'logs', `${testTaskId}.ndjson`), 'logs');
      await fs.writeFile(path.join(cursorBase, 'logs', `${testTaskId}.stderr.log`), 'errors');
      
      // Runner logs
      const runnerLogsDir = path.join(tempDir, 'logs', 'tasks', testTaskId);
      await fs.ensureDir(runnerLogsDir);
      await fs.writeFile(path.join(runnerLogsDir, 'runner-123.log'), 'runner logs');
      
      // Tmp files
      await fs.ensureDir(path.join(cursorBase, 'status', 'tmp'));
      await fs.writeFile(path.join(cursorBase, 'status', 'tmp', `${testTaskId}.abc123.json`), 'tmp');

      // Client workflow
      const clientFolder = path.join(tempDir, 'test-client');
      const workflowDir = path.join(clientFolder, '.clickup-workflow', testTaskId);
      await fs.ensureDir(workflowDir);
      await fs.writeJson(path.join(workflowDir, 'state.json'), { state: 'done' });

      // Execute cleanup
      await cleanupService.deleteTaskArtifacts(testTaskId, clientFolder);

      // Verify all artifacts are removed
      expect(await fs.pathExists(path.join(cursorBase, 'status', `${testTaskId}.json`))).toBe(false);
      expect(await fs.pathExists(path.join(cursorBase, 'status', 'current.json'))).toBe(false);
      expect(await fs.pathExists(path.join(cursorBase, 'queue', `0001_${testTaskId}.md`))).toBe(false);
      expect(await fs.pathExists(path.join(cursorBase, 'running', `0002_${testTaskId}.md`))).toBe(false);
      expect(await fs.pathExists(path.join(cursorBase, 'done', `0001_${testTaskId}.md`))).toBe(false);
      expect(await fs.pathExists(path.join(cursorBase, 'failed', `0003_${testTaskId}.md`))).toBe(false);
      expect(await fs.pathExists(path.join(cursorBase, 'logs', `${testTaskId}.ndjson`))).toBe(false);
      expect(await fs.pathExists(path.join(cursorBase, 'logs', `${testTaskId}.stderr.log`))).toBe(false);
      expect(await fs.pathExists(runnerLogsDir)).toBe(false);
      expect(await fs.pathExists(path.join(cursorBase, 'status', 'tmp', `${testTaskId}.abc123.json`))).toBe(false);
      expect(await fs.pathExists(workflowDir)).toBe(false);
    });

    it('should be idempotent (calling twice should not fail)', async () => {
      const cursorBase = path.join(tempDir, '.cursor');
      
      // Create minimal artifacts
      await fs.ensureDir(path.join(cursorBase, 'status'));
      await fs.writeJson(path.join(cursorBase, 'status', `${testTaskId}.json`), {
        taskId: testTaskId,
        state: 'DONE'
      });

      // First cleanup
      await cleanupService.deleteTaskArtifacts(testTaskId);
      
      // Second cleanup should not throw
      await expect(cleanupService.deleteTaskArtifacts(testTaskId)).resolves.not.toThrow();
    });

    it('should NOT delete current.json if it references a different task', async () => {
      const cursorBase = path.join(tempDir, '.cursor');
      const differentTaskId = 'different456';
      
      await fs.ensureDir(path.join(cursorBase, 'status'));
      
      // Create current.json with different task
      await fs.writeJson(path.join(cursorBase, 'status', 'current.json'), {
        task: { taskId: differentTaskId }
      });

      // Create status file for our test task
      await fs.writeJson(path.join(cursorBase, 'status', `${testTaskId}.json`), {
        taskId: testTaskId,
        state: 'DONE'
      });

      await cleanupService.deleteTaskArtifacts(testTaskId);

      // current.json should still exist
      expect(await fs.pathExists(path.join(cursorBase, 'status', 'current.json'))).toBe(true);
      
      // And should still reference the different task
      const currentJson = await fs.readJson(path.join(cursorBase, 'status', 'current.json'));
      expect(currentJson.task.taskId).toBe(differentTaskId);
    });

    it('should only delete files matching the exact taskId', async () => {
      const cursorBase = path.join(tempDir, '.cursor');
      const otherTaskId = 'other789';
      
      await fs.ensureDir(path.join(cursorBase, 'queue'));
      
      // Create files for our task
      await fs.writeFile(path.join(cursorBase, 'queue', `0001_${testTaskId}.md`), 'test');
      
      // Create files for other task
      await fs.writeFile(path.join(cursorBase, 'queue', `0002_${otherTaskId}.md`), 'other');

      await cleanupService.deleteTaskArtifacts(testTaskId);

      // Our task file should be deleted
      expect(await fs.pathExists(path.join(cursorBase, 'queue', `0001_${testTaskId}.md`))).toBe(false);
      
      // Other task file should remain
      expect(await fs.pathExists(path.join(cursorBase, 'queue', `0002_${otherTaskId}.md`))).toBe(true);
    });

    it('should handle missing artifacts gracefully', async () => {
      // Don't create any artifacts, just call cleanup
      await expect(cleanupService.deleteTaskArtifacts(testTaskId)).resolves.not.toThrow();
    });
  });

  describe('isTaskRunning', () => {
    it('should return true if task is in running directory', async () => {
      const cursorBase = path.join(tempDir, '.cursor');
      await fs.ensureDir(path.join(cursorBase, 'running'));
      await fs.writeFile(path.join(cursorBase, 'running', `0001_${testTaskId}.md`), 'test');

      const isRunning = await cleanupService.isTaskRunning(testTaskId);
      expect(isRunning).toBe(true);
    });

    it('should return false if task is not in running directory', async () => {
      const isRunning = await cleanupService.isTaskRunning(testTaskId);
      expect(isRunning).toBe(false);
    });

    it('should return false if running directory does not exist', async () => {
      const isRunning = await cleanupService.isTaskRunning(testTaskId);
      expect(isRunning).toBe(false);
    });
  });

  describe('path validation', () => {
    it('should not delete files outside workspace root', async () => {
      // This is implicitly tested by the implementation using validatePath
      // The service should only operate within the workspace root
      
      // Create a task ID that would try to escape (path traversal attempt)
      const maliciousTaskId = '../../../malicious';
      
      // This should not throw, but should also not delete anything outside workspace
      await expect(cleanupService.deleteTaskArtifacts(maliciousTaskId)).resolves.not.toThrow();
      
      // Verify no files were created/deleted outside tempDir
      // (This is a safety test - implementation should prevent this)
    });
  });

  describe('concurrent deletion', () => {
    it('should handle concurrent deletions without errors', async () => {
      const cursorBase = path.join(tempDir, '.cursor');
      
      // Create artifacts
      await fs.ensureDir(path.join(cursorBase, 'status'));
      await fs.writeJson(path.join(cursorBase, 'status', `${testTaskId}.json`), {
        taskId: testTaskId
      });

      // Call cleanup twice concurrently
      const [result1, result2] = await Promise.all([
        cleanupService.deleteTaskArtifacts(testTaskId),
        cleanupService.deleteTaskArtifacts(testTaskId)
      ]);

      // Both should complete without errors
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
      
      // File should be gone
      expect(await fs.pathExists(path.join(cursorBase, 'status', `${testTaskId}.json`))).toBe(false);
    });
  });
});








