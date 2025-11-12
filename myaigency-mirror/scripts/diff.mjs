import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { createHash } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const config = JSON.parse(readFileSync(join(__dirname, 'config.json'), 'utf8'));

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

const diffResults = {
  pages: [],
  summary: {
    total: 0,
    passed: 0,
    failed: 0,
    passRate: 0
  }
};

async function compareScreenshots(originalPath, newPath, diffPath) {
  if (!existsSync(originalPath)) {
    return { error: 'Original screenshot not found', mismatch: 100 };
  }

  try {
    const img1 = PNG.sync.read(readFileSync(originalPath));
    const img2 = PNG.sync.read(readFileSync(newPath));

    const { width, height } = img1;

    // Resize if dimensions don't match
    if (img2.width !== width || img2.height !== height) {
      return { error: 'Dimension mismatch', mismatch: 100 };
    }

    const diff = new PNG({ width, height });
    const numDiffPixels = pixelmatch(
      img1.data,
      img2.data,
      diff.data,
      width,
      height,
      { threshold: 0.1 }
    );

    // Save diff image
    mkdirSync(dirname(diffPath), { recursive: true });
    writeFileSync(diffPath, PNG.sync.write(diff));

    const totalPixels = width * height;
    const mismatchPercent = (numDiffPixels / totalPixels) * 100;

    return {
      mismatch: mismatchPercent,
      diffPixels: numDiffPixels,
      totalPixels
    };
  } catch (error) {
    return { error: error.message, mismatch: 100 };
  }
}

async function captureLocalScreenshot(browser, url, width, outputPath) {
  const page = await browser.newPage();
  await page.setViewportSize({ width, height: 1080 });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: outputPath, fullPage: true });
    await page.close();
    return true;
  } catch (error) {
    console.error(`Error capturing ${url}:`, error.message);
    await page.close();
    return false;
  }
}

async function main() {
  console.log('Starting visual diff comparison...\n');

  const report = JSON.parse(readFileSync(join(rootDir, 'report.json'), 'utf8'));
  const browser = await chromium.launch({ headless: true });

  const localBaseUrl = 'http://localhost:4173';

  for (const pageInfo of report.page_list) {
    if (pageInfo.status !== 200 || pageInfo.error) continue;

    const urlObj = new URL(pageInfo.url);
    let localPath = urlObj.pathname;
    if (localPath === '/' || localPath === '') {
      localPath = '/';
    }

    const localUrl = `${localBaseUrl}${localPath}`;
    const pageHash = hashContent(pageInfo.url);

    console.log(`Comparing: ${pageInfo.url}`);

    const pageResult = {
      url: pageInfo.url,
      localUrl: localUrl,
      breakpoints: {}
    };

    for (const width of config.breakpoints) {
      const originalScreenshot = join(rootDir, `capture/screens/${pageHash}-${width}.png`);
      const newScreenshot = join(rootDir, `capture/screens/${pageHash}-${width}-local.png`);
      const diffScreenshot = join(rootDir, `capture/screens/${pageHash}-${width}-diff.png`);

      // Capture new screenshot from local server
      const success = await captureLocalScreenshot(browser, localUrl, width, newScreenshot);

      if (!success) {
        pageResult.breakpoints[width] = { error: 'Failed to capture local screenshot', pass: false };
        continue;
      }

      // Compare screenshots
      const comparison = await compareScreenshots(originalScreenshot, newScreenshot, diffScreenshot);

      const pass = comparison.mismatch <= config.visual_diff_threshold;

      pageResult.breakpoints[width] = {
        mismatch: comparison.mismatch?.toFixed(2),
        pass,
        error: comparison.error,
        diffPixels: comparison.diffPixels,
        totalPixels: comparison.totalPixels,
        originalScreenshot: `capture/screens/${pageHash}-${width}.png`,
        newScreenshot: `capture/screens/${pageHash}-${width}-local.png`,
        diffScreenshot: `capture/screens/${pageHash}-${width}-diff.png`
      };

      console.log(`  ${width}px: ${pass ? '✓' : '✗'} ${comparison.mismatch?.toFixed(2)}% mismatch`);
    }

    // Determine if page passes overall
    const breakpointResults = Object.values(pageResult.breakpoints);
    const allPass = breakpointResults.every(r => r.pass);
    pageResult.pass = allPass;

    diffResults.pages.push(pageResult);
  }

  await browser.close();

  // Calculate summary
  diffResults.summary.total = diffResults.pages.length;
  diffResults.summary.passed = diffResults.pages.filter(p => p.pass).length;
  diffResults.summary.failed = diffResults.summary.total - diffResults.summary.passed;
  diffResults.summary.passRate = ((diffResults.summary.passed / diffResults.summary.total) * 100).toFixed(1);

  // Save diff results
  writeFileSync(
    join(rootDir, 'diff-results.json'),
    JSON.stringify(diffResults, null, 2)
  );

  // Generate HTML report
  const htmlReport = generateHtmlReport(diffResults, report);
  writeFileSync(join(rootDir, 'diff-report.html'), htmlReport);

  console.log('\n=== Visual Diff Summary ===');
  console.log(`Total pages: ${diffResults.summary.total}`);
  console.log(`Passed: ${diffResults.summary.passed}`);
  console.log(`Failed: ${diffResults.summary.failed}`);
  console.log(`Pass rate: ${diffResults.summary.passRate}%`);
  console.log('\nReports saved:');
  console.log('  - diff-results.json');
  console.log('  - diff-report.html');

  // Check fail condition
  if (diffResults.summary.failed / diffResults.summary.total > 0.25) {
    console.error('\n❌ FAIL: More than 25% of pages exceed 5% visual diff');
    process.exit(1);
  }
}

