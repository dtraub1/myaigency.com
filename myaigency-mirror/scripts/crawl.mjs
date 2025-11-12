import { chromium } from 'playwright';
import { createWriteStream, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const config = JSON.parse(await import('fs').then(fs => fs.readFileSync(join(__dirname, 'config.json'), 'utf8')));

const stats = {
  pages: new Map(),
  assets: new Map(),
  errors: [],
  totalBytes: 0
};

const visited = new Set();
const queue = [];
const assetCache = new Map();

// Rate limiter
class RateLimiter {
  constructor(rps) {
    this.rps = rps;
    this.interval = 1000 / rps;
    this.lastCall = 0;
  }

  async throttle() {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;
    if (timeSinceLastCall < this.interval) {
      await new Promise(resolve => setTimeout(resolve, this.interval - timeSinceLastCall));
    }
    this.lastCall = Date.now();
  }
}

const limiter = new RateLimiter(config.rate_limit_rps);

function normalizeUrl(url, baseUrl) {
  try {
    const absolute = new URL(url, baseUrl);
    absolute.hash = '';
    return absolute.href;
  } catch {
    return null;
  }
}

function isSameOrigin(url, baseUrl) {
  try {
    const urlObj = new URL(url);
    const baseObj = new URL(baseUrl);
    return urlObj.origin === baseObj.origin;
  } catch {
    return false;
  }
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

function getExtension(url, contentType) {
  const urlPath = new URL(url).pathname;
  const ext = urlPath.split('.').pop();

  if (ext && ext.length <= 5 && !ext.includes('/')) {
    return ext;
  }

  const typeMap = {
    'text/css': 'css',
    'text/javascript': 'js',
    'application/javascript': 'js',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
    'font/woff2': 'woff2',
    'font/woff': 'woff',
    'font/ttf': 'ttf',
    'video/mp4': 'mp4',
    'video/webm': 'webm'
  };

  return typeMap[contentType] || 'bin';
}

async function downloadAsset(url, resourceType, contentType) {
  const cacheKey = url;
  if (assetCache.has(cacheKey)) {
    return assetCache.get(cacheKey);
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const hash = hashContent(buffer);
    const ext = getExtension(url, contentType || response.headers.get('content-type'));

    let subdir = 'media';
    if (resourceType === 'stylesheet' || ext === 'css') subdir = 'css';
    else if (resourceType === 'script' || ext === 'js') subdir = 'js';
    else if (resourceType === 'image' || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) subdir = 'images';
    else if (resourceType === 'font' || ['woff', 'woff2', 'ttf', 'otf'].includes(ext)) subdir = 'fonts';

    const filename = `${hash}.${ext}`;
    const relativePath = `assets/${subdir}/${filename}`;
    const fullPath = join(rootDir, relativePath);

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, buffer);

    stats.totalBytes += buffer.length;
    const assetInfo = {
      originalUrl: url,
      localPath: relativePath,
      size: buffer.length,
      type: resourceType,
      contentType: contentType || response.headers.get('content-type')
    };

    stats.assets.set(url, assetInfo);
    assetCache.set(cacheKey, assetInfo);

    return assetInfo;
  } catch (error) {
    stats.errors.push({ type: 'asset_download', url, error: error.message });
    return null;
  }
}

async function crawlPage(browser, url, depth = 0) {
  if (visited.has(url)) return;
  if (config.max_pages && visited.size >= config.max_pages) return;

  visited.add(url);
  await limiter.throttle();

  console.log(`[${visited.size}] Crawling: ${url}`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; WebsiteMirror/1.0)'
  });

  const pageData = {
    url,
    status: null,
    title: '',
    links: [],
    assets: [],
    screenshots: {},
    html: '',
    error: null
  };

  try {
    const page = await context.newPage();
    const requests = [];

    // Capture network requests
    page.on('request', request => {
      requests.push({
        url: request.url(),
        resourceType: request.resourceType(),
        method: request.method()
      });
    });

    page.on('response', async response => {
      const url = response.url();
      const resourceType = response.request().resourceType();

      if (!isSameOrigin(url, config.target_url) && resourceType !== 'document') {
        // Try to download cross-origin assets
        const contentType = response.headers()['content-type'];
        if (['stylesheet', 'script', 'image', 'font'].includes(resourceType)) {
          await downloadAsset(url, resourceType, contentType);
        }
      }
    });

    // Navigate to page
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    pageData.status = response.status();

    // Wait for any client-side rendering
    await page.waitForTimeout(2000);

    // Get page title
    pageData.title = await page.title();

    // Extract all links
    const links = await page.$$eval('a[href]', anchors =>
      anchors.map(a => a.href).filter(Boolean)
    );

    const sameOriginLinks = links
      .map(link => normalizeUrl(link, url))
      .filter(link => link && isSameOrigin(link, config.target_url))
      .filter(link => {
        if (config.include_paths.length > 0) {
          return config.include_paths.some(path => link.includes(path));
        }
        if (config.exclude_paths.length > 0) {
          return !config.exclude_paths.some(path => link.includes(path));
        }
        return true;
      });

    pageData.links = [...new Set(sameOriginLinks)];

    // Capture screenshots at each breakpoint
    for (const width of config.breakpoints) {
      await page.setViewportSize({ width, height: 1080 });
      await page.waitForTimeout(500);

      const screenshotPath = join(rootDir, `capture/screens/${hashContent(url)}-${width}.png`);
      await page.screenshot({
        path: screenshotPath,
        fullPage: true
      });

      pageData.screenshots[width] = `capture/screens/${hashContent(url)}-${width}.png`;
    }

    // Get final HTML
    pageData.html = await page.content();

    // Save HTML to file
    const htmlPath = join(rootDir, `capture/pages/${hashContent(url)}.html`);
    mkdirSync(dirname(htmlPath), { recursive: true });
    writeFileSync(htmlPath, pageData.html);

    // Save HAR-like trace
    const tracePath = join(rootDir, `capture/traces/${hashContent(url)}.json`);
    writeFileSync(tracePath, JSON.stringify({
      url,
      requests: requests.slice(0, 100), // Limit to first 100
      timestamp: new Date().toISOString()
    }, null, 2));

    await page.close();
    await context.close();

    // Add new links to queue
    pageData.links.forEach(link => {
      if (!visited.has(link) && !queue.includes(link)) {
        queue.push(link);
      }
    });

    stats.pages.set(url, pageData);

  } catch (error) {
    pageData.error = error.message;
    stats.errors.push({ type: 'page_crawl', url, error: error.message });
    console.error(`Error crawling ${url}: ${error.message}`);
  }

  return pageData;
}

