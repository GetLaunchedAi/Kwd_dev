/**
 * section-screenshots.js
 *
 * What it does:
 * - Collects all site pages (via sitemap.xml if available, otherwise crawls internal links)
 * - Visits each page
 * - Finds "sections" (semantic + region-ish containers)
 * - Saves an element screenshot for each section into /screenshots/<page-slug>/
 *
 * Run:
 *   npm i playwright
 *   node section-screenshots.js https://example.com
 *
 * Options (env):
 *   OUT_DIR=screenshots
 *   MAX_PAGES=200
 *   USE_SITEMAP=auto   (auto|true|false)
 *   CONCURRENCY=2
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

const BASE_URL = process.argv[2];
if (!BASE_URL) {
  console.error("Usage: node section-screenshots.js https://example.com");
  process.exit(1);
}

const OUT_DIR = process.env.OUT_DIR || "screenshots";
const MAX_PAGES = Number(process.env.MAX_PAGES || 200);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 2));
const USE_SITEMAP = (process.env.USE_SITEMAP || "auto").toLowerCase(); // auto|true|false

// What we consider a "section":
// - semantic containers
// - explicit regions
// - common app sections via data attributes
const SECTION_SELECTOR = [
  "main",
  "header",
  "footer",
  "nav",
  "section",
  "article",
  "aside",
  '[role="main"]',
  '[role="navigation"]',
  '[role="contentinfo"]',
  '[role="banner"]',
  '[role="region"]',
  "[data-section]",
  '[data-testid*="section" i]',
  '[class*="section" i]',
].join(",");

function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    // keep query (sometimes important for routing); if you want to drop it, uncomment:
    // url.search = "";
    // Normalize trailing slash: keep root as '/', remove others
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

function isSameOrigin(base, candidate) {
  try {
    return new URL(candidate).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

function looksLikeHtmlPage(u) {
  try {
    const url = new URL(u);
    const p = url.pathname.toLowerCase();
    // Skip obvious non-pages
    if (p.endsWith(".pdf")) return false;
    if (p.match(/\.(png|jpg|jpeg|gif|webp|svg|mp4|webm|mov|zip|rar|7z|css|js|json|xml)$/)) return false;
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return true;
  } catch {
    return false;
  }
}

function slugifyPage(urlStr) {
  const url = new URL(urlStr);
  const p = url.pathname === "/" ? "home" : url.pathname.replace(/^\//, "").replace(/\//g, "__");
  const q = url.search ? "__q_" + url.search.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "") : "";
  const raw = (p + q).toLowerCase();
  return raw.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "page";
}

function safePart(s) {
  return String(s || "")
    .trim()
    .slice(0, 80)
    .replace(/[^\w\-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
}

/** Try sitemap.xml first (if enabled/auto). */
async function getUrlsFromSitemap(baseUrl) {
  const sitemapUrl = new URL("/sitemap.xml", baseUrl).toString();
  try {
    const res = await fetch(sitemapUrl, { redirect: "follow" });
    if (!res.ok) return null;
    const xml = await res.text();
    // naive parse <loc>...</loc>
    const locs = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)].map((m) => normalizeUrl(m[1])).filter(Boolean);
    const urls = [...new Set(locs)]
      .filter((u) => isSameOrigin(baseUrl, u))
      .filter(looksLikeHtmlPage)
      .slice(0, MAX_PAGES);
    return urls.length ? urls : null;
  } catch {
    return null;
  }
}

