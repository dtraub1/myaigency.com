import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

function urlToLocalPath(url, assetMap) {
  const asset = assetMap.get(url);
  if (asset) {
    return '/' + asset.localPath;
  }
  return null;
}

function rewriteHtml(html, pageUrl, assetMap, pageMap, baseUrl) {
  let rewritten = html;

  // Create asset lookup by original URL
  const urlToPath = new Map();
  for (const [url, data] of assetMap) {
    urlToPath.set(url, '/' + data.localPath);
  }

  // Rewrite <link> tags
  rewritten = rewritten.replace(
    /<link([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi,
    (match, before, href, after) => {
      const absoluteUrl = new URL(href, pageUrl).href;
      const localPath = urlToPath.get(absoluteUrl);
      if (localPath) {
        return `<link${before}href="${localPath}"${after}>`;
      }
      return match;
    }
  );

  // Rewrite <script> tags
  rewritten = rewritten.replace(
    /<script([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi,
    (match, before, src, after) => {
      const absoluteUrl = new URL(src, pageUrl).href;
      const localPath = urlToPath.get(absoluteUrl);
      if (localPath) {
        return `<script${before}src="${localPath}"${after}>`;
      }
      return match;
    }
  );

  // Rewrite <img> tags
  rewritten = rewritten.replace(
    /<img([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi,
    (match, before, src, after) => {
      try {
        const absoluteUrl = new URL(src, pageUrl).href;
        const localPath = urlToPath.get(absoluteUrl);
        if (localPath) {
          return `<img${before}src="${localPath}"${after}>`;
        }
      } catch (e) {
        // Invalid URL, skip
      }
      return match;
    }
  );

  // Rewrite srcset attributes
  rewritten = rewritten.replace(
    /srcset=["']([^"']+)["']/gi,
    (match, srcset) => {
      const rewrittenSrcset = srcset.split(',').map(part => {
        const [url, descriptor] = part.trim().split(/\s+/);
        try {
          const absoluteUrl = new URL(url, pageUrl).href;
          const localPath = urlToPath.get(absoluteUrl);
          if (localPath) {
            return descriptor ? `${localPath} ${descriptor}` : localPath;
          }
        } catch (e) {
          // Invalid URL, skip
        }
        return part.trim();
      }).join(', ');
      return `srcset="${rewrittenSrcset}"`;
    }
  );

  // Rewrite inline styles with background images
  rewritten = rewritten.replace(
    /style=["']([^"']*?)["']/gi,
    (match, style) => {
      const rewrittenStyle = style.replace(
        /url\(['"]?([^'"()]+)['"]?\)/gi,
        (urlMatch, url) => {
          try {
            const absoluteUrl = new URL(url, pageUrl).href;
            const localPath = urlToPath.get(absoluteUrl);
            if (localPath) {
              return `url('${localPath}')`;
            }
          } catch (e) {
            // Invalid URL, skip
          }
          return urlMatch;
        }
      );
      return `style="${rewrittenStyle}"`;
    }
  );

  // Rewrite <style> blocks
  rewritten = rewritten.replace(
    /<style([^>]*)>(.*?)<\/style>/gis,
    (match, attrs, content) => {
      const rewrittenContent = content.replace(
        /url\(['"]?([^'"()]+)['"]?\)/gi,
        (urlMatch, url) => {
          try {
            const absoluteUrl = new URL(url, pageUrl).href;
            const localPath = urlToPath.get(absoluteUrl);
            if (localPath) {
              return `url('${localPath}')`;
            }
          } catch (e) {
            // Invalid URL, skip
          }
          return urlMatch;
        }
      );
      return `<style${attrs}>${rewrittenContent}</style>`;
    }
  );

  // Rewrite internal page links
  rewritten = rewritten.replace(
    /<a([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi,
    (match, before, href, after) => {
      try {
        const url = new URL(href, pageUrl);
        // Check if it's a same-origin link
        const baseUrlObj = new URL(baseUrl);
        if (url.origin === baseUrlObj.origin) {
          // Find the corresponding local page
          const normalizedUrl = url.href.replace(url.hash, '');
          const localPage = pageMap.get(normalizedUrl);
          if (localPage) {
            return `<a${before}href="${localPage}"${after}>`;
          }
        }
      } catch (e) {
        // Invalid URL or relative path, skip
      }
      return match;
    }
  );

  return rewritten;
}

function rewriteCss(css, cssUrl, assetMap) {
  const urlToPath = new Map();
  for (const [url, data] of assetMap) {
    urlToPath.set(url, '/' + data.localPath);
  }

  return css.replace(
    /url\(['"]?([^'"()]+)['"]?\)/gi,
    (match, url) => {
      try {
        const absoluteUrl = new URL(url, cssUrl).href;
        const localPath = urlToPath.get(absoluteUrl);
        if (localPath) {
          return `url('${localPath}')`;
        }
      } catch (e) {
        // Invalid URL, skip
      }
      return match;
    }
  );
}

async function main() {
  console.log('Reading report.json...');
  const report = JSON.parse(readFileSync(join(rootDir, 'report.json'), 'utf8'));

  // Build asset map
  const assetMap = new Map(
    report.asset_list.map(asset => [asset.url, { localPath: asset.local_path, type: asset.type }])
  );

  // Build page map (URL -> local HTML path)
  const pageMap = new Map();

  console.log('Rewriting HTML pages...');
  for (const pageInfo of report.page_list) {
    if (pageInfo.status !== 200 || pageInfo.error) {
      console.log(`Skipping ${pageInfo.url} (status ${pageInfo.status})`);
      continue;
    }

    // Find the page data in stats
    const tracePath = join(rootDir, `capture/traces/${hashContent(pageInfo.url)}.json`);
    const trace = JSON.parse(readFileSync(tracePath, 'utf8'));

    // Read the HTML from report
    const pageDataFile = join(rootDir, `capture/pages/${hashContent(pageInfo.url)}.html`);
    let html;

    // The HTML should be in the page data, but if not we need to re-crawl
    // For now, let's look for it in the pages directory or create it from stats
    try {
      html = readFileSync(pageDataFile, 'utf8');
    } catch {
      // HTML wasn't saved separately, skip for now
      // We'll need to get it from the crawl stats
      console.log(`Warning: HTML not found for ${pageInfo.url}`);
      continue;
    }

    // Determine local path for this page
    const urlObj = new URL(pageInfo.url);
    let localPath = urlObj.pathname;
    if (localPath === '/' || localPath === '') {
      localPath = '/index.html';
    } else if (!localPath.endsWith('.html') && !localPath.includes('.')) {
      localPath = localPath.replace(/\/$/, '') + '/index.html';
    }

    pageMap.set(pageInfo.url, localPath);
  }

  // Now rewrite and save HTML
  for (const pageInfo of report.page_list) {
    if (pageInfo.status !== 200 || pageInfo.error) continue;

    const pageDataFile = join(rootDir, `capture/pages/${hashContent(pageInfo.url)}.html`);
    let html;

    try {
      html = readFileSync(pageDataFile, 'utf8');
    } catch {
      continue;
    }

    const localPath = pageMap.get(pageInfo.url);
    if (!localPath) continue;

    // Rewrite HTML
    const rewrittenHtml = rewriteHtml(
      html,
      pageInfo.url,
      assetMap,
      pageMap,
      report.target_url
    );

    // Save to mirror directory
    const outputPath = join(rootDir, 'mirror', localPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, rewrittenHtml);

    console.log(`✓ ${pageInfo.url} -> ${localPath}`);
  }

  // Rewrite CSS files
  console.log('\nRewriting CSS files...');
  const cssAssets = report.asset_list.filter(a => a.type === 'stylesheet' || a.local_path.includes('.css'));

  for (const cssAsset of cssAssets) {
    try {
      const cssPath = join(rootDir, cssAsset.local_path);
      const css = readFileSync(cssPath, 'utf8');
      const rewrittenCss = rewriteCss(css, cssAsset.url, assetMap);
      writeFileSync(cssPath, rewrittenCss);
      console.log(`✓ ${cssAsset.local_path}`);
    } catch (error) {
      console.error(`Error rewriting ${cssAsset.local_path}:`, error.message);
    }
  }

  console.log('\n=== Rewrite Complete ===');
  console.log('Pages rewritten:', pageMap.size);
  console.log('CSS files rewritten:', cssAssets.length);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