async function main() {
  console.log('Starting crawl of', config.target_url);
  console.log('Breakpoints:', config.breakpoints);
  console.log('Rate limit:', config.rate_limit_rps, 'RPS');

  const browser = await chromium.launch({
    headless: true
  });

  // Start with the root URL
  queue.push(config.target_url);

  let retries = 0;
  let rootSuccess = false;

  while (queue.length > 0 && (!config.max_pages || visited.size < config.max_pages)) {
    const url = queue.shift();

    // Special handling for root URL
    if (url === config.target_url && !rootSuccess) {
      try {
        await crawlPage(browser, url);
        const rootPage = stats.pages.get(url);
        if (rootPage && rootPage.status === 200) {
          rootSuccess = true;
        } else {
          retries++;
          if (retries < 3) {
            queue.unshift(url);
            visited.delete(url);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          } else {
            console.error('FAIL: Non-200 on root URL after 3 retries');
            await browser.close();
            process.exit(1);
          }
        }
      } catch (error) {
        retries++;
        if (retries < 3) {
          queue.unshift(url);
          visited.delete(url);
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        } else {
          console.error('FAIL: Non-200 on root URL after 3 retries');
          await browser.close();
          process.exit(1);
        }
      }
    } else {
      await crawlPage(browser, url);
    }
  }

  await browser.close();

  // Generate report
  const report = {
    target_url: config.target_url,
    crawled_at: new Date().toISOString(),
    pages: {
      total: stats.pages.size,
      successful: Array.from(stats.pages.values()).filter(p => p.status === 200).length,
      failed: Array.from(stats.pages.values()).filter(p => p.status !== 200 || p.error).length
    },
    assets: {
      total: stats.assets.size,
      by_type: {}
    },
    total_bytes: stats.totalBytes,
    errors: stats.errors,
    page_list: Array.from(stats.pages.entries()).map(([url, data]) => ({
      url,
      status: data.status,
      title: data.title,
      links_count: data.links.length,
      error: data.error
    })),
    asset_list: Array.from(stats.assets.entries()).map(([url, data]) => ({
      url,
      local_path: data.localPath,
      size: data.size,
      type: data.type
    }))
  };

  // Count assets by type
  for (const [_, asset] of stats.assets) {
    const type = asset.type || 'other';
    report.assets.by_type[type] = (report.assets.by_type[type] || 0) + 1;
  }

  writeFileSync(
    join(rootDir, 'report.json'),
    JSON.stringify(report, null, 2)
  );

  console.log('\n=== Crawl Complete ===');
  console.log('Pages:', stats.pages.size);
  console.log('Assets:', stats.assets.size);
  console.log('Total bytes:', (stats.totalBytes / 1024 / 1024).toFixed(2), 'MB');
  console.log('Errors:', stats.errors.length);
  console.log('\nReport saved to report.json');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
