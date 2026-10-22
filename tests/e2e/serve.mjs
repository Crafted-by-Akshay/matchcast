// Builds the unified app into .e2e-dist with three.js served locally, then serves it on :4173.
// The live api (rules mode, MemoryStore) is added here once EXP-1 lands; until then the app runs offline (simulated).
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const dist = join(root, '.e2e-dist');
const port = Number(process.env.E2E_PORT || 4173);

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'node_modules'), { recursive: true });
symlinkSync(join(root, 'node_modules/three'), join(dist, 'node_modules/three'), 'dir');
execFileSync('python3', [join(root, 'apps/unified/build.py'), dist], { stdio: 'inherit' });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(dist, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${dist} on http://localhost:${port}`));
