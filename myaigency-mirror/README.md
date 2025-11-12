# myaigency.com Static Mirror

Pixel-perfect static mirror of myaigency.com for offline serving and version control.

## Quick Start

```bash
# Install dependencies
npm install

# Run full build (crawl + rewrite)
npm run build

# Serve locally
npm run serve

# Run visual diff tests (requires server to be running)
npm run test
```

## Individual Commands

```bash
# Crawl website and capture assets
npm run crawl

# Rewrite URLs for local serving
npm run rewrite

# Start local server (http://localhost:4173)
npm run serve

# Run visual diff comparison
npm run diff
```

## Configuration

Edit `scripts/config.json` to customize:

```json
{
  "target_url": "https://myaigency.com",
  "breakpoints": [390, 768, 1280],
  "include_paths": [],
  "exclude_paths": [],
  "rate_limit_rps": 4,
  "max_pages": null,
  "robots_respect": false,
  "visual_diff_threshold": 1.5
}
```

## Directory Structure

```
myaigency-mirror/
├── mirror/              # Rewritten HTML files
├── assets/              # Downloaded static assets
│   ├── css/
│   ├── js/
│   ├── images/
│   ├── fonts/
│   └── media/
├── capture/
│   ├── traces/          # Network request logs (HAR-like)
│   ├── screens/         # Screenshots (original + local + diff)
│   └── pages/           # Raw HTML captures
├── scripts/             # Build scripts
│   ├── crawl.mjs
│   ├── rewrite.mjs
│   ├── serve.mjs
│   ├── diff.mjs
│   └── config.json
├── report.json          # Crawl statistics
├── diff-results.json    # Visual diff data
└── diff-report.html     # Visual diff report (open in browser)
```

## Reports

After running the full workflow, check:

- **report.json**: Crawl statistics, discovered pages, asset inventory
- **diff-report.html**: Side-by-side visual comparisons with mismatch percentages
- **diff-results.json**: Raw visual diff data

## Visual Diff Criteria

- **Pass**: Mismatch ≤ 1.5% per viewport
- **Fail**: Mismatch > 1.5% per viewport

The project will fail if more than 25% of pages have >5% visual diff.

## Notes

- Cross-origin assets are downloaded if publicly accessible
- Client-side routes are discovered via DOM link extraction
- Screenshots are captured at multiple breakpoints for responsive testing
- Rate limiting prevents overwhelming the target server
- Network traces help debug asset loading issues

## License

Generated with Claude Code
