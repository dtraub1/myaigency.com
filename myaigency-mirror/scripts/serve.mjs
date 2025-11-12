import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const app = express();
const PORT = 4173;

// Serve static assets
app.use('/assets', express.static(join(rootDir, 'assets')));

// Serve mirror HTML pages
app.use(express.static(join(rootDir, 'mirror')));

// Fallback to index.html for SPA-style routing
app.get('*', (req, res) => {
  res.sendFile(join(rootDir, 'mirror', 'index.html'), err => {
    if (err) {
      res.status(404).send('Page not found');
    }
  });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Local mirror server running at http://localhost:${PORT}`);
  console.log('\nPress Ctrl+C to stop the server');
});
