import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { ImageRetrieverService, imageRetrieverService } from '../src/utils/imageRetrieverService';
import * as path from 'path';
import * as fs from 'fs-extra';

describe('ImageRetrieverService', () => {
  const testOutputDir = path.join(process.cwd(), 'temp-uploads', 'test-image-retrieval');

  beforeAll(async () => {
    // Ensure test output directory exists
    await fs.ensureDir(testOutputDir);
  });

  describe('Path Resolution', () => {
    it('should have correct ImageRetriever path', () => {
      const retrieverPath = imageRetrieverService.getImageRetrieverPath();
      expect(retrieverPath).toContain('ImageRetriever');
      expect(path.isAbsolute(retrieverPath)).toBe(true);
    });

    it('should return an absolute path', () => {
      const retrieverPath = imageRetrieverService.getImageRetrieverPath();
      expect(path.isAbsolute(retrieverPath)).toBe(true);
    });
  });

  describe('Env Var Path Resolution', () => {
    const originalEnv = process.env.IMAGE_RETRIEVER_PATH;

    afterEach(() => {
      // Restore original env var
      if (originalEnv !== undefined) {
        process.env.IMAGE_RETRIEVER_PATH = originalEnv;
      } else {
        delete process.env.IMAGE_RETRIEVER_PATH;
      }
    });

    it('should use IMAGE_RETRIEVER_PATH when set to valid directory', async () => {
      // Create a temp directory with package.json to simulate valid ImageRetriever
      const testPath = path.join(process.cwd(), 'temp-uploads', 'test-image-retriever-env');
      await fs.ensureDir(testPath);
      await fs.writeJson(path.join(testPath, 'package.json'), { name: 'test-image-retriever' });
      
      process.env.IMAGE_RETRIEVER_PATH = testPath;
      
      const service = new ImageRetrieverService();
      expect(service.getImageRetrieverPath()).toBe(testPath);
      
      // Cleanup
      await fs.remove(testPath);
    });

    it('should fall back to auto-detection when env path is invalid', () => {
      process.env.IMAGE_RETRIEVER_PATH = '/nonexistent/path/to/nowhere';
      
      const service = new ImageRetrieverService();
      const resultPath = service.getImageRetrieverPath();
      
      // Should not be the invalid path
      expect(resultPath).not.toBe('/nonexistent/path/to/nowhere');
      // Should contain ImageRetriever (either auto-detected or default fallback)
      expect(resultPath).toContain('ImageRetriever');
    });

    it('should treat empty string env var as unset', () => {
      process.env.IMAGE_RETRIEVER_PATH = '';
      
      const service = new ImageRetrieverService();
      const resultPath = service.getImageRetrieverPath();
      
      // Should use auto-detection, not empty path
      expect(resultPath).not.toBe('');
      expect(resultPath).toContain('ImageRetriever');
    });

    it('should trim whitespace from env var path', async () => {
      // Create a temp directory with package.json
      const testPath = path.join(process.cwd(), 'temp-uploads', 'test-image-retriever-trim');
      await fs.ensureDir(testPath);
      await fs.writeJson(path.join(testPath, 'package.json'), { name: 'test-image-retriever' });
      
      process.env.IMAGE_RETRIEVER_PATH = `  ${testPath}  `;
      
      const service = new ImageRetrieverService();
      expect(service.getImageRetrieverPath()).toBe(testPath);
      
      // Cleanup
      await fs.remove(testPath);
    });

    it('should treat whitespace-only env var as unset', () => {
      process.env.IMAGE_RETRIEVER_PATH = '   ';
      
      const service = new ImageRetrieverService();
      const resultPath = service.getImageRetrieverPath();
      
      // Should use auto-detection, not whitespace
      expect(resultPath.trim()).not.toBe('');
      expect(resultPath).toContain('ImageRetriever');
    });
  });

  describe('Path Validation', () => {
    it('should reject non-existent paths', () => {
      const service = new ImageRetrieverService();
      // Access private method via type casting for testing
      const validatePath = (service as any).validatePath.bind(service);
      
      expect(validatePath('/definitely/not/a/real/path')).toBe(false);
    });

    it('should reject paths that are files, not directories', async () => {
      // Create a test file (not directory)
      const testFile = path.join(process.cwd(), 'temp-uploads', 'test-file.txt');
      await fs.writeFile(testFile, 'test content');
      
      const service = new ImageRetrieverService();
      const validatePath = (service as any).validatePath.bind(service);
      
      expect(validatePath(testFile)).toBe(false);
      
      // Cleanup
      await fs.remove(testFile);
    });

    it('should reject directories without package.json', async () => {
      // Create a directory without package.json
      const testDir = path.join(process.cwd(), 'temp-uploads', 'test-no-package');
      await fs.ensureDir(testDir);
      
      const service = new ImageRetrieverService();
      const validatePath = (service as any).validatePath.bind(service);
      
      expect(validatePath(testDir)).toBe(false);
      
      // Cleanup
      await fs.remove(testDir);
    });

    it('should accept valid directories with package.json', async () => {
      // Create a directory with package.json
      const testDir = path.join(process.cwd(), 'temp-uploads', 'test-valid-package');
      await fs.ensureDir(testDir);
      await fs.writeJson(path.join(testDir, 'package.json'), { name: 'test-package' });
      
      const service = new ImageRetrieverService();
      const validatePath = (service as any).validatePath.bind(service);
      
      expect(validatePath(testDir)).toBe(true);
      
      // Cleanup
      await fs.remove(testDir);
    });
  });

  describe('Availability Check', () => {
    it('should check if ImageRetriever is available', async () => {
      const available = await imageRetrieverService.isAvailable();
      // This should be true if ImageRetriever directory exists
      expect(typeof available).toBe('boolean');
    });

    it('should return false for missing ImageRetriever', async () => {
      // Create a service with invalid path
      const service = new ImageRetrieverService();
      (service as any).imageRetrieverPath = '/nonexistent/path';
      
      const available = await service.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('Agent Instructions', () => {
    it('should generate agent instructions', () => {
      const instructions = imageRetrieverService.generateAgentInstructions();
      expect(instructions).toContain('ImageRetriever');
      expect(instructions).toContain('--query');
      expect(instructions).toContain('--shape');
      expect(instructions).toContain('--context');
      expect(instructions).toContain('landscape');
      expect(instructions).toContain('portrait');
      expect(instructions).toContain('square');
    });

    it('should include the actual ImageRetriever path in instructions', () => {
      const instructions = imageRetrieverService.generateAgentInstructions();
      const retrieverPath = imageRetrieverService.getImageRetrieverPath();
      expect(instructions).toContain(retrieverPath);
    });
  });

  describe('Graceful Degradation', () => {
    it('should handle missing ImageRetriever gracefully', async () => {
      // Test with invalid path (simulate missing ImageRetriever)
      const service = new ImageRetrieverService();
      (service as any).imageRetrieverPath = '/nonexistent/path';
      
      const available = await service.isAvailable();
      expect(available).toBe(false);
    });

    it('should return error result when ImageRetriever is not available', async () => {
      const service = new ImageRetrieverService();
      (service as any).imageRetrieverPath = '/nonexistent/path';
      
      const result = await service.retrieveImage({
        query: 'test query',
        shape: 'landscape',
        context: 'test context',
        outputPath: testOutputDir
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not available');
    });

    it('should not throw during construction even with invalid env var', () => {
      const originalEnv = process.env.IMAGE_RETRIEVER_PATH;
      process.env.IMAGE_RETRIEVER_PATH = '/invalid/path';
      
      expect(() => new ImageRetrieverService()).not.toThrow();
      
      // Restore
      if (originalEnv !== undefined) {
        process.env.IMAGE_RETRIEVER_PATH = originalEnv;
      } else {
        delete process.env.IMAGE_RETRIEVER_PATH;
      }
    });
  });

  describe('Cross-Platform Path Handling', () => {
    it('should handle Windows-style paths', () => {
      const originalEnv = process.env.IMAGE_RETRIEVER_PATH;
      
      // This test verifies path.resolve handles the input correctly
      // On non-Windows systems, this will resolve to a Unix-style path
      const windowsPath = 'D:\\Tools\\ImageRetriever';
      process.env.IMAGE_RETRIEVER_PATH = windowsPath;
      
      // Should not throw during construction
      expect(() => new ImageRetrieverService()).not.toThrow();
      
      // Restore
      if (originalEnv !== undefined) {
        process.env.IMAGE_RETRIEVER_PATH = originalEnv;
      } else {
        delete process.env.IMAGE_RETRIEVER_PATH;
      }
    });

    it('should handle relative paths by resolving to absolute', async () => {
      // Create a relative test directory
      const relativeTestPath = './temp-uploads/test-relative-path';
      await fs.ensureDir(relativeTestPath);
      await fs.writeJson(path.join(relativeTestPath, 'package.json'), { name: 'test' });
      
      const originalEnv = process.env.IMAGE_RETRIEVER_PATH;
      process.env.IMAGE_RETRIEVER_PATH = relativeTestPath;
      
      const service = new ImageRetrieverService();
      const resultPath = service.getImageRetrieverPath();
      
      // Should be resolved to absolute path
      expect(path.isAbsolute(resultPath)).toBe(true);
      
      // Restore and cleanup
      if (originalEnv !== undefined) {
        process.env.IMAGE_RETRIEVER_PATH = originalEnv;
      } else {
        delete process.env.IMAGE_RETRIEVER_PATH;
      }
      await fs.remove(relativeTestPath);
    });
  });

  // Note: We skip actual image retrieval tests to avoid:
  // 1. API rate limits during testing
  // 2. Network dependencies
  // 3. Long test execution times
  // 
  // Integration tests should be run manually or in a separate CI pipeline
  // with proper API keys and network access.
  
  it.skip('should retrieve an image (integration test - manual only)', async () => {
    // This test requires:
    // - Valid API keys in ImageRetriever/.env
    // - Network access
    // - ~30-60 seconds execution time
    
    const result = await imageRetrieverService.retrieveImage({
      query: 'modern office workspace',
      shape: 'landscape',
      context: 'Professional business environment with natural lighting',
      outputPath: testOutputDir,
      maxTurns: 2 // Limited turns for faster testing
    });

    if (result.success) {
      expect(result.filename).toBeDefined();
      expect(result.filename).toMatch(/\.(jpg|jpeg|png|webp)$/i);
      
      // Verify file exists
      const imagePath = path.join(testOutputDir, result.filename!);
      const exists = await fs.pathExists(imagePath);
      expect(exists).toBe(true);
      
      // Verify manifest exists if provided
      if (result.manifestPath) {
        const manifestExists = await fs.pathExists(result.manifestPath);
        expect(manifestExists).toBe(true);
      }
    } else {
      // If it fails, we should have an error message
      expect(result.error).toBeDefined();
      console.warn('Image retrieval failed (expected in test environment):', result.error);
    }
  });
});




