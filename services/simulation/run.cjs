// Headless MatchCast runner. Builds the unified app, serves it on localhost and drives the Watch engine in
// Chromium with stepSim() on a fixed 0.02 s step (no rendering), so one seed always gives the same events.
//   node run.cjs --seeds 1-40 --half 45 --workers 4 --out out/ [--events] [--dt 0.02]
// Prints one JSON line per finished match and writes <out>/summary.json (and <out>/<seed>.json with --events).
// --half is real minutes per half in the engine's own clock: 45 is full density (90 match minutes, option A), 5 is the old prototype.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => {
  if (v.startsWith('--')) a.push([v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return a;
}, []));
const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const half = +(args.half || 45), tune = args.tune ? String(args.tune) : '', dt = +(args.dt || 0.02), workers = +(args.workers || 2);
const seeds = [];
for (const part of String(args.seeds || '1-3').split(',')) {
  const [a, b] = part.split('-').map(Number);
  for (let s = a; s <= (b || a); s++) seeds.push(s);
}
const outDir = args.out ? path.resolve(String(args.out)) : null;

function loadPlaywright() {
  for (const m of ['playwright-core', 'playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(m); } catch (e) { /* try the next */ }
  }
  throw new Error('playwright-core is not installed: run npm ci in services/simulation');
}

function buildApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-sim-'));
  execFileSync('python3', [path.join(REPO, 'apps/unified/build.py'), dir], { stdio: 'ignore' });
  // build.py points three.js at /node_modules/three; serve it from this package's install
  const three = ['three', path.join(HERE, 'node_modules/three'), '/opt/node22/lib/node_modules/three'].find((p) => p !== 'three' && fs.existsSync(p));
  if (!three) throw new Error('three is not installed: run npm ci in services/simulation');
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  fs.symlinkSync(three, path.join(dir, 'node_modules/three'));
  return dir;
}

function serve(dir) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
  const srv = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// runs inside the page: one whole match, then the per-match numbers the realism check needs
function playMatch([seed, half, dt]) {   // the page has already kicked off from the query string
  const mc = window.__mc;
  const t0 = performance.now(); let n = 0;
  while (!mc.S.over && n < 2000000) { mc.stepSim(dt); n++; }
  const ev = mc.ENV.events, c = {};
  for (const e of ev) c[e.type] = (c[e.type] || 0) + 1;
  const goals = ev.filter((e) => e.type === 'goal'), pens = ev.filter((e) => e.type === 'shot' && e.kind === 'penalty' && e.fate === 'goal');
  return {
    seed, half, dt, steps: n, over: mc.S.over, wallMs: Math.round(performance.now() - t0),
    score: mc.S.score.slice(), shots: mc.STATS.shots.slice(), passes: mc.STATS.passes.slice(), xg: mc.STATS.xg.map((x) => +x.toFixed(3)),
    director: { longest: mc.DIRC.longest, bySc: mc.DIRC.bySc, liveS: +mc.DIRC.liveS.toFixed(1), ffS: +mc.DIRC.ffS.toFixed(1), cuts: mc.DIRC.ranges.length, watchMin: +((mc.DIRC.liveS + mc.DIRC.ffS / mc.DIRC.ffX) / 60).toFixed(2) },
    counts: c, goalMinutes: goals.map((g) => g.minute), penaltyGoals: pens.length, events: ev,
  };
}

// same hashing as the engine's sub-streams (world.js hash32 + mulberry), so a seed always picks the same fixture
const hash32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
let CLUBS = null;
// each seed plays two different season clubs (their squads and ratings) at a stadium and month drawn from the seed
function setupFor(seed) {
  const R = mulberry(hash32(seed + ':fixture')), n = CLUBS.length;
  const h = Math.floor(R() * n); let a = Math.floor(R() * (n - 1)); if (a >= h) a++;
  const q = { seed, half, st: Math.floor(R() * 5), month: Math.floor(R() * 12), h: CLUBS[h].key, a: CLUBS[a].key }; if (tune) q.tune = tune; return new URLSearchParams(q).toString();
}

(async () => {
  const pw = loadPlaywright();
  const dir = buildApp(), srv = await serve(dir), base = 'http://127.0.0.1:' + srv.address().port;
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  CLUBS = JSON.parse(fs.readFileSync(path.join(dir, 'shared/clubs.json'), 'utf8')).clubs;
  const browser = await pw.chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const queue = seeds.slice(), results = [];
  async function worker() {
    const page = await browser.newPage();
    await page.addInitScript(() => { window.__mcHeadless = true; });
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    while (queue.length) {
      const seed = queue.shift();
      // a fresh page per match: the engine keeps module state (stats, stamina) that kickOff only partly resets
      await page.goto(base + '/watch/index.html?' + setupFor(seed), { waitUntil: 'domcontentloaded', timeout: 240000 });
      await page.waitForFunction(() => window.__mc && window.__mc.players.length && window.__mc.S.started, null, { timeout: 240000 });
      const r = await page.evaluate(playMatch, [seed, half, dt]);
      if (outDir && args.events) fs.writeFileSync(path.join(outDir, seed + '.json'), JSON.stringify({ seed, half, events: r.events }));
      delete r.events;
      results.push(r);
      console.log(JSON.stringify(r));
    }
    await page.close();
  }
  await Promise.all(Array.from({ length: Math.min(workers, seeds.length) }, worker));
  await browser.close(); srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  results.sort((a, b) => a.seed - b.seed);
  if (outDir) fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ half, dt, matches: results }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