/** Crawl internal links using Playwright. */
async function crawlSite(browser, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const start = normalizeUrl(baseUrl);
  const queue = [start];
  const seen = new Set([start]);
  const out = [];

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  while (queue.length && out.length < MAX_PAGES) {
    const url = queue.shift();
    out.push(url);

    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    } catch {
      // still try to pull links from whatever loaded
    }

    let links = [];
    try {
      links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")).filter(Boolean));
    } catch {
      links = [];
    }

    for (const href of links) {
      // Skip mailto/tel/javascript
      if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;

      let abs;
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

async function screenshotSectionsOnPage(context, url, outDir) {
  const pageSlug = slugifyPage(url);
  const pageDir = path.join(outDir, pageSlug);
  await ensureDir(pageDir);

  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    // Give client-side apps a moment to settle animations/layout
    await page.waitForTimeout(500);

    // Optional: capture a full-page screenshot too
    await page.screenshot({ path: path.join(pageDir, "__fullpage.png"), fullPage: true });

    const handles = await page.$$(SECTION_SELECTOR);

    // De-dupe by bounding box + tagName + id/class-ish signature
    const seenKeys = new Set();
    let saved = 0;

    for (let i = 0; i < handles.length; i++) {
      const h = handles[i];

      const info = await h.evaluate((el) => {
        const tag = el.tagName.toLowerCase();
        const id = el.id || "";
        const cls = (el.getAttribute("class") || "").split(/\s+/).slice(0, 6).join(".");
        const role = el.getAttribute("role") || "";
        return { tag, id, cls, role };
      });

      const box = await h.boundingBox();
      if (!box) continue;

      // Skip tiny boxes (likely invisible separators / empty wrappers)
      if (box.width < 80 || box.height < 40) continue;

      const key = `${info.tag}|${info.id}|${info.role}|${Math.round(box.x)}|${Math.round(box.y)}|${Math.round(
        box.width
      )}|${Math.round(box.height)}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      // Scroll into view then screenshot element
      try {
        await h.scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);

        const nameParts = [
          String(saved + 1).padStart(3, "0"),
          safePart(info.tag),
          info.id ? `id-${safePart(info.id)}` : "",
          info.role ? `role-${safePart(info.role)}` : "",
          info.cls ? `cls-${safePart(info.cls)}` : "",
        ].filter(Boolean);

        const fileName = `${nameParts.join("__")}.png`;
        const filePath = path.join(pageDir, fileName);

        await h.screenshot({ path: filePath });
        saved++;
      } catch {
        // ignore elements that can't be screenshotted (detached, covered, etc.)
      }
    }

    // Write a small manifest for the page
    await fsp.writeFile(
      path.join(pageDir, "__manifest.json"),
      JSON.stringify({ url, pageSlug, sectionSelector: SECTION_SELECTOR, sectionsSaved: saved }, null, 2),
      "utf8"
    );

    console.log(`✅ ${url} -> ${saved} section screenshots`);
  } catch (err) {
    console.log(`❌ Failed: ${url}\n   ${String(err?.message || err)}`);
  } finally {
    await page.close();
  }
}

async function run() {
  await ensureDir(OUT_DIR);

  const browser = await chromium.launch({ headless: true });

  let urls = null;

  const sitemapAllowed = USE_SITEMAP === "true" || USE_SITEMAP === "auto";
  if (sitemapAllowed) {
    urls = await getUrlsFromSitemap(BASE_URL);
    if (urls) console.log(`🗺️  Using sitemap.xml (${urls.length} URLs)`);
  }

  if (!urls) {
    if (USE_SITEMAP === "true") {
      console.log("⚠️  USE_SITEMAP=true but sitemap.xml not found/usable. Falling back to crawl.");
    } else {
      console.log("🕷️  Crawling site for pages...");
    }
    urls = await crawlSite(browser, BASE_URL);
    console.log(`🕷️  Crawl found ${urls.length} URLs`);
  }

  // Shared context for better performance/consistency
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  // Simple concurrency pool
  const queue = urls.slice(0, MAX_PAGES);
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const url = queue.shift();
      if (!url) break;
      await screenshotSectionsOnPage(context, url, OUT_DIR);
    }
  });

  await Promise.all(workers);

  await context.close();
  await browser.close();

  console.log(`\nDone. Screenshots saved to: ${path.resolve(OUT_DIR)}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
