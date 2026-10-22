// Headless checks for EXP-2 (one match source). Usage: node tests/cross-view.cjs <appDir> <outDir>
// Watch is the only engine: Broadcast follows its frames and events, the Analyst pill shows its score, minute and last five events.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [dir, out] = [process.argv[2], process.argv[3]];
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (name, ok, extra) => { results.push([name, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' · ' + extra : '')); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const serve = () => new Promise((res) => { const s = http.createServer((q, r) => { const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0, () => res(s)); });
(async () => {
  const web = await serve(), base = 'http://127.0.0.1:' + web.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '/index.html#watch', { waitUntil: 'domcontentloaded' });
  const tab = (v) => p.evaluate((x) => document.getElementById('tab-' + x).click(), v);
  const frameOf = async (re, ready) => { for (let i = 0; i < 480; i++) { const f = p.frame({ url: re }); if (f && await f.evaluate(ready).catch(() => false)) return f; await sleep(500); } return null; };
  const w = await frameOf(/watch\/index\.html/, () => !!(window.__mc && window.__mc.S.started));
  check('Watch kicked off', !!w);
  await p.waitForFunction(() => AG.run && AG.run.events.length > 0, null, { timeout: 300000 }).catch(() => {});   // let Watch play until the shell has seen an event
  check('the shell saw events from Watch', await p.evaluate(() => AG.run && AG.run.events.length > 0));
  await w.evaluate(() => { window.__mc.S.paused = true; });
  await sleep(1500);
  const ws = await w.evaluate(() => ({ score: window.__mc.S.score.slice(), mclock: window.__mc.S.mclock, last: window.__mc.ENV.events.slice(-5).map((e) => e.type) }));
  // Watch -> Broadcast with Watch paused
  await tab('broadcast');
  const bc = await frameOf(/broadcast\/index\.html/, () => !!(window.__mc && window.__mc.S.started && window.__mc.S.paused));
  check('Broadcast opens paused when Watch is paused', !!bc);
  await sleep(2000);
  const bs = bc && await bc.evaluate(() => ({ paused: window.__mc.S.paused, score: window.__mc.S.score.slice(), mclock: window.__mc.S.mclock, last: window.__mc.ENV.events.slice(-5).map((e) => e.type), wait: !document.getElementById('mc-wait').hidden }));
  check('Broadcast is paused at the same minute', bs && bs.paused && Math.abs(bs.mclock - ws.mclock) < 1, JSON.stringify([bs && bs.mclock, ws.mclock]));
  check('Broadcast shows the same score', bs && JSON.stringify(bs.score) === JSON.stringify(ws.score), JSON.stringify([bs && bs.score, ws.score]));
  check('Broadcast no longer waits for Watch', bs && !bs.wait);
  check('Broadcast has replayed Watch\'s events', bs && bs.last.length > 0, JSON.stringify(bs && bs.last));
  // Analyst: the live pill carries the same score, minute and last five events
  await tab('analyst');
  const an = await frameOf(/analyst\/index\.html/, () => !!document.getElementById('mc-live'));
  await sleep(1500);
  const as = an && await an.evaluate(() => { const el = document.getElementById('mc-live'); return { text: el.textContent, last: JSON.parse(el.dataset.last || '[]') }; });
  check('Analyst pill shows the same score', as && as.text.includes(ws.score.join('–')), as && as.text);
  check('Analyst pill lists the last five events', as && as.last.length > 0 && as.last.length <= 5, JSON.stringify(as && as.last.map((x) => x.type)));
  // resume Watch: Broadcast follows
  await tab('watch'); await sleep(500);
  await w.evaluate(() => { window.__mc.S.paused = false; });
  await sleep(6000);
  await tab('broadcast'); await sleep(2500);
  const w2 = await w.evaluate(() => ({ mclock: window.__mc.S.mclock, score: window.__mc.S.score.slice() }));
  const b2 = await bc.evaluate(() => ({ paused: window.__mc.S.paused, mclock: window.__mc.S.mclock, score: window.__mc.S.score.slice() }));
  check('Broadcast follows Watch once it resumes', !b2.paused && b2.mclock >= ws.mclock && Math.abs(b2.mclock - w2.mclock) < 5, JSON.stringify([b2.mclock, w2.mclock]));
  check('scores still match', JSON.stringify(b2.score) === JSON.stringify(w2.score));
  check('no page errors', errs.length === 0, errs.slice(0, 3).join('|'));
  const fails = results.filter((x) => !x[1]).length;
  console.log(fails ? fails + ' check(s) failed' : 'all checks passed'); await b.close(); web.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });
