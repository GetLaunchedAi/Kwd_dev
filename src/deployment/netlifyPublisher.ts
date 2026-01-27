import * as fs from 'fs-extra';
import * as path from 'path';
import axios, { AxiosError } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { buildDemo } from '../handlers/demoHandler';

/**
 * Netlify Publisher Module
 * 
 * Handles deployment of demo sites to Netlify after GitHub publishing.
 * Flow: Validate → Build Check → Create Site → Configure → Deploy → Poll Status
 */

// =============================================================================
// TYPES & INTERFACES
// =============================================================================

/**
 * All possible states returned by the Netlify Deploy API.
 * These are the raw states from Netlify's API - the full lifecycle of a deployment.
 */
export type NetlifyDeployApiState = 
  | 'new'        // Deploy just created
  | 'pending'    // Waiting to start
  | 'uploading'  // Files being uploaded
  | 'uploaded'   // Files uploaded, waiting for processing
  | 'preparing'  // Preparing the deploy
  | 'prepared'   // Ready for building
  | 'building'   // Build in progress
  | 'processing' // Post-build processing
  | 'processed'  // Processing complete
  | 'ready'      // Deploy is live (terminal success)
  | 'error'      // Deploy failed (terminal failure)
  | 'cancelled'; // Deploy was cancelled (terminal failure)

/**
 * Simplified deploy states for UI consumption.
 * Maps the 12+ API states to 5 user-friendly categories.
 */
export type NetlifyDeploySimplifiedState = 'pending' | 'building' | 'ready' | 'error' | 'cancelled';

/**
 * Maps raw Netlify API deploy states to simplified states for UI display.
 * This ensures consistent state representation regardless of Netlify API changes.
 * 
 * @param apiState - The raw state from Netlify's API
 * @returns A simplified state suitable for UI display
 */
export function mapNetlifyDeployState(apiState: string): NetlifyDeploySimplifiedState {
  // Terminal success state
  if (apiState === 'ready') return 'ready';
  
  // Terminal failure states
  if (apiState === 'error') return 'error';
  if (apiState === 'cancelled') return 'cancelled';
  
  // Building phase (active processing)
  if (['building', 'processing', 'processed'].includes(apiState)) return 'building';
  
  // Pending phase (waiting or uploading)
  if (['new', 'pending', 'uploading', 'uploaded', 'preparing', 'prepared'].includes(apiState)) return 'pending';
  
  // Unknown state - treat as pending but log warning
  logger.warn(`Unknown Netlify deploy state encountered: "${apiState}" - mapping to 'pending'`);
  return 'pending';
}

export interface NetlifyDeployResult {
  success: boolean;
  siteId?: string;
  siteUrl?: string;
  adminUrl?: string;
  deployId?: string;
  /** Simplified deploy state for UI consumption */
  deployState?: NetlifyDeploySimplifiedState;
  /** Raw API state for debugging (may include states not in simplified list) */
  rawDeployState?: string;
  error?: string;
  errorCode?: 'OAUTH_NOT_CONFIGURED' | 'BUILD_FAILED' | 'SITE_EXISTS' | 'API_ERROR' | 'TIMEOUT' | 'MISSING_CONFIG';
}

export interface NetlifyProgress {
  stage: 'validating' | 'building_local' | 'creating_site' | 'configuring' | 'deploying' | 'polling' | 'completed' | 'failed';
  message: string;
  progress?: number;
}

type ProgressCallback = (progress: NetlifyProgress) => void;

interface NetlifySite {
  id: string;
  name: string;
  url: string;
  admin_url: string;
  ssl_url: string;
  deploy_url: string;
  build_settings?: {
    repo_url?: string;
    repo_branch?: string;
    cmd?: string;
    dir?: string;
  };
}

