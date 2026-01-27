/**
 * Screenshot Service
 * 
 * Captures comprehensive multi-page, multi-section screenshots for websites.
 * Converts the standalone screenshot.js to a reusable TypeScript service.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { logger } from './logger';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface SectionScreenshot {
  name: string;
  path: string;
  tag: string;
  id?: string;
  role?: string;
  className?: string;
}

export interface PageScreenshots {
  url: string;
  pageSlug: string;
  fullPage: string;
  sections: SectionScreenshot[];
  error?: string;
}

export interface ScreenshotManifest {
  taskId: string;
  prefix: string;
  iteration: number;
  timestamp: string;
  baseUrl: string;
  totalPages: number;
  totalSections: number;
  pages: Array<{
    url: string;
    pageSlug: string;
    fullPage: string;
    sectionCount: number;
    sections: SectionScreenshot[];
    error?: string;
  }>;
}

export interface ScreenshotResult {
  pages: PageScreenshots[];
  manifest: ScreenshotManifest;
  manifestPath: string;
  timestamp: string;
  /** True if at least one page was successfully captured */
  success: boolean;
  /** Number of pages that failed to capture */
  failedPages: number;
  /** Error message if all pages failed */
  error?: string;
}

export interface ScreenshotOptions {
  maxPages?: number;
  concurrency?: number;
  useSitemap?: 'auto' | 'true' | 'false';
  timeout?: number;
  viewport?: { width: number; height: number };
  captureSections?: boolean;
  cleanupOldIterations?: boolean;
  maxIterationsToKeep?: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Wait timeout for images to load (ms) */
const IMAGE_LOAD_TIMEOUT = 5000;

/** Minimum wait after scroll to let lazy images start loading (ms) */
const POST_SCROLL_WAIT = 300;

const DEFAULT_OPTIONS: Required<ScreenshotOptions> = {
  maxPages: 20,
  concurrency: 2,
  useSitemap: 'auto',
  timeout: 60000,
  viewport: { width: 1920, height: 1080 },
  captureSections: true,
  cleanupOldIterations: true,
  maxIterationsToKeep: 3
};

// Selectors for identifying semantic sections
const SECTION_SELECTOR = [
  'main',
  'header',
  'footer',
  'nav',
  'section',
  'article',
  'aside',
  '[role="main"]',
  '[role="navigation"]',
  '[role="contentinfo"]',
  '[role="banner"]',
  '[role="region"]',
  '[data-section]',
  '[data-testid*="section" i]',
  '[class*="section" i]'
].join(',');

// ============================================================================
// Helper Functions
// ============================================================================

function normalizeUrl(u: string): string | null {
  try {
    const url = new URL(u);
    url.hash = '';
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isSameOrigin(base: string, candidate: string): boolean {
  try {
    return new URL(candidate).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

function looksLikeHtmlPage(u: string): boolean {
  try {
    const url = new URL(u);
    const p = url.pathname.toLowerCase();
    if (p.endsWith('.pdf')) return false;
    if (p.match(/\.(png|jpg|jpeg|gif|webp|svg|mp4|webm|mov|zip|rar|7z|css|js|json|xml)$/)) return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return true;
  } catch {
    return false;
  }
}

function slugifyPage(urlStr: string): string {
  const url = new URL(urlStr);
  const p = url.pathname === '/' ? 'home' : url.pathname.replace(/^\//, '').replace(/\//g, '__');
  const q = url.search ? '__q_' + url.search.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') : '';
  const raw = (p + q).toLowerCase();
  return raw.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'page';
}

function safePart(s: string): string {
  return String(s || '')
    .trim()
    .slice(0, 80)
    .replace(/[^\w\-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Waits for all visible images on the page (or within an element) to fully load.
 * Handles lazy-loaded images by checking their complete state.
 */
async function waitForImagesToLoad(page: Page, selector?: string): Promise<void> {
  try {
    await page.evaluate(async ({ timeout, selector }) => {
      const container = selector ? document.querySelector(selector) : document;
      if (!container) return;
      
      const images = Array.from(container.querySelectorAll('img'));
      
      await Promise.all(images.map(img => {
        // Skip if already complete or has no src
        if (img.complete && img.naturalHeight > 0) return Promise.resolve();
        if (!img.src && !img.dataset.src) return Promise.resolve();
        
        return new Promise<void>((resolve) => {
          // Set up timeout
          const timer = setTimeout(resolve, timeout);
          
          const cleanup = () => {
            clearTimeout(timer);
            resolve();
          };
          
          img.addEventListener('load', cleanup, { once: true });
          img.addEventListener('error', cleanup, { once: true });
          
          // If image already complete (race condition), resolve immediately
          if (img.complete) cleanup();
        });
      }));
    }, { timeout: IMAGE_LOAD_TIMEOUT, selector });
  } catch (err) {
    // Silently continue if waiting fails - better to capture partial than fail entirely
    logger.debug(`Image wait completed (some may not have loaded): ${err}`);
  }
}

// ============================================================================
// Sitemap and Crawling
// ============================================================================

async function getUrlsFromSitemap(baseUrl: string, maxPages: number): Promise<string[] | null> {
  const sitemapUrl = new URL('/sitemap.xml', baseUrl).toString();
  try {
    const res = await fetch(sitemapUrl, { redirect: 'follow' });
    if (!res.ok) return null;
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
      .map((m) => normalizeUrl(m[1]))
      .filter((u): u is string => u !== null);
    const urls = [...new Set(locs)]
      .filter((u) => isSameOrigin(baseUrl, u))
      .filter(looksLikeHtmlPage)
      .slice(0, maxPages);
    return urls.length ? urls : null;
  } catch {
    return null;
  }
}

async function crawlSite(browser: Browser, baseUrl: string, maxPages: number): Promise<string[]> {
  const origin = new URL(baseUrl).origin;
  const start = normalizeUrl(baseUrl);
  if (!start) return [];

  const queue = [start];
  const seen = new Set([start]);
  const out: string[] = [];

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  while (queue.length && out.length < maxPages) {
    const url = queue.shift();
    if (!url) continue;

    // ISSUE 8 FIX: Only add URL to output AFTER successful navigation
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
      out.push(url); // Only add if navigation succeeded
    } catch (err: any) {
      // Don't add unreachable URLs to output - log and skip
      logger.debug(`Crawl skipping unreachable URL: ${url} - ${err.message}`);
      continue;
    }

    let links: string[] = [];
    try {
      links = await page.$$eval('a[href]', (as: HTMLAnchorElement[]) =>
        as.map((a: HTMLAnchorElement) => a.getAttribute('href')).filter((h: string | null): h is string => h !== null)
      );
    } catch {
      links = [];
    }

    for (const href of links) {
      if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;

      let abs: string;
      try {
        abs = new URL(href, url).toString();
      } catch {
        continue;
      }

      const normalized = normalizeUrl(abs);
      if (!normalized) continue;
      if (!normalized.startsWith(origin)) continue;
      if (!looksLikeHtmlPage(normalized)) continue;

      if (!seen.has(normalized)) {
        seen.add(normalized);
        queue.push(normalized);
      }
    }
  }

  await context.close();
  return out;
}

// ============================================================================
// Screenshot Capture
// ============================================================================

async function screenshotSectionsOnPage(
  context: BrowserContext,
  url: string,
  outDir: string,
  options: Required<ScreenshotOptions>
): Promise<PageScreenshots> {
  const pageSlug = slugifyPage(url);
  const pageDir = path.join(outDir, pageSlug);
  await fs.ensureDir(pageDir);

  const result: PageScreenshots = {
    url,
    pageSlug,
    fullPage: '',
    sections: []
  };

  const page = await context.newPage();
  page.setDefaultTimeout(options.timeout);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: options.timeout });
    await page.waitForTimeout(500); // Let animations settle
    
    // Wait for all images to fully load before capturing
    await waitForImagesToLoad(page);

    // Capture full-page screenshot
    const fullPagePath = path.join(pageDir, '__fullpage.png');
    await page.screenshot({ path: fullPagePath, fullPage: true });
    result.fullPage = fullPagePath;

    // Capture section screenshots if enabled
    if (options.captureSections) {
      const handles = await page.$$(SECTION_SELECTOR);
      const seenKeys = new Set<string>();
      let saved = 0;

      for (let i = 0; i < handles.length; i++) {
        const h = handles[i];

        const info = await h.evaluate((el: Element) => {
          const tag = el.tagName.toLowerCase();
          const id = el.id || '';
          const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 6).join('.');
          const role = el.getAttribute('role') || '';
          return { tag, id, cls, role };
        });

        const box = await h.boundingBox();
        if (!box) continue;
        if (box.width < 80 || box.height < 40) continue;

        const key = `${info.tag}|${info.id}|${info.role}|${Math.round(box.x)}|${Math.round(box.y)}|${Math.round(box.width)}|${Math.round(box.height)}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        try {
          await h.scrollIntoViewIfNeeded();
          await page.waitForTimeout(POST_SCROLL_WAIT); // Wait for lazy-load triggers
          
          // Wait for images within this section to load
          const sectionId = info.id ? `#${info.id}` : undefined;
          if (sectionId) {
            await waitForImagesToLoad(page, sectionId);
          } else {
            // For sections without ID, do a brief general wait for any newly triggered images
            await page.waitForTimeout(200);
          }

          const nameParts = [
            String(saved + 1).padStart(3, '0'),
            safePart(info.tag),
            info.id ? `id-${safePart(info.id)}` : '',
            info.role ? `role-${safePart(info.role)}` : '',
            info.cls ? `cls-${safePart(info.cls)}` : ''
          ].filter(Boolean);

          const fileName = `${nameParts.join('__')}.png`;
          const filePath = path.join(pageDir, fileName);

          await h.screenshot({ path: filePath });

          result.sections.push({
            name: fileName,
            path: filePath,
            tag: info.tag,
            id: info.id || undefined,
            role: info.role || undefined,
            className: info.cls || undefined
          });

          saved++;
        } catch {
          // Ignore elements that can't be screenshotted
        }
      }
    }

    logger.debug(`Screenshot captured for ${url}: ${result.sections.length} sections`);
  } catch (err: any) {
    logger.warn(`Failed to capture screenshots for ${url}: ${err.message}`);
    result.error = err.message;
  } finally {
    await page.close();
  }

  return result;
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanupOldIterations(
  baseDir: string,
  taskId: string,
  prefix: string,
  maxToKeep: number
): Promise<void> {
  const taskDir = path.join(baseDir, taskId);
  if (!(await fs.pathExists(taskDir))) return;

  try {
    const entries = await fs.readdir(taskDir);
    const iterations = entries
      .filter((e) => e.startsWith(`${prefix}_`))
      .map((e) => {
        const match = e.match(new RegExp(`^${prefix}_(\\d+)$`));
        return match ? { name: e, num: parseInt(match[1], 10) } : null;
      })
      .filter((e): e is { name: string; num: number } => e !== null)
      .sort((a, b) => b.num - a.num);

    // Remove old iterations beyond maxToKeep
    for (let i = maxToKeep; i < iterations.length; i++) {
      const dirToRemove = path.join(taskDir, iterations[i].name);
      logger.debug(`Cleaning up old screenshot iteration: ${dirToRemove}`);
      await fs.remove(dirToRemove);
    }
  } catch (err: any) {
    logger.warn(`Failed to cleanup old iterations: ${err.message}`);
  }
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Captures comprehensive website screenshots including full-page and section-level captures.
 * 
 * @param baseUrl - The base URL of the website to screenshot
 * @param taskId - The task ID for organizing screenshots
 * @param prefix - Either 'before' or 'after' to distinguish capture timing
 * @param iteration - The iteration number (for multiple runs of the same task)
 * @param userOptions - Optional configuration overrides
 * @returns Screenshot result with manifest and all captured images
 */
export async function captureWebsiteScreenshots(
  baseUrl: string,
  taskId: string,
  prefix: 'before' | 'after',
  iteration: number = 0,
  userOptions: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
  const options: Required<ScreenshotOptions> = { ...DEFAULT_OPTIONS, ...userOptions };
  const timestamp = new Date().toISOString();
  
  // Base output directory
  const screenshotsBaseDir = path.join(process.cwd(), 'public', 'screenshots');
  const outDir = path.join(screenshotsBaseDir, taskId, `${prefix}_${iteration}`);
  await fs.ensureDir(outDir);

  logger.info(`Capturing ${prefix} screenshots for task ${taskId} (iteration ${iteration})`);
  logger.debug(`Output directory: ${outDir}`);

  // Cleanup old iterations if enabled
  if (options.cleanupOldIterations) {
    await cleanupOldIterations(screenshotsBaseDir, taskId, prefix, options.maxIterationsToKeep);
  }

  const browser = await chromium.launch({ headless: true });
  let urls: string[] = [];

  try {
    // Get URLs from sitemap or crawl
    const sitemapAllowed = options.useSitemap === 'true' || options.useSitemap === 'auto';
    if (sitemapAllowed) {
      const sitemapUrls = await getUrlsFromSitemap(baseUrl, options.maxPages);
      if (sitemapUrls) {
        urls = sitemapUrls;
        logger.info(`Using sitemap.xml (${urls.length} URLs)`);
      }
    }

    if (urls.length === 0) {
      logger.info('Crawling site for pages...');
      urls = await crawlSite(browser, baseUrl, options.maxPages);
      logger.info(`Crawl found ${urls.length} URLs`);
    }

    // Ensure at least the base URL is included
    if (urls.length === 0) {
      urls = [baseUrl];
    }

    // Create shared context for consistency
    const context = await browser.newContext({
      viewport: options.viewport,
      deviceScaleFactor: 1
    });

    // Process pages with concurrency control
    const results: PageScreenshots[] = [];
    const queue = [...urls];

    const workers = Array.from(
      { length: Math.min(options.concurrency, queue.length) },
      async () => {
        while (queue.length) {
          const url = queue.shift();
          if (!url) break;
          const result = await screenshotSectionsOnPage(context, url, outDir, options);
          results.push(result);
        }
      }
    );

    await Promise.all(workers);
    await context.close();

    // ISSUE 2 FIX: Count successful vs failed page captures
    const successfulPages = results.filter(p => p.fullPage && !p.error);
    const failedPages = results.filter(p => !p.fullPage || p.error);
    const hasAnySuccess = successfulPages.length > 0;

    // Build manifest - paths should be relative to public folder for correct URL resolution
    const publicDir = path.join(process.cwd(), 'public');
    const manifest: ScreenshotManifest = {
      taskId,
      prefix,
      iteration,
      timestamp,
      baseUrl,
      totalPages: results.length,
      totalSections: results.reduce((sum, p) => sum + p.sections.length, 0),
      pages: results.map((p) => ({
        url: p.url,
        pageSlug: p.pageSlug,
        fullPage: p.fullPage ? path.relative(publicDir, p.fullPage).replace(/\\/g, '/') : '',
        sectionCount: p.sections.length,
        sections: p.sections.map((s) => ({
          ...s,
          path: path.relative(publicDir, s.path).replace(/\\/g, '/')
        })),
        error: p.error
      }))
    };

    // Write manifest
    const manifestPath = path.join(outDir, 'manifest.json');
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });

    // ISSUE 2 FIX: Log clear success/failure status
    if (hasAnySuccess) {
      logger.info(`Screenshots captured: ${successfulPages.length}/${results.length} pages successful, ${manifest.totalSections} sections`);
      if (failedPages.length > 0) {
        logger.warn(`Screenshot failures: ${failedPages.length} pages failed - ${failedPages.map(p => p.error || 'unknown error').join('; ')}`);
      }
    } else {
      // All pages failed - this is a critical error that should be surfaced
      const errorMsg = failedPages.map(p => p.error).filter(Boolean).join('; ') || 'All page captures failed';
      logger.error(`Screenshot capture FAILED: 0/${results.length} pages captured. Errors: ${errorMsg}`);
    }

    return {
      pages: results,
      manifest,
      manifestPath: path.relative(process.cwd(), manifestPath).replace(/\\/g, '/'),
      timestamp,
      // ISSUE 2 FIX: Return explicit success/failure status
      success: hasAnySuccess,
      failedPages: failedPages.length,
      error: hasAnySuccess ? undefined : (failedPages.map(p => p.error).filter(Boolean).join('; ') || 'All page captures failed')
    };
  } finally {
    await browser.close();
  }
}

/**
 * Loads a screenshot manifest from disk.
 * 
 * @param taskId - The task ID
 * @param prefix - 'before' or 'after'
 * @param iteration - The iteration number
 * @returns The manifest or null if not found
 */
export async function loadScreenshotManifest(
  taskId: string,
  prefix: 'before' | 'after',
  iteration: number = 0
): Promise<ScreenshotManifest | null> {
  const manifestPath = path.join(
    process.cwd(),
    'public',
    'screenshots',
    taskId,
    `${prefix}_${iteration}`,
    'manifest.json'
  );

  try {
    if (await fs.pathExists(manifestPath)) {
      return await fs.readJson(manifestPath);
    }
  } catch (err: any) {
    logger.warn(`Failed to load screenshot manifest: ${err.message}`);
  }

  return null;
}

/**
 * Gets all available screenshot manifests for a task.
 * 
 * @param taskId - The task ID
 * @returns Object with before and after manifests keyed by iteration
 */
export async function getAllScreenshotManifests(taskId: string): Promise<{
  before: Record<number, ScreenshotManifest>;
  after: Record<number, ScreenshotManifest>;
}> {
  const taskDir = path.join(process.cwd(), 'public', 'screenshots', taskId);
  const result: { before: Record<number, ScreenshotManifest>; after: Record<number, ScreenshotManifest> } = {
    before: {},
    after: {}
  };

  if (!(await fs.pathExists(taskDir))) {
    return result;
  }

  try {
    const entries = await fs.readdir(taskDir);
    
    for (const entry of entries) {
      const beforeMatch = entry.match(/^before_(\d+)$/);
      const afterMatch = entry.match(/^after_(\d+)$/);
      
      if (beforeMatch) {
        const iteration = parseInt(beforeMatch[1], 10);
        const manifest = await loadScreenshotManifest(taskId, 'before', iteration);
        if (manifest) {
          result.before[iteration] = manifest;
        }
      } else if (afterMatch) {
        const iteration = parseInt(afterMatch[1], 10);
        const manifest = await loadScreenshotManifest(taskId, 'after', iteration);
        if (manifest) {
          result.after[iteration] = manifest;
        }
      }
    }
  } catch (err: any) {
    logger.warn(`Failed to enumerate screenshot manifests: ${err.message}`);
  }

  return result;
}
