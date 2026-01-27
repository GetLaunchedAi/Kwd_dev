import { logger } from './logger';
import * as path from 'path';
import * as fs from 'fs-extra';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ImageRetrievalRequest {
  query: string;
  shape: 'landscape' | 'portrait' | 'square';
  context: string;
  outputPath: string;
  maxTurns?: number;
}

export interface ImageRetrievalResult {
  success: boolean;
  filename?: string;
  error?: string;
  manifestPath?: string;
}

/**
 * Service to retrieve images using the ImageRetriever tool
 */
export class ImageRetrieverService {
  private imageRetrieverPath: string;

  constructor() {
    try {
      // Priority order for ImageRetriever path resolution:
      // 1. IMAGE_RETRIEVER_PATH environment variable (explicit configuration)
      // 2. ../ImageRetriever (sibling directory - keeps repo lightweight)
      // 3. ./ImageRetriever (subdirectory - backward compatibility)
      
      const envPath = process.env.IMAGE_RETRIEVER_PATH;
      
      // Check if env var is set and not just whitespace
      if (envPath && envPath.trim() !== '') {
        const resolvedPath = path.resolve(envPath.trim());
        // Validate the env path before using it
        if (this.validatePath(resolvedPath)) {
          this.imageRetrieverPath = resolvedPath;
          logger.info(`[ImageRetriever] Using path from IMAGE_RETRIEVER_PATH: ${this.imageRetrieverPath}`);
        } else {
          logger.warn(
            `[ImageRetriever] IMAGE_RETRIEVER_PATH is set to "${envPath}" but is invalid or inaccessible. ` +
            `Falling back to auto-detection.`
          );
          this.imageRetrieverPath = this.detectImageRetrieverPath();
        }
      } else {
        // No env var set, use auto-detection
        this.imageRetrieverPath = this.detectImageRetrieverPath();
      }
    } catch (error: any) {
      const errorMsg = error?.message || 'Unknown error';
      logger.error(
        `[ImageRetriever] Error during path initialization: ${errorMsg}. ` +
        `Using default fallback path.`
      );
      // Fallback to local directory on any initialization error
      this.imageRetrieverPath = path.join(process.cwd(), 'ImageRetriever');
    }
  }

  /**
   * Validate that a path exists and contains a valid ImageRetriever installation
   * Checks for both directory existence and package.json presence
   * Must be synchronous as it's called from constructor
   * 
   * @param checkPath - Absolute path to validate
   * @returns true if path is valid ImageRetriever installation, false otherwise
   */
  private validatePath(checkPath: string): boolean {
    try {
      // Check if directory exists and is accessible
      if (!fs.existsSync(checkPath)) {
        return false;
      }
      
      // Verify it's a directory (not a file)
      const stats = fs.statSync(checkPath);
      if (!stats.isDirectory()) {
        return false;
      }
      
      // Verify package.json exists (indicates it's a Node.js project)
      const packageJsonPath = path.join(checkPath, 'package.json');
      return fs.existsSync(packageJsonPath);
      
    } catch (error: any) {
      // Catch permission errors, invalid paths, etc.
      const errorMsg = error?.message || 'Unknown error';
      logger.debug(`[ImageRetriever] Path validation failed for "${checkPath}": ${errorMsg}`);
      return false;
    }
  }

  /**
   * Auto-detect ImageRetriever location from common paths
   * Checks sibling directory first, then local directory
   * Must be synchronous as it's called from constructor
   * 
   * @returns Resolved absolute path to ImageRetriever (may not exist)
   */
  private detectImageRetrieverPath(): string {
    // Check common locations in priority order
    const siblingPath = path.resolve(process.cwd(), '..', 'ImageRetriever');
    const localPath = path.join(process.cwd(), 'ImageRetriever');
    
    if (this.validatePath(siblingPath)) {
      logger.info(`[ImageRetriever] Auto-detected at sibling directory: ${siblingPath}`);
      return siblingPath;
    } else if (this.validatePath(localPath)) {
      logger.info(`[ImageRetriever] Auto-detected at local directory: ${localPath}`);
      return localPath;
    } else {
      logger.warn(
        `[ImageRetriever] Not found at any default location. ` +
        `Searched: ${siblingPath}, ${localPath}. ` +
        `Image retrieval features will be disabled.`
      );
      // Return local path as fallback (will fail isAvailable() check)
      return localPath;
    }
  }

