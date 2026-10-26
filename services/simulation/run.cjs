// Headless MatchCast runner. Builds the unified app, serves it on localhost and drives the Watch engine in
// Chromium with stepSim() on a fixed 0.02 s step (no rendering), so one seed always gives the same events.
//   node run.cjs --seeds 1-40 --half 45 --workers 4 --out out/ [--events] [--dt 0.02]
//   node run.cjs --seeds 2026 --url   prints the Watch URL query that plays the runner's match for each seed in the live app
//   node run.cjs --seeds 1-20 --season M001 --move 3:60:8:0 --track 1 --out DIR   paired what-if (moves player 3 eight metres forward)
//   node run.cjs --seeds 1-20 --whatif 1:60:3-4-3 --track 1 --out DIR   paired what-if: each seed plays the same match twice,
//     once as it is and once with team 1 (0 = home, 1 = away) switching to 3-4-3 at minute 60; writes DIR/whatif.json
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
// the half length played: --half, else the fixture's own (Watch plays that for a season fixture), else 45
const seasonFixture = args.season ? JSON.parse(fs.readFileSync(path.join(REPO, 'apps/unified/shared/fixtures.json'), 'utf8')).find((x) => x.id === String(args.season)) : null;
const half = +(args.half || (seasonFixture ? seasonFixture.setup.half : 45)), tune = args.tune ? String(args.tune) : '', dt = +(args.dt || 0.02), workers = +(args.workers || 2);
const seeds = [];
for (const part of String(args.seeds || '1-3').split(',')) {
  const [a, b] = part.split('-').map(Number);
  for (let s = a; s <= (b || a); s++) seeds.push(s);
}
const outDir = args.out ? path.resolve(String(args.out)) : null;
// --whatif ti:minute:form (ti 0 = home, 1 = away); --track seed keeps 1 Hz positions for that seed around the change
// --move pi:minute:dx:dy moves one player (index in the 22, 0-10 home) by dx metres forward and dy sideways from his own slot
const whatif = args.move ? (([pi, minute, dx, dy]) => ({ kind: 'move', pi: +pi, minute: +minute, dx: +dx, dy: +dy }))(String(args.move).split(':'))
  : args.whatif ? (([ti, minute, form]) => ({ kind: 'form', ti: +ti, minute: +minute, form }))(String(args.whatif).split(':')) : null;
const trackSeed = args.track ? +args.track : null;
if (trackSeed != null && !seeds.includes(trackSeed)) throw new Error('--track ' + trackSeed + ' is not one of the --seeds run');   // fail before the runs, not after them
// --season N001: play a fixture from shared/fixtures.json (teams, stadium, month, kick-off, half length, formations); the seeds then vary the match
const season = args.season ? String(args.season) : null;

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

// runs inside the page: one whole match, then the per-match numbers the realism check needs.
// whatif = { ti, minute, form } switches one team's formation at that match minute; the seed plays the same first part
// in both arms, so the two arms differ only after the change. track keeps 1 Hz positions from 30 s before to 3 min after it.
function playMatch([seed, half, dt, whatif, track]) {   // the page has already kicked off from the query string
  const mc = window.__mc;
  const t0 = performance.now(); let n = 0;
  const at = whatif ? whatif.minute * 60 : null, pos = [], snap = {};
  let nextPos = track && at != null ? at - 30 : Infinity;
  while (!mc.S.over && n < 2000000) {
    if (at != null && !snap.done && mc.S.mclock >= at) {
      if (whatif.apply) (whatif.kind === 'move' ? mc.movePlayer(whatif.pi, whatif.dx, whatif.dy) : mc.setFormation(whatif.ti, whatif.form));
      snap.done = true; snap.score = mc.S.score.slice(); snap.shots = mc.STATS.shots.slice(); snap.xg = mc.STATS.xg.slice();
    }
    if (mc.S.mclock >= nextPos && mc.S.mclock <= at + 180) {
      pos.push({ t: +mc.S.mclock.toFixed(1), p: mc.players.map((q) => [+q.pos2.x.toFixed(2), +q.pos2.y.toFixed(2)]), b: [+mc.ball.p.x.toFixed(2), +mc.ball.p.z.toFixed(2)] });
      nextPos += 1;
    }
    mc.stepSim(dt); n++;
  }
  // a match that ends before the change minute: the totals at the end stand in for the change point
  if (at != null && !snap.done) { snap.done = true; snap.score = mc.S.score.slice(); snap.shots = mc.STATS.shots.slice(); snap.xg = mc.STATS.xg.slice(); }
  const ev = mc.ENV.events, c = {};
  for (const e of ev) c[e.type] = (c[e.type] || 0) + 1;
  const goals = ev.filter((e) => e.type === 'goal'), pens = ev.filter((e) => e.type === 'shot' && e.kind === 'penalty' && e.fate === 'goal');
  // numbers after the change: the engine's totals now minus the totals at the change
  const after = at == null ? null : {
    score: [0, 1].map((i) => mc.S.score[i] - snap.score[i]),
    shots: [0, 1].map((i) => mc.STATS.shots[i] - snap.shots[i]),
    xg: [0, 1].map((i) => +(mc.STATS.xg[i] - snap.xg[i]).toFixed(3)),
  };
  return {
    seed, half, dt, steps: n, over: mc.S.over, wallMs: Math.round(performance.now() - t0),
    score: mc.S.score.slice(), shots: mc.STATS.shots.slice(), passes: mc.STATS.passes.slice(), xg: mc.STATS.xg.map((x) => +x.toFixed(3)),
    director: { longest: mc.DIRC.longest, bySc: mc.DIRC.bySc, liveS: +mc.DIRC.liveS.toFixed(1), ffS: +mc.DIRC.ffS.toFixed(1), cuts: mc.DIRC.ranges.length, watchMin: +((mc.DIRC.liveS + mc.DIRC.ffS / mc.DIRC.ffX) / 60).toFixed(2) },
    counts: c, goalMinutes: goals.map((g) => g.minute), penaltyGoals: pens.length, events: ev,
    after, track: pos.length ? pos : null, names: mc.players.map((q) => q.name),
  };
}