interface NetlifyDeploy {
  id: string;
  site_id: string;
  /** Raw state from Netlify API - use mapNetlifyDeployState() for UI display */
  state: NetlifyDeployApiState | string; // Allow string for unknown future states
  error_message?: string;
  deploy_url?: string;
  ssl_url?: string;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const NETLIFY_API_BASE = 'https://api.netlify.com/api/v1';
const DEPLOY_POLL_INTERVAL_MS = 5000; // 5 seconds
const DEPLOY_MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Creates axios instance with Netlify authentication headers
 */
const API_TIMEOUT_MS = 30000; // 30 seconds timeout for individual API calls

function getNetlifyClient() {
  // Use type guard for proper type narrowing
  if (!hasValidNetlifyConfig(config.netlify)) {
    throw new Error('Netlify API token not configured. Set NETLIFY_API_TOKEN environment variable.');
  }
  
  // After type guard, config.netlify is typed as ValidatedNetlifyConfig
  // No need for ! assertion - TypeScript knows apiToken exists
  return axios.create({
    baseURL: NETLIFY_API_BASE,
    timeout: API_TIMEOUT_MS,
    headers: {
      'Authorization': `Bearer ${config.netlify.apiToken}`,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Project type classification for build handling
 */
export type ProjectBuildType = 
  | 'needs-build'     // Has package.json with build script
  | 'static'          // No package.json, pure static files
  | 'pre-built'       // Has package.json but no build script (might be pre-built or static-only)
  | 'unknown';        // Could not determine

/**
 * Build detection result with comprehensive project analysis
 */
export interface BuildDetectionResult {
  /** The build command to use, or null if no build is needed */
  command: string | null;
  /** Whether package.json exists */
  hasPackageJson: boolean;
  /** Classified project type */
  projectType: ProjectBuildType;
  /** Warning message if any issue was detected */
  warning?: string;
  /** Recommended publish directory based on project analysis */
  recommendedPublishDir?: string;
  /** Whether this is a known framework with auto-detection */
  detectedFramework?: string;
}

/**
 * Detects build command from package.json and analyzes project structure.
 * Returns comprehensive build information for proper Netlify configuration.
 * 
 * This function:
 * 1. Checks for package.json and build scripts
 * 2. Detects common frameworks (Eleventy, Next.js, Vite, etc.)
 * 3. Analyzes project structure to determine if it's static or needs building
 * 4. Provides warnings for ambiguous cases
 */
async function detectBuildCommand(demoDir: string): Promise<BuildDetectionResult> {
  const packageJsonPath = path.join(demoDir, 'package.json');
  
  // Check for common static site indicators (no package.json needed)
  const staticIndicators = ['index.html', 'index.htm'];
  let hasStaticIndex = false;
  for (const file of staticIndicators) {
    if (await fs.pathExists(path.join(demoDir, file))) {
      hasStaticIndex = true;
      break;
    }
  }
  
  // No package.json - likely a static site
  if (!await fs.pathExists(packageJsonPath)) {
    if (hasStaticIndex) {
      return { 
        command: null, 
        hasPackageJson: false,
        projectType: 'static',
        recommendedPublishDir: '.',
        warning: 'No package.json found. Deploying as static site from root directory.'
      };
    }
    return { 
      command: null, 
      hasPackageJson: false,
      projectType: 'unknown',
      warning: 'No package.json and no index.html found. Netlify deployment may fail. Ensure the project has static files or a build process.'
    };
  }
  
  // Parse package.json
  let pkg: any;
  try {
    pkg = await fs.readJson(packageJsonPath);
  } catch (e) {
    logger.warn(`Could not read package.json for build command detection: ${e}`);
    return { 
      command: null, 
      hasPackageJson: true,
      projectType: 'unknown',
      warning: 'Could not parse package.json. Check for syntax errors.'
    };
  }
  
  // Detect framework based on dependencies
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  let detectedFramework: string | undefined;
  let recommendedPublishDir = 'public';
  
  if (deps['@11ty/eleventy']) {
    detectedFramework = 'Eleventy';
    recommendedPublishDir = pkg.config?.['11ty']?.dir?.output || '_site';
  } else if (deps['next']) {
    detectedFramework = 'Next.js';
    recommendedPublishDir = '.next';
  } else if (deps['vite'] || deps['@vitejs/plugin-react']) {
    detectedFramework = 'Vite';
    recommendedPublishDir = 'dist';
  } else if (deps['react-scripts']) {
    detectedFramework = 'Create React App';
    recommendedPublishDir = 'build';
  } else if (deps['gatsby']) {
    detectedFramework = 'Gatsby';
    recommendedPublishDir = 'public';
  } else if (deps['astro']) {
    detectedFramework = 'Astro';
    recommendedPublishDir = 'dist';
  } else if (deps['nuxt'] || deps['nuxt3']) {
    detectedFramework = 'Nuxt';
    recommendedPublishDir = '.output/public';
  }
  
  // Check for build script
  if (pkg.scripts?.build) {
    return { 
      command: pkg.scripts.build, 
      hasPackageJson: true,
      projectType: 'needs-build',
      detectedFramework,
      recommendedPublishDir
    };
  }
  
  // No build script - check if this is intentionally a static/pre-built project
  // Look for common indicators that the project is already built or doesn't need building
  const preBuiltIndicators = ['public/index.html', 'dist/index.html', 'build/index.html', '_site/index.html'];
  let hasPreBuiltOutput: string | null = null;
  for (const file of preBuiltIndicators) {
    if (await fs.pathExists(path.join(demoDir, file))) {
      hasPreBuiltOutput = file.split('/')[0];
      break;
    }
  }
  
  if (hasPreBuiltOutput) {
    return { 
      command: null, 
      hasPackageJson: true,
      projectType: 'pre-built',
      recommendedPublishDir: hasPreBuiltOutput,
      warning: `No build script found but ${hasPreBuiltOutput}/ directory exists. Will deploy from ${hasPreBuiltOutput}/.`
    };
  }
  
  // Package.json exists but no build script and no pre-built output
  const warningMsg = detectedFramework 
    ? `Detected ${detectedFramework} project but no "build" script found in package.json. This may cause deployment to fail.`
    : 'package.json exists but has no "build" script. If your project needs building, add a build script to package.json.';
  
  return { 
    command: null, 
    hasPackageJson: true,
    projectType: 'pre-built',
    warning: warningMsg,
    detectedFramework
  };
}

/**
 * Generates a unique site name with timestamp suffix to avoid collisions
 */
function generateUniqueSiteName(baseName: string): string {
  // Clean the name: lowercase, alphanumeric and hyphens only
  const cleaned = baseName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  
  // Add a short timestamp suffix for uniqueness
  const suffix = Date.now().toString(36).slice(-4);
  
  // Netlify site names max 63 chars
  const maxBaseLength = 63 - suffix.length - 1;
  const truncatedBase = cleaned.slice(0, maxBaseLength);
  
  return `${truncatedBase}-${suffix}`;
}

/**
 * Parses Netlify API error responses into user-friendly messages
 */
function parseNetlifyError(error: AxiosError<any>): { message: string; code: NetlifyDeployResult['errorCode'] } {
  const status = error.response?.status;
  const data = error.response?.data;
  
  if (status === 401 || status === 403) {
    return {
      message: 'Netlify API token is invalid or lacks required permissions.',
      code: 'API_ERROR'
    };
  }
  
  if (status === 422 && data?.errors) {
    const errors = Array.isArray(data.errors) ? data.errors : [data.errors];
    const errorMessages = errors.map((e: any) => e.message || e).join('; ');
    
    if (errorMessages.includes('name is already taken') || errorMessages.includes('already exists')) {
      return {
        message: `Site name already taken. The system will retry with a unique name.`,
        code: 'SITE_EXISTS'
      };
    }
    
    return {
      message: `Netlify validation error: ${errorMessages}`,
      code: 'API_ERROR'
    };
  }
  
  // Check for GitHub OAuth issues
  if (data?.message?.includes('GitHub') || data?.message?.includes('oauth') || data?.message?.includes('permission')) {
    return {
      message: `Netlify cannot access the GitHub repository. This is usually because the Netlify GitHub App is not installed. Setup: https://github.com/apps/netlify/installations/new - Grant access to organization: ${config.git.githubOrg}`,
      code: 'OAUTH_NOT_CONFIGURED'
    };
  }
  
  return {
    message: data?.message || error.message || 'Unknown Netlify API error',
    code: 'API_ERROR'
  };
}

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

/**
 * Type representing a validated Netlify configuration with required fields.
 * Used after type narrowing via hasValidNetlifyConfig().
 */
export interface ValidatedNetlifyConfig {
  apiToken: string;
  accountSlug: string;
  buildCommand?: string;
  publishDir?: string;
  oauthConfigured?: boolean;
}

/**
 * Type guard to check if Netlify config exists and has required fields.
 * This provides compile-time type narrowing for TypeScript.
 * 
 * Usage:
 *   if (hasValidNetlifyConfig(config.netlify)) {
 *     // config.netlify is now typed as ValidatedNetlifyConfig
 *     const token = config.netlify.apiToken; // no ! needed
 *   }
 */
export function hasValidNetlifyConfig(netlify: typeof config.netlify): netlify is ValidatedNetlifyConfig {
  return !!(netlify && typeof netlify.apiToken === 'string' && netlify.apiToken.length > 0 
    && typeof netlify.accountSlug === 'string' && netlify.accountSlug.length > 0);
}

/**
 * Validates that Netlify configuration is complete and ready for deployment.
 * Call this before attempting any Netlify operations.
 * 
 * Returns detailed error information for each missing field.
 * When valid is true, the config is guaranteed to satisfy ValidatedNetlifyConfig.
 */
export function validateNetlifyConfig(): { 
  valid: boolean; 
  errors: string[]; 
  warnings: string[];
  config?: ValidatedNetlifyConfig;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Use type guard for comprehensive validation
  if (!hasValidNetlifyConfig(config.netlify)) {
    // Provide specific error messages for each missing field
    if (!config.netlify) {
      errors.push('Netlify configuration is not defined. Add a "netlify" section to config.json.');
    } else {
      if (!config.netlify.apiToken || typeof config.netlify.apiToken !== 'string' || config.netlify.apiToken.length === 0) {
        errors.push('NETLIFY_API_TOKEN environment variable is not set or is empty');
      }
      if (!config.netlify.accountSlug || typeof config.netlify.accountSlug !== 'string' || config.netlify.accountSlug.length === 0) {
        errors.push('NETLIFY_ACCOUNT_SLUG is not configured. Set it in Settings or config.json');
      }
    }
    return { valid: false, errors, warnings };
  }
  
  // At this point, config.netlify is guaranteed to be ValidatedNetlifyConfig
  const validatedConfig = config.netlify;
  
  // OAuth warning - logged but doesn't prevent deployment
  // User is responsible for ensuring GitHub App is installed
  if (!validatedConfig.oauthConfigured) {
    const warning = 'Netlify GitHub OAuth may not be configured. Deployments may fail if the GitHub App is not installed.';
    warnings.push(warning);
    logger.warn(warning);
  }
  
  return {
    valid: true,
    errors,
    warnings,
    config: validatedConfig
  };
}

/**
 * Tests Netlify API connection and returns account info.
 * Useful for Settings UI "Test Connection" button.
 */
export async function testNetlifyConnection(): Promise<{ success: boolean; accountName?: string; error?: string }> {
  try {
    const client = getNetlifyClient();
    const response = await client.get('/user');
    
    return {
      success: true,
      accountName: response.data.full_name || response.data.email || 'Connected'
    };
  } catch (error: any) {
    const parsed = error.response ? parseNetlifyError(error) : { message: error.message, code: 'API_ERROR' as const };
    return {
      success: false,
      error: parsed.message
    };
  }
}

/**
 * Deploys a demo site to Netlify.
 * 
 * Prerequisites:
 * - Demo must be successfully published to GitHub (need repo URL)
 * - Local build must succeed (verified before creating Netlify site)
 * - Netlify GitHub OAuth must be configured (user responsibility)
 * 
 * @param clientSlug - The demo folder name
 * @param githubRepoUrl - Full GitHub repo URL (e.g., "https://github.com/org/repo")
 * @param progressCallback - Optional callback for progress updates
 */
export async function deployToNetlify(
  clientSlug: string,
  githubRepoUrl: string,
  progressCallback?: ProgressCallback
): Promise<NetlifyDeployResult> {
  const demoDir = path.join(process.cwd(), 'client-websites', clientSlug);
  
  const updateProgress = (progress: NetlifyProgress) => {
    logger.info(`Netlify deploy [${clientSlug}]: ${progress.stage} - ${progress.message}`);
    if (progressCallback) {
      progressCallback(progress);
    }
  };

  // =========================================================================
  // STAGE 1: Validation
  // =========================================================================
  updateProgress({ stage: 'validating', message: 'Validating Netlify configuration...', progress: 5 });
  
  const validation = validateNetlifyConfig();
  if (!validation.valid || !validation.config) {
    const error = validation.errors.join('; ');
    updateProgress({ stage: 'failed', message: error });
    return { success: false, error, errorCode: 'MISSING_CONFIG' };
  }
  
  // Log warnings but continue
  if (validation.warnings.length > 0) {
    validation.warnings.forEach(w => logger.warn(`Netlify deploy warning: ${w}`));
  }
  
  // Use the validated config - no need for ! assertion since validateNetlifyConfig() guarantees it
  const netlifyConfig = validation.config;
  
  if (!await fs.pathExists(demoDir)) {
    const error = `Demo directory not found: ${demoDir}`;
    updateProgress({ stage: 'failed', message: error });
    return { success: false, error, errorCode: 'API_ERROR' };
  }

  // =========================================================================
  // STAGE 2: Local Build Verification
  // =========================================================================
  updateProgress({ stage: 'building_local', message: 'Verifying local build works before creating Netlify site...', progress: 10 });
  
  try {
    const buildResult = await buildDemo(clientSlug, true); // Force rebuild
    
    if (!buildResult.success) {
      const error = `Local build failed: ${buildResult.error || buildResult.message}. Fix build issues before deploying to Netlify.`;
      updateProgress({ stage: 'failed', message: error });
      return { success: false, error, errorCode: 'BUILD_FAILED' };
    }
    
    logger.info(`Local build verified for ${clientSlug}`);
    updateProgress({ stage: 'building_local', message: 'Local build successful', progress: 25 });
  } catch (error: any) {
    const errorMsg = `Build verification failed: ${error.message}`;
    updateProgress({ stage: 'failed', message: errorMsg });
    return { success: false, error: errorMsg, errorCode: 'BUILD_FAILED' };
  }

  // =========================================================================
  // STAGE 3: Create Netlify Site
  // =========================================================================
  updateProgress({ stage: 'creating_site', message: 'Creating Netlify site...', progress: 35 });
  
  const client = getNetlifyClient();
  
  // Safe access - we already validated these fields exist via validateNetlifyConfig()
  const accountSlug = netlifyConfig.accountSlug;
  
  // Detect project build requirements
  const buildDetection = await detectBuildCommand(demoDir);
  
  // Log detection results for debugging
  logger.info(`Build detection for ${clientSlug}: type=${buildDetection.projectType}, framework=${buildDetection.detectedFramework || 'none'}, command=${buildDetection.command || 'none'}`);
  
  // Use configured build command if provided, otherwise use detected command
  let buildCommand: string | undefined = netlifyConfig.buildCommand || buildDetection.command || undefined;
  
  // Handle build detection warnings and errors
  if (buildDetection.warning) {
    logger.warn(`Build detection warning for ${clientSlug}: ${buildDetection.warning}`);
    updateProgress({ 
      stage: 'creating_site', 
      message: `Warning: ${buildDetection.warning}`, 
      progress: 38 
    });
  }
  
  // For 'unknown' project types without a build command, warn but don't fail
  // The local build verification step should have caught any critical issues
  if (buildDetection.projectType === 'unknown' && !buildCommand) {
    logger.warn(`Could not determine project type for ${clientSlug}. Netlify will use default settings.`);
  }
  
  // Use detected recommended publish directory or fall back to config/default
  // Priority: 1. Config override, 2. Detected recommendation, 3. Default 'public'
  const publishDir = netlifyConfig.publishDir || buildDetection.recommendedPublishDir || 'public';
  
  logger.info(`Using publish directory: ${publishDir}${buildDetection.recommendedPublishDir ? ` (detected for ${buildDetection.detectedFramework || 'project'})` : ''}`);
  
  // Special handling for static sites with no build step
  if (buildDetection.projectType === 'static' && !buildCommand) {
    logger.info(`Deploying ${clientSlug} as static site (no build step)`);
  }
  
  // Parse GitHub repo info
  const repoMatch = githubRepoUrl.match(/github\.com[/:]([\w-]+)\/([\w-]+)/i);
  if (!repoMatch) {
    const error = `Invalid GitHub URL format: ${githubRepoUrl}`;
    updateProgress({ stage: 'failed', message: error });
    return { success: false, error, errorCode: 'API_ERROR' };
  }
  const [, repoOwner, repoName] = repoMatch;
  const repoFullName = `${repoOwner}/${repoName}`;
  const defaultBranch = config.git.defaultBranch || 'main';
  
  // Initialize site as undefined - TypeScript will track that we check for undefined before use
  let site: NetlifySite | undefined = undefined;
  let siteName = generateUniqueSiteName(clientSlug);
  let retryCount = 0;
  const maxRetries = 3;
  let lastError: { message: string; code: NetlifyDeployResult['errorCode'] } | undefined;
  
  while (retryCount < maxRetries) {
    try {
      const response = await client.post('/sites', {
        name: siteName,
        account_slug: accountSlug,
        repo: {
          provider: 'github',
          repo: repoFullName,
          branch: defaultBranch,
          cmd: buildCommand,
          dir: publishDir,
        },
      });
      
      // Validate API response shape
      const siteData = response.data;
      if (!siteData || typeof siteData.id !== 'string' || typeof siteData.name !== 'string') {
        throw new Error('Invalid response from Netlify API: missing required site fields (id, name)');
      }
      
      site = siteData as NetlifySite;
      logger.info(`Created Netlify site: ${site.name} (${site.id})`);
      break;
    } catch (error: any) {
      const parsed = parseNetlifyError(error);
      lastError = parsed;
      
      if (parsed.code === 'SITE_EXISTS' && retryCount < maxRetries - 1) {
        // Retry with a new unique name
        retryCount++;
        siteName = generateUniqueSiteName(clientSlug);
        logger.warn(`Site name collision, retrying with: ${siteName}`);
        continue;
      }
      
      if (parsed.code === 'OAUTH_NOT_CONFIGURED') {
        updateProgress({ stage: 'failed', message: parsed.message });
        return { success: false, error: parsed.message, errorCode: 'OAUTH_NOT_CONFIGURED' };
      }
      
      // For non-retryable errors, exit immediately with the error
      updateProgress({ stage: 'failed', message: parsed.message });
      return { success: false, error: parsed.message, errorCode: parsed.code };
    }
    
    // Increment retry count to prevent infinite loop on unexpected paths
    retryCount++;
  }
  
  // Explicit check for undefined site - this satisfies TypeScript's strict mode
  if (site === undefined) {
    const errorMessage = lastError?.message || `Failed to create Netlify site after ${maxRetries} attempts`;
    const errorCode = lastError?.code || 'API_ERROR';
    updateProgress({ stage: 'failed', message: errorMessage });
    return { success: false, error: errorMessage, errorCode };
  }
  
  updateProgress({ stage: 'creating_site', message: `Site created: ${site.name}`, progress: 50 });

  // =========================================================================
  // STAGE 4: Configure Site (build settings already set during creation)
  // =========================================================================
  updateProgress({ stage: 'configuring', message: 'Configuring deployment settings...', progress: 55 });
  
  // The site is already configured with repo settings during creation
  // This stage is a placeholder for any additional configuration if needed
  logger.info(`Site ${site.name} configured with repo: ${repoFullName}, branch: ${defaultBranch}`);

  // =========================================================================
  // STAGE 5: Trigger Initial Deploy
  // =========================================================================
  updateProgress({ stage: 'deploying', message: 'Triggering initial deployment...', progress: 60 });
  
  let deploy: NetlifyDeploy;
  try {
    // Trigger a new deploy by creating a build hook deployment
    const deployResponse = await client.post(`/sites/${site.id}/deploys`, {
      clear_cache: true,
    });
    deploy = deployResponse.data;
    logger.info(`Triggered deploy: ${deploy.id} (state: ${deploy.state})`);
  } catch (error: any) {
    // Deploy might already be triggered automatically when site is linked
    // Try to get the latest deploy instead
    try {
      const deploysResponse = await client.get(`/sites/${site.id}/deploys?per_page=1`);
      if (deploysResponse.data && deploysResponse.data.length > 0) {
        deploy = deploysResponse.data[0];
        logger.info(`Using existing deploy: ${deploy.id} (state: ${deploy.state})`);
      } else {
        throw new Error('No deploys found');
      }
    } catch (e: any) {
      const errorMsg = `Failed to trigger or find deployment: ${error.message}`;
      updateProgress({ stage: 'failed', message: errorMsg });
      // Return partial success - site was created but deploy failed
      return {
        success: false,
        siteId: site.id,
        siteUrl: site.ssl_url || site.url,
        adminUrl: site.admin_url,
        error: errorMsg,
        errorCode: 'API_ERROR'
      };
    }
  }

  // =========================================================================
  // STAGE 6: Poll for Deployment Status
  // =========================================================================
  updateProgress({ stage: 'polling', message: `Waiting for deployment to complete...`, progress: 70 });
  
  const startTime = Date.now();
  let lastState = deploy.state;
  let lastStateChangeTime = Date.now();
  
  // Unknown state tracking for fail-fast behavior
  let unknownStateCount = 0;
  const MAX_UNKNOWN_STATE_COUNT = 5; // Fail after 5 consecutive unknown states
  const STATE_STAGNATION_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes without state change in non-terminal state
  
  // Known intermediate states that we expect to see
  const knownIntermediateStates = ['new', 'pending', 'uploading', 'uploaded', 'preparing', 'prepared', 'building', 'processing', 'processed'];
  const terminalSuccessStates = ['ready'];
  const terminalFailureStates = ['error', 'cancelled'];
  
  while (Date.now() - startTime < DEPLOY_MAX_WAIT_MS) {
    try {
      const statusResponse = await client.get(`/deploys/${deploy.id}`);
      deploy = statusResponse.data;
      
      // Track state changes and reset unknown state counter on valid state
      if (deploy.state !== lastState) {
        logger.info(`Deploy ${deploy.id} state changed: ${lastState} → ${deploy.state}`);
        lastState = deploy.state;
        lastStateChangeTime = Date.now();
        
        // Reset unknown state counter if we transitioned to a known state
        if ([...knownIntermediateStates, ...terminalSuccessStates, ...terminalFailureStates].includes(deploy.state)) {
          unknownStateCount = 0;
        }
        
        // Update progress based on state
        const progressMap: Record<string, number> = {
          'new': 72,
          'pending': 75,
          'uploading': 78,
          'uploaded': 80,
          'preparing': 82,
          'prepared': 85,
          'building': 88,
          'processing': 90,
          'processed': 95,
        };
        const progress = progressMap[deploy.state] || 75;
        updateProgress({ stage: 'polling', message: `Deployment status: ${deploy.state}`, progress });
      }
      
      // Check for terminal success
      if (terminalSuccessStates.includes(deploy.state)) {
        const siteUrl = deploy.ssl_url || site.ssl_url || site.url;
        updateProgress({ stage: 'completed', message: `Deployment successful! Site live at ${siteUrl}`, progress: 100 });
        
        return {
          success: true,
          siteId: site.id,
          siteUrl,
          adminUrl: site.admin_url,
          deployId: deploy.id,
          deployState: mapNetlifyDeployState(deploy.state),
          rawDeployState: deploy.state
        };
      }
      
      // Check for terminal failure
      if (terminalFailureStates.includes(deploy.state)) {
        const errorMsg = deploy.error_message || `Deployment ${deploy.state}`;
        updateProgress({ stage: 'failed', message: errorMsg });
        
        return {
          success: false,
          siteId: site.id,
          siteUrl: site.ssl_url || site.url,
          adminUrl: site.admin_url,
          deployId: deploy.id,
          deployState: mapNetlifyDeployState(deploy.state),
          rawDeployState: deploy.state,
          error: errorMsg,
          errorCode: 'API_ERROR'
        };
      }
      
      // Check for unknown states with fail-fast threshold
      if (!knownIntermediateStates.includes(deploy.state)) {
        unknownStateCount++;
        logger.warn(`Unknown Netlify deploy state: "${deploy.state}" (occurrence ${unknownStateCount}/${MAX_UNKNOWN_STATE_COUNT})`);
        
        // Fail fast if we've seen too many unknown states
        if (unknownStateCount >= MAX_UNKNOWN_STATE_COUNT) {
          const errorMsg = `Deployment in unexpected state "${deploy.state}" for ${unknownStateCount} consecutive polls. This may indicate a new Netlify state not yet supported, or an API issue. Check Netlify dashboard for details.`;
          logger.error(errorMsg);
          updateProgress({ stage: 'failed', message: errorMsg });
          
          return {
            success: false,
            siteId: site.id,
            siteUrl: site.ssl_url || site.url,
            adminUrl: site.admin_url,
            deployId: deploy.id,
            deployState: mapNetlifyDeployState(deploy.state),
            rawDeployState: deploy.state,
            error: errorMsg,
            errorCode: 'API_ERROR'
          };
        }
      }
      
      // Check for state stagnation (stuck in same state for too long)
      const timeSinceStateChange = Date.now() - lastStateChangeTime;
      if (timeSinceStateChange > STATE_STAGNATION_THRESHOLD_MS) {
        // Only warn if we're in a state that shouldn't take this long
        const longRunningStates = ['building', 'processing']; // These can legitimately take a while
        if (!longRunningStates.includes(deploy.state)) {
          logger.warn(`Deploy ${deploy.id} stuck in state "${deploy.state}" for ${Math.round(timeSinceStateChange / 1000)}s`);
        }
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, DEPLOY_POLL_INTERVAL_MS));
    } catch (error: any) {
      logger.warn(`Error polling deploy status: ${error.message}`);
      // Continue polling despite temporary errors, but count them
      await new Promise(resolve => setTimeout(resolve, DEPLOY_POLL_INTERVAL_MS));
    }
  }
  
  // Timeout reached
  const timeoutError = `Deployment timed out after ${DEPLOY_MAX_WAIT_MS / 1000 / 60} minutes. Check Netlify dashboard for status.`;
  updateProgress({ stage: 'failed', message: timeoutError });
  
  return {
    success: false,
    siteId: site.id,
    siteUrl: site.ssl_url || site.url,
    adminUrl: site.admin_url,
    deployId: deploy.id,
    deployState: mapNetlifyDeployState(deploy.state),
    rawDeployState: deploy.state,
    error: timeoutError,
    errorCode: 'TIMEOUT'
  };
}

/**
 * Retries a failed Netlify deployment for an existing site.
 * Used when GitHub publish succeeded but Netlify deploy failed.
 * 
 * This function reuses an existing Netlify site rather than creating a new one,
 * preventing orphaned sites from accumulating.
 */
export async function retryNetlifyDeploy(
  clientSlug: string,
  siteId: string,
  progressCallback?: ProgressCallback
): Promise<NetlifyDeployResult> {
  const updateProgress = (progress: NetlifyProgress) => {
    logger.info(`Netlify retry [${clientSlug}]: ${progress.stage} - ${progress.message}`);
    if (progressCallback) {
      progressCallback(progress);
    }
  };
  
  updateProgress({ stage: 'validating', message: 'Validating configuration...', progress: 5 });
  
  const validation = validateNetlifyConfig();
  if (!validation.valid || !validation.config) {
    const error = validation.errors.join('; ');
    updateProgress({ stage: 'failed', message: error });
    return { success: false, error, errorCode: 'MISSING_CONFIG' };
  }
  
  // Log warnings but continue
  if (validation.warnings.length > 0) {
    validation.warnings.forEach(w => logger.warn(`Netlify retry warning: ${w}`));
  }
  
  // Use validated config - type is guaranteed by validateNetlifyConfig()
  const client = getNetlifyClient();
  
  // Get site info to verify it exists and is accessible
  let site: NetlifySite;
  try {
    const siteResponse = await client.get(`/sites/${siteId}`);
    site = siteResponse.data;
    logger.info(`Found existing site for retry: ${site.name} (${site.id})`);
    updateProgress({ stage: 'validating', message: `Reusing existing site: ${site.name}`, progress: 15 });
  } catch (error: any) {
    const parsed = parseNetlifyError(error);
    // If site doesn't exist (404), suggest using full deployment instead
    if (error.response?.status === 404) {
      updateProgress({ stage: 'failed', message: `Site ${siteId} not found. The site may have been deleted. Use full deployment instead.` });
      return { success: false, error: `Site not found. Use full deployment to create a new site.`, errorCode: 'API_ERROR' };
    }
    updateProgress({ stage: 'failed', message: `Failed to access site: ${parsed.message}` });
    return { success: false, error: parsed.message, errorCode: 'API_ERROR' };
  }
  
  // Trigger new deploy
  updateProgress({ stage: 'deploying', message: 'Triggering new deployment...', progress: 30 });
  
  let deploy: NetlifyDeploy;
  try {
    const deployResponse = await client.post(`/sites/${site.id}/deploys`, {
      clear_cache: true,
    });
    deploy = deployResponse.data;
    logger.info(`Triggered retry deploy: ${deploy.id}`);
  } catch (error: any) {
    const parsed = parseNetlifyError(error);
    updateProgress({ stage: 'failed', message: parsed.message });
    return {
      success: false,
      siteId: site.id,
      siteUrl: site.ssl_url || site.url,
      adminUrl: site.admin_url,
      error: parsed.message,
      errorCode: parsed.code
    };
  }
  
  // Poll for completion with comprehensive state handling
  updateProgress({ stage: 'polling', message: 'Waiting for deployment...', progress: 50 });
  
  const startTime = Date.now();
  let lastState = deploy.state;
  let lastStateChangeTime = Date.now();
  
  // Unknown state tracking for fail-fast behavior (same as deployToNetlify)
  let unknownStateCount = 0;
  const MAX_UNKNOWN_STATE_COUNT = 5;
  const STATE_STAGNATION_THRESHOLD_MS = 3 * 60 * 1000;
  
  // Define terminal states (same as deployToNetlify for consistency)
  const terminalSuccessStates = ['ready'];
  const terminalFailureStates = ['error', 'cancelled'];
  const knownIntermediateStates = ['new', 'pending', 'uploading', 'uploaded', 'preparing', 'prepared', 'building', 'processing', 'processed'];
  
  while (Date.now() - startTime < DEPLOY_MAX_WAIT_MS) {
    try {
      const statusResponse = await client.get(`/deploys/${deploy.id}`);
      deploy = statusResponse.data;
      
      if (deploy.state !== lastState) {
        logger.info(`Retry deploy ${deploy.id} state changed: ${lastState} → ${deploy.state}`);
        lastState = deploy.state;
        lastStateChangeTime = Date.now();
        
        // Reset unknown state counter if we transitioned to a known state
        if ([...knownIntermediateStates, ...terminalSuccessStates, ...terminalFailureStates].includes(deploy.state)) {
          unknownStateCount = 0;
        }
        
        // Update progress based on state
        const progressMap: Record<string, number> = {
          'new': 52, 'pending': 55, 'uploading': 58, 'uploaded': 62,
          'preparing': 65, 'prepared': 70, 'building': 75, 'processing': 85, 'processed': 95
        };
        const progress = progressMap[deploy.state] || 60;
        updateProgress({ stage: 'polling', message: `Deployment status: ${deploy.state}`, progress });
      }
      
      // Check for terminal success
      if (terminalSuccessStates.includes(deploy.state)) {
        const siteUrl = deploy.ssl_url || site.ssl_url || site.url;
        updateProgress({ stage: 'completed', message: `Deployment successful!`, progress: 100 });
        
        return {
          success: true,
          siteId: site.id,
          siteUrl,
          adminUrl: site.admin_url,
          deployId: deploy.id,
          deployState: mapNetlifyDeployState(deploy.state),
          rawDeployState: deploy.state
        };
      }
      
      // Check for terminal failure
      if (terminalFailureStates.includes(deploy.state)) {
        const errorMsg = deploy.error_message || `Deployment ${deploy.state}`;
        updateProgress({ stage: 'failed', message: errorMsg });
        
        return {
          success: false,
          siteId: site.id,
          siteUrl: site.ssl_url || site.url, // Return URL even on failure for debugging
          adminUrl: site.admin_url,
          deployId: deploy.id,
          deployState: mapNetlifyDeployState(deploy.state),
          rawDeployState: deploy.state,
          error: errorMsg,
          errorCode: 'API_ERROR'
        };
      }
      
      // Check for unknown states with fail-fast threshold
      if (!knownIntermediateStates.includes(deploy.state)) {
        unknownStateCount++;
        logger.warn(`Unknown Netlify deploy state during retry: "${deploy.state}" (occurrence ${unknownStateCount}/${MAX_UNKNOWN_STATE_COUNT})`);
        
        if (unknownStateCount >= MAX_UNKNOWN_STATE_COUNT) {
          const errorMsg = `Deployment in unexpected state "${deploy.state}" for ${unknownStateCount} consecutive polls. Check Netlify dashboard for details.`;
          logger.error(errorMsg);
          updateProgress({ stage: 'failed', message: errorMsg });
          
          return {
            success: false,
            siteId: site.id,
            siteUrl: site.ssl_url || site.url,
            adminUrl: site.admin_url,
            deployId: deploy.id,
            deployState: mapNetlifyDeployState(deploy.state),
            rawDeployState: deploy.state,
            error: errorMsg,
            errorCode: 'API_ERROR'
          };
        }
      }
      
      // Check for state stagnation
      const timeSinceStateChange = Date.now() - lastStateChangeTime;
      if (timeSinceStateChange > STATE_STAGNATION_THRESHOLD_MS) {
        const longRunningStates = ['building', 'processing'];
        if (!longRunningStates.includes(deploy.state)) {
          logger.warn(`Retry deploy ${deploy.id} stuck in state "${deploy.state}" for ${Math.round(timeSinceStateChange / 1000)}s`);
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, DEPLOY_POLL_INTERVAL_MS));
    } catch (error: any) {
      logger.warn(`Error polling retry deploy status: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, DEPLOY_POLL_INTERVAL_MS));
    }
  }
  
  // Timeout reached
  const timeoutError = `Deployment timed out after ${DEPLOY_MAX_WAIT_MS / 1000 / 60} minutes. Check Netlify dashboard for status.`;
  updateProgress({ stage: 'failed', message: timeoutError });
  
  return {
    success: false,
    siteId: site.id,
    siteUrl: site.ssl_url || site.url,
    adminUrl: site.admin_url,
    deployId: deploy.id,
    deployState: mapNetlifyDeployState(deploy.state),
    rawDeployState: deploy.state,
    error: timeoutError,
    errorCode: 'TIMEOUT'
  };
}

/**
 * Checks if a Netlify site exists and is accessible.
 * Useful for validating siteId before retry operations.
 */
export async function checkNetlifySiteExists(siteId: string): Promise<{ exists: boolean; site?: NetlifySite; error?: string }> {
  try {
    const client = getNetlifyClient();
    const response = await client.get(`/sites/${siteId}`);
    return { exists: true, site: response.data };
  } catch (error: any) {
    if (error.response?.status === 404) {
      return { exists: false, error: 'Site not found' };
    }
    const parsed = parseNetlifyError(error);
    return { exists: false, error: parsed.message };
  }
}

/**
 * Deletes a Netlify site (for cleanup after failed deployments or testing).
 */
export async function deleteNetlifySite(siteId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getNetlifyClient();
    await client.delete(`/sites/${siteId}`);
    logger.info(`Deleted Netlify site: ${siteId}`);
    return { success: true };
  } catch (error: any) {
    const parsed = parseNetlifyError(error);
    logger.error(`Failed to delete Netlify site ${siteId}: ${parsed.message}`);
    return { success: false, error: parsed.message };
  }
}
