import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import { triggerCursorAgent } from '../src/cursor/workspaceManager';
import { triggerAgent } from '../src/cursor/agentTrigger';
import { agentQueue } from '../src/cursor/agentQueue';
import { config } from '../src/config/config';
import { ClickUpTask } from '../src/clickup/apiClient';

// Mock dependencies
vi.mock('fs-extra', () => {
  const mockFn = {
    existsSync: vi.fn().mockReturnValue(true),
    readJsonSync: vi.fn().mockReturnValue({}),
    readdir: vi.fn().mockResolvedValue([]),
    pathExists: vi.fn().mockResolvedValue(true),
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    writeJson: vi.fn().mockResolvedValue(undefined),
    readJson: vi.fn().mockResolvedValue({}),
    rename: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtimeMs: Date.now() }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined)
  };
  return {
    ...mockFn,
    default: mockFn
  };
});

vi.mock('js-yaml', () => ({
  dump: vi.fn((obj) => `taskId: ${obj.taskId}`),
  load: vi.fn((str) => ({ taskId: 'test-task-123' })),
  default: {
    dump: vi.fn((obj) => `taskId: ${obj.taskId}`),
    load: vi.fn((str) => ({ taskId: 'test-task-123' })),
  }
}));
vi.mock('child_process', () => ({
  exec: vi.fn((cmd, cb) => cb(null, { stdout: '', stderr: '' })),
  promisify: (fn) => fn
}));
vi.mock('../src/git/repoManager', () => ({
  pullLatestChanges: vi.fn().mockResolvedValue(undefined),
  ensureCleanWorkingDirectory: vi.fn().mockResolvedValue(true)
}));
vi.mock('../src/cursor/promptGenerator', () => ({
  generatePromptFile: vi.fn().mockResolvedValue('CURSOR_TASK.md')
}));
vi.mock('../src/state/stateManager', () => ({
  updateWorkflowState: vi.fn().mockResolvedValue(undefined),
  WorkflowState: { IN_PROGRESS: 'in_progress', PENDING: 'pending' },
  loadTaskState: vi.fn().mockResolvedValue({ state: 'pending' })
}));
vi.mock('../src/testing/testRunner', () => ({
  detectTestFramework: vi.fn().mockResolvedValue('npm test')
}));
vi.mock('../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

describe('Queue Mode Integration', () => {
  const mockTask: ClickUpTask = {
    id: 'test-task-123',
    name: 'Test Task',
    description: 'Test Description',
    status: { status: 'open' },
    custom_fields: []
  } as any;

  const clientFolder = '/tmp/test-workspace';

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup fs-extra mocks
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readJsonSync as any).mockReturnValue({});
    (fs.readdir as any).mockResolvedValue([]);
    (fs.pathExists as any).mockResolvedValue(true);
    (fs.ensureDir as any).mockResolvedValue(undefined);
    (fs.writeFile as any).mockResolvedValue(undefined);
    (fs.readFile as any).mockResolvedValue('');
    (fs.writeJson as any).mockResolvedValue(undefined);
    (fs.readJson as any).mockResolvedValue({});
    (fs.rename as any).mockResolvedValue(undefined);
    (fs.stat as any).mockResolvedValue({ mtimeMs: Date.now() });
    (fs.mkdir as any).mockResolvedValue(undefined);
    (fs.remove as any).mockResolvedValue(undefined);

    // Also for default export if used via require
    const fse = (fs as any).default;
    fse.existsSync.mockReturnValue(true);
    fse.readJsonSync.mockReturnValue({});
    fse.readdir.mockResolvedValue([]);
    fse.pathExists.mockResolvedValue(true);
    fse.ensureDir.mockResolvedValue(undefined);
    fse.writeFile.mockResolvedValue(undefined);
    fse.readFile.mockResolvedValue('');
    fse.writeJson.mockResolvedValue(undefined);
    fse.readJson.mockResolvedValue({});
    fse.rename.mockResolvedValue(undefined);
    fse.stat.mockResolvedValue({ mtimeMs: Date.now() });
    fse.mkdir.mockResolvedValue(undefined);
    fse.remove.mockResolvedValue(undefined);

    // Default config
    (config as any).cursor = {
      cliPath: 'cursor',
      autoOpen: false,
      agentMode: false,
      agentTriggerMethod: 'file',
      triggerMode: 'queue',
      queue: {
        ttlMinutes: 60,
        maxTasksPerWorkspace: 2
      }
    };
    
    // Mock fs.readdir for queue initialization
    (fs.readdir as any).mockResolvedValue([]);
    (fs.pathExists as any).mockResolvedValue(true);
    (fs.ensureDir as any).mockResolvedValue(undefined);
    (fs.writeFile as any).mockResolvedValue(undefined);
  });

  describe('workspaceManager.ts', () => {
    it('should create .cursor/ hierarchy and enqueue task in queue mode', async () => {
      await triggerCursorAgent(clientFolder, mockTask);

      // Verify .cursor directories are ensured
      expect(fs.ensureDir).toHaveBeenCalledWith(expect.stringContaining(path.join('.cursor', 'queue')));
      expect(fs.ensureDir).toHaveBeenCalledWith(expect.stringContaining(path.join('.cursor', 'running')));

      // Verify task is enqueued in .cursor/queue/
      // The filename starts with 0001 because we cleared mocks and readdir returns []
      const expectedFile = path.join('.cursor', 'queue', '0001_test-task-123.md');
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(expectedFile),
        expect.stringContaining('taskId: test-task-123'),
        'utf8'
      );
    });

    it('should NOT create CURSOR_TASK.md in queue mode', async () => {
      await triggerCursorAgent(clientFolder, mockTask);

      // Should not call writeFile for CURSOR_TASK.md in the root
      const writeFileCalls = (fs.writeFile as any).mock.calls;
      const cursorTaskCreated = writeFileCalls.some((call: any) => 
        call[0].endsWith('CURSOR_TASK.md')
      );
      expect(cursorTaskCreated).toBe(false);
    });

    it('should respect maxTasksPerWorkspace and throw error when limit hit', async () => {
      // Mock 2 existing tasks in queue
      (fs.readdir as any).mockResolvedValue(['0001_task1.md', '0002_task2.md']);
      
      await expect(triggerCursorAgent(clientFolder, mockTask))
        .rejects.toThrow(/Maximum tasks per workspace reached/);
    });
  });

  describe('agentTrigger.ts', () => {
    it('should NOT call legacy UI automation paths in queue mode', async () => {
      const { exec } = await import('child_process');
      
      await triggerAgent(clientFolder, 'some/path', mockTask);

      // exec should only be called for process verification (tasklist) on Windows, 
      // or not at all if we mock the platform.
      // Let's check that triggerViaFile logic (writing .cursorrules) is not called.
      const writeFileCalls = (fs.writeFile as any).mock.calls;
      const cursorRulesCreated = writeFileCalls.some((call: any) => 
        call[0].endsWith('.cursorrules')
      );
      expect(cursorRulesCreated).toBe(false);
    });

    it('should call legacy path when triggerMode is "ui"', async () => {
      (config as any).cursor.triggerMode = 'ui';
      
      await triggerAgent(clientFolder, 'CURSOR_TASK.md', mockTask);

      // Verify .cursorrules is created for legacy UI mode
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.cursorrules'),
        expect.stringContaining('Automated Task Processing'),
        expect.stringMatching(/utf-?8/)
      );
    });
  });

  describe('config defaults', () => {
    it('should default triggerMode to "queue" when missing', async () => {
      delete (config.cursor as any).triggerMode;
      
      // We check the behavior in triggerCursorAgent
      await triggerCursorAgent(clientFolder, mockTask);
      
      // Should have enqueued
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/0001_test-task-123\.md$/),
        expect.anything(),
        'utf8'
      );
    });

    it('should use ttlMinutes from config', async () => {
      const ttl = 45;
      (config as any).cursor.queue.ttlMinutes = ttl;
      
      // Verify AgentQueue uses it (we can test detectStaleTasks)
      const mockStats = { mtimeMs: Date.now() - (ttl + 1) * 60 * 1000 };
      (fs.readdir as any).mockResolvedValue(['running_task.md']);
      (fs.stat as any).mockResolvedValue(mockStats);
      (fs.rename as any).mockResolvedValue(undefined);
      (fs.readJson as any).mockResolvedValue({});
      (fs.writeJson as any).mockResolvedValue(undefined);

      await agentQueue.detectStaleTasks(ttl);

      // Should have moved the stale task to failed
      // Use path.join to be cross-platform safe
      const expectedOld = path.join('running', 'running_task.md');
      const expectedNew = path.join('failed', 'running_task.md');
      
      expect(fs.rename).toHaveBeenCalledWith(
        expect.stringContaining(expectedOld),
        expect.stringContaining(expectedNew)
      );
    });
  });
});