// same hashing as the engine's sub-streams (world.js hash32 + mulberry), so a seed always picks the same fixture
const hash32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
let CLUBS = null;
// the fixture's own setup, as the Watch query the engine takes (the same fields the Watch hook reads)
function seasonQuery(seed) {
  const f = JSON.parse(fs.readFileSync(path.join(REPO, 'apps/unified/shared/fixtures.json'), 'utf8')).find((x) => x.id === season);
  if (!f) throw new Error('no fixture ' + season);
  const q = { seed, half: args.half ? +args.half : f.setup.half, st: f.stIndex, month: f.setup.month, kick: f.setup.kickoff, h: f.home.key, a: f.away.key, f0: f.formations[0], s0: f.styles[0], f1: f.formations[1], s1: f.styles[1] };
  return new URLSearchParams(q).toString();
}
// each seed plays two different season clubs (their squads and ratings) at a stadium and month drawn from the seed
function setupFor(seed) {
  const R = mulberry(hash32(seed + ':fixture')), n = CLUBS.length;
  const h = Math.floor(R() * n); let a = Math.floor(R() * (n - 1)); if (a >= h) a++;
  const q = { seed, half, st: Math.floor(R() * 5), month: Math.floor(R() * 12), h: CLUBS[h].key, a: CLUBS[a].key }; if (tune) q.tune = tune; return new URLSearchParams(q).toString();
}

if (args.url) {   // the live app plays the same match as the runner only with the runner's fixture in the query
  CLUBS = JSON.parse(fs.readFileSync(path.join(REPO, 'apps/unified/shared/clubs.json'), 'utf8')).clubs;
  for (const seed of seeds) console.log(seed + '\t/watch/index.html?' + (season ? seasonQuery(seed) : setupFor(seed)));
  process.exit(0);
}

(async () => {
  const pw = loadPlaywright();
  const dir = buildApp(), srv = await serve(dir), base = 'http://127.0.0.1:' + srv.address().port;
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  CLUBS = JSON.parse(fs.readFileSync(path.join(dir, 'shared/clubs.json'), 'utf8')).clubs;
  const browser = await pw.chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  // a what-if run plays every seed twice: the untouched match (base) and the same seed with the change (what)
  const queue = seeds.flatMap((seed) => (whatif ? [{ seed, arm: 'base' }, { seed, arm: 'what' }] : [{ seed, arm: null }])), results = [];
  async function worker() {
    const page = await browser.newPage();
    await page.addInitScript(() => { window.__mcHeadless = true; });
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    while (queue.length) {
      const { seed, arm } = queue.shift();
      // a fresh page per match: the engine keeps module state (stats, stamina) that kickOff only partly resets
      await page.goto(base + '/watch/index.html?' + (season ? seasonQuery(seed) : setupFor(seed)), { waitUntil: 'domcontentloaded', timeout: 240000 });
      await page.waitForFunction(() => window.__mc && window.__mc.players.length && window.__mc.S.started, null, { timeout: 240000 });
      const cfg = whatif ? Object.assign({}, whatif, { apply: arm === 'what' }) : null;
      const r = await page.evaluate(playMatch, [seed, half, dt, cfg, trackSeed === seed]);
      r.arm = arm;
      if (outDir && args.events) fs.writeFileSync(path.join(outDir, seed + '.json'), JSON.stringify({ seed, half, events: r.events }));
      delete r.events;
      results.push(r);
      const { track, ...line } = r;   // the tracked positions go to whatif.json, not the log
      console.log(JSON.stringify(line));
    }
    await page.close();
  }
  await Promise.all(Array.from({ length: Math.min(workers, seeds.length) }, worker));
  await browser.close(); srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  results.sort((a, b) => a.seed - b.seed);
  if (whatif) {
    // pair the two arms of each seed; keep the tracked positions of the tracked seed only
    const pairs = [], track = {};
    for (const seed of seeds) {
      const base = results.find((r) => r.seed === seed && r.arm === 'base'), what = results.find((r) => r.seed === seed && r.arm === 'what');
      if (!base || !what) continue;
      if (base.track) track.base = base.track;
      if (what.track) track.what = what.track;
      pairs.push({ seed, base: { score: base.after.score, shots: base.after.shots, xg: base.after.xg, final: base.score }, what: { score: what.after.score, shots: what.after.shots, xg: what.after.xg, final: what.score } });
    }
    if (trackSeed != null) Object.assign(track, { names: results.find((r) => r.seed === trackSeed && r.arm === 'base').names, seed: trackSeed, from: whatif.minute * 60 - 30, to: whatif.minute * 60 + 180, every: 1 });
    const fixture = Object.fromEntries(new URLSearchParams(season ? seasonQuery(seeds[0]) : setupFor(seeds[0])));
    if (outDir) fs.writeFileSync(path.join(outDir, 'whatif.json'), JSON.stringify({ half, dt, season, change: whatif, fixture, pairs, track: trackSeed != null ? track : null }, null, 1));
    console.log('pairs', pairs.length);
  } else if (outDir) fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ half, dt, matches: results.map((r) => { delete r.track; return r; }) }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