function generateHtmlReport(diffResults, crawlReport) {
  const failedPages = diffResults.pages.filter(p => !p.pass);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Visual Diff Report - myaigency.com Mirror</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; background: #f5f5f5; }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { margin-bottom: 1rem; color: #333; }
    .summary { background: white; padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem; }
    .stat { text-align: center; padding: 1rem; background: #f9f9f9; border-radius: 4px; }
    .stat-value { font-size: 2rem; font-weight: bold; color: #2563eb; }
    .stat-label { font-size: 0.875rem; color: #666; margin-top: 0.5rem; }
    .page-result { background: white; padding: 1.5rem; border-radius: 8px; margin-bottom: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .page-url { font-weight: 500; color: #333; word-break: break-all; }
    .badge { padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 0.875rem; font-weight: 500; }
    .badge.pass { background: #dcfce7; color: #166534; }
    .badge.fail { background: #fee2e2; color: #991b1b; }
    .breakpoint-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
    .breakpoint { border: 1px solid #e5e7eb; border-radius: 4px; padding: 1rem; }
    .breakpoint-header { font-weight: 500; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; }
    .mismatch { font-size: 0.875rem; color: #666; }
    .screenshots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-top: 0.5rem; }
    .screenshot { text-align: center; }
    .screenshot img { width: 100%; border: 1px solid #e5e7eb; border-radius: 4px; cursor: pointer; transition: transform 0.2s; }
    .screenshot img:hover { transform: scale(1.02); }
    .screenshot-label { font-size: 0.75rem; color: #666; margin-top: 0.25rem; }
    .section-title { font-size: 1.25rem; font-weight: 600; margin: 2rem 0 1rem; color: #333; }
    .no-failures { text-align: center; padding: 2rem; color: #16a34a; font-weight: 500; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Visual Diff Report</h1>
    <p style="color: #666; margin-bottom: 2rem;">Generated: ${new Date().toISOString()}</p>

    <div class="summary">
      <h2 style="margin-bottom: 1rem;">Summary</h2>
      <div class="summary-grid">
        <div class="stat">
          <div class="stat-value">${diffResults.summary.total}</div>
          <div class="stat-label">Total Pages</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="color: #16a34a;">${diffResults.summary.passed}</div>
          <div class="stat-label">Passed</div>
        </div>
        <div class="stat">
          <div class="stat-value" style="color: #dc2626;">${diffResults.summary.failed}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat">
          <div class="stat-value">${diffResults.summary.passRate}%</div>
          <div class="stat-label">Pass Rate</div>
        </div>
      </div>
    </div>

    ${failedPages.length > 0 ? `
    <h2 class="section-title">Failed Pages (${failedPages.length})</h2>
    ${failedPages.map(page => `
      <div class="page-result">
        <div class="page-header">
          <div class="page-url">${page.url}</div>
          <span class="badge fail">FAIL</span>
        </div>
        <div class="breakpoint-grid">
          ${Object.entries(page.breakpoints).map(([width, result]) => `
            <div class="breakpoint">
              <div class="breakpoint-header">
                <span>${width}px</span>
                ${result.pass ? '<span class="badge pass">✓</span>' : `<span class="mismatch">${result.mismatch}% diff</span>`}
              </div>
              ${result.error ? `<p style="color: #dc2626; font-size: 0.875rem;">${result.error}</p>` : `
                <div class="screenshots">
                  <div class="screenshot">
                    <img src="../${result.originalScreenshot}" alt="Original" onclick="window.open(this.src)">
                    <div class="screenshot-label">Original</div>
                  </div>
                  <div class="screenshot">
                    <img src="../${result.newScreenshot}" alt="Local" onclick="window.open(this.src)">
                    <div class="screenshot-label">Local</div>
                  </div>
                  <div class="screenshot">
                    <img src="../${result.diffScreenshot}" alt="Diff" onclick="window.open(this.src)">
                    <div class="screenshot-label">Diff</div>
                  </div>
                </div>
              `}
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}
    ` : '<div class="no-failures">🎉 All pages passed visual comparison!</div>'}

    <h2 class="section-title">All Pages (${diffResults.pages.length})</h2>
    ${diffResults.pages.map(page => `
      <div class="page-result">
        <div class="page-header">
          <div class="page-url">${page.url}</div>
          <span class="badge ${page.pass ? 'pass' : 'fail'}">${page.pass ? 'PASS' : 'FAIL'}</span>
        </div>
        <div class="breakpoint-grid">
          ${Object.entries(page.breakpoints).map(([width, result]) => `
            <div class="breakpoint">
              <div class="breakpoint-header">
                <span>${width}px</span>
                ${result.pass ? '<span class="badge pass">✓</span>' : `<span class="mismatch">${result.mismatch}% diff</span>`}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}
  </div>
</body>
</html>`;
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