  /**
   * Check if ImageRetriever is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const packageJsonPath = path.join(this.imageRetrieverPath, 'package.json');
      return await fs.pathExists(packageJsonPath);
    } catch (error) {
      return false;
    }
  }

  /**
   * Ensure ImageRetriever dependencies are installed
   */
  async ensureInstalled(): Promise<void> {
    const nodeModulesPath = path.join(this.imageRetrieverPath, 'node_modules');
    
    if (!await fs.pathExists(nodeModulesPath)) {
      logger.info('ImageRetriever dependencies not found, installing...');
      try {
        const { stdout, stderr } = await execAsync('npm install', { 
          cwd: this.imageRetrieverPath,
          timeout: 120000 // 2 minute timeout
        });
        logger.info('ImageRetriever dependencies installed successfully');
        if (stderr && !stderr.includes('npm WARN')) {
          logger.warn(`npm install stderr: ${stderr}`);
        }
      } catch (error: any) {
        logger.error(`Failed to install ImageRetriever dependencies: ${error.message}`);
        throw new Error(`ImageRetriever setup failed: ${error.message}`);
      }
    }
  }

  /**
   * Retrieve an image using the ImageRetriever CLI
   */
  async retrieveImage(request: ImageRetrievalRequest): Promise<ImageRetrievalResult> {
    try {
      // Ensure ImageRetriever is available
      if (!await this.isAvailable()) {
        return {
          success: false,
          error: 'ImageRetriever tool is not available in this workspace'
        };
      }

      // Ensure dependencies are installed
      await this.ensureInstalled();

      // Ensure output directory exists
      await fs.ensureDir(request.outputPath);

      // Build the CLI command
      const maxTurns = request.maxTurns || 5;
      const command = [
        'npm run start --',
        `--query "${request.query.replace(/"/g, '\\"')}"`,
        `--shape ${request.shape}`,
        `--context "${request.context.replace(/"/g, '\\"')}"`,
        `--output "${request.outputPath}"`,
        `--turns ${maxTurns}`
      ].join(' ');

      logger.info(`Retrieving image with query: "${request.query}" (${request.shape})`);

      // Execute the ImageRetriever CLI
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.imageRetrieverPath,
        timeout: 180000 // 3 minute timeout
      });

      // Log output
      if (stdout) logger.info(`ImageRetriever output: ${stdout}`);
      if (stderr) logger.warn(`ImageRetriever stderr: ${stderr}`);

      // Check if image was downloaded
      const files = await fs.readdir(request.outputPath);
      const imageFiles = files.filter(f => 
        /\.(jpg|jpeg|png|webp)$/i.test(f) && !f.includes('manifest')
      );

      if (imageFiles.length === 0) {
        return {
          success: false,
          error: 'No suitable image found after retrieval'
        };
      }

      // Get the most recently created image
      const imagePath = path.join(request.outputPath, imageFiles[imageFiles.length - 1]);
      const manifestFiles = files.filter(f => f.endsWith('.json'));
      const manifestPath = manifestFiles.length > 0 
        ? path.join(request.outputPath, manifestFiles[manifestFiles.length - 1])
        : undefined;

      logger.info(`Image retrieved successfully: ${imageFiles[imageFiles.length - 1]}`);

      return {
        success: true,
        filename: imageFiles[imageFiles.length - 1],
        manifestPath
      };

    } catch (error: any) {
      logger.error(`Error retrieving image: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get the path to the ImageRetriever directory for agent reference
   */
  getImageRetrieverPath(): string {
    return this.imageRetrieverPath;
  }

  /**
   * Generate instructions for agents on how to use ImageRetriever
   */
  generateAgentInstructions(): string {
    return `
## Using ImageRetriever

The ImageRetriever tool is available at: \`${this.imageRetrieverPath}\`

### Command Line Usage:
\`\`\`bash
cd ${this.imageRetrieverPath}
npm start -- --query "your search query" --shape landscape --context "relevant context" --output ./downloads
\`\`\`

### Parameters:
- \`--query\`: Search query for the image (e.g., "modern office space", "bakery fresh bread")
- \`--shape\`: Image orientation - \`landscape\`, \`portrait\`, or \`square\`
- \`--context\`: Related text for relevance scoring (business description, page content, etc.)
- \`--output\`: Directory to save the downloaded image (default: ./downloads)
- \`--turns\`: Maximum retrieval attempts (default: 5)

### Example:
\`\`\`bash
npm start -- --query "professional plumbing service" --shape landscape --context "Family-owned plumbing business serving residential and commercial clients" --output ../client-websites/sunny-plumbing/src/assets/images
\`\`\`

The tool will:
1. Search multiple providers (Unsplash, Google) for relevant images
2. Score candidates based on relevance, quality, and aspect ratio
3. Use AI vision verification to ensure accuracy
4. Automatically upscale low-resolution or blurry images
5. Download the best match and create a metadata manifest

Retrieved images will be saved in the specified output directory with accompanying JSON metadata.
`.trim();
  }
}

// Export singleton instance
export const imageRetrieverService = new ImageRetrieverService();




