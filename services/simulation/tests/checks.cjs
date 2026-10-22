// DAT-9 checks that need no long run: node tests/checks.cjs
//  1. engine xG constants equal data/calibration/xg.json
//  2. Math.random appears only where an unseeded draw changes no event, number or sentence
//  3. the same seed gives byte-identical event JSON, and a different seed does not (half = 5, about 15 s)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const REPO = path.resolve(__dirname, '..', '..', '..');
const RUN = path.resolve(__dirname, '..', 'run.cjs');
let failed = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) failed++; };

// 1
const fit = JSON.parse(fs.readFileSync(path.join(REPO, 'data/calibration/xg.json'), 'utf8'));
for (const f of ['3d-source/v2/main.js', 'broadcaster-console/engine/main.js']) {
  const src = fs.readFileSync(path.join(REPO, 'apps/unified/sources', f), 'utf8');
  const m = /const XG = \{ b0: (-?[\d.]+), b1: (-?[\d.]+), b2: (-?[\d.]+)/.exec(src);
  check('xG constants in ' + f, !!m && +m[1] === fit.b0 && +m[2] === fit.b1 && +m[3] === fit.b2);
}

// 2: allowed files and how many Math.random calls each may hold (new-seed creation, rain drop positions, animation phase)
const ALLOWED = { 'setup.js': 1, 'worldvis.js': 3, 'main.js': 1, 'bc-core.js': 1 };
for (const dir of ['3d-source/v2', 'broadcaster-console/engine', 'broadcaster-console/src']) {
  for (const f of fs.readdirSync(path.join(REPO, 'apps/unified/sources', dir)).filter((x) => x.endsWith('.js'))) {
    const n = (fs.readFileSync(path.join(REPO, 'apps/unified/sources', dir, f), 'utf8').match(/Math\.random/g) || []).length;
    if (n) check('Math.random in ' + dir + '/' + f, n <= (ALLOWED[f] || 0), '(' + n + ', allowed ' + (ALLOWED[f] || 0) + ')');
  }
}

// 3
function eventsHash(seed, out) {
  execFileSync('node', [RUN, '--seeds', String(seed), '--half', '5', '--workers', '1', '--events', '--out', out], { stdio: 'ignore' });
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(out, seed + '.json'))).digest('hex');
}
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mc-det-'));
const a = eventsHash(5, path.join(tmp, 'a')), b = eventsHash(5, path.join(tmp, 'b')), c = eventsHash(6, path.join(tmp, 'c'));
check('same seed, identical event JSON', a === b, a.slice(0, 12));
check('different seed, different events', a !== c);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
