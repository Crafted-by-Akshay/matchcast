// Headless checks for EXP-1 (live agent api connection). Usage: node tests/connection.cjs <appDir> <outDir>
// <appDir> is a local copy from `python3 build.py <appDir>` with three.js in <appDir>/node_modules. The test serves it and starts a mock api.
// Cases: live (mock api answers: pill 'Live agents', events reach it, claim in the Agents tab), fallback (api answers errors: 'Rules fallback'
// after the warm-up, rules lines keep coming), offline (no api: 'Offline (simulated)').
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [dir, out] = [process.argv[2], process.argv[3]];
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (name, ok, extra) => { results.push([name, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' · ' + extra : '')); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const serve = () => new Promise((res) => { const s = http.createServer((q, r) => { const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0, () => res(s)); });
// mock api: records what it receives; mode 'ok' streams a status, a claim and a publication; mode 'error' answers 503
const mock = (mode) => new Promise((res) => {
  const seen = { matches: 0, events: [] };
  const s = http.createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    if (mode === 'error') { r.writeHead(503, cors); return r.end('{}'); }
    if (q.method === 'POST') { let b = ''; q.on('data', (c) => (b += c)); q.on('end', () => { const j = JSON.parse(b || '{}'); if (/\/events/.test(q.url)) seen.events.push(...j.events); else seen.matches++; r.writeHead(/\/events/.test(q.url) ? 202 : 201, Object.assign({ 'Content-Type': 'application/json' }, cors)); r.end('{}'); }); return; }
    r.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, cors));
    const frame = (ev, d, id) => r.write('event: ' + ev + '\n' + (id ? 'id: ' + id + '\n' : '') + 'data: ' + JSON.stringify(d) + '\n\n');
    frame('status', { status: 'live' });
    const t = setInterval(() => {
      if (!seen.events.length || seen.sent) return; seen.sent = true;
      frame('claim', { claim_id: 'api-1', metric: 'goals', value: 1, units: 'count', approval_status: 'approved' }, 'claim:api-1');
      frame('publication', { publication_id: 'pub-1', claim_ids: ['api-1'], text: 'Goal from the api.' }, 'pub:pub-1');
    }, 200);
    q.on('close', () => clearInterval(t));
  }).listen(0, () => res({ s, seen }));
});
const run = async (b, base, api, label, wait) => {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((a) => { window.__API = a; }, api);
  await p.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';window.MATCHCAST_WARM_MS=6000;' }));
  await p.goto(base + '/index.html#agents', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30000 });
  // drive the shell the way Watch does (its start and one batch of events); the 3D engine is too slow in headless software rendering
  await p.evaluate(() => {
    const key = 'k1', names = { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' };
    const roster = { teams: ['ars', 'che'], players: [{ name: 'A One', team: 'ars' }, { name: 'C One', team: 'che' }] };
    AG.reset(key, names); LV.begin(key, roster);
    const batch = [{ minute: 12.3, type: 'shot', team: 'ars', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'open play', data: {} }, { minute: 12.4, type: 'goal', team: 'ars', player: 'A One', score: '1-0' }];
    AG.onWatch(key, batch, []); LV.events(batch);
  });
  await sleep(wait);
  const pill = await p.$eval('#api-pill', (e) => e.textContent);
  return { p, pill, errs };
};
(async () => {
  const web = await serve(), base = 'http://127.0.0.1:' + web.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  // live
  const ok = await mock('ok'), okBase = 'http://127.0.0.1:' + ok.s.address().port;
  let r = await run(b, base, okBase, 'live', 6000);
  check('live: pill shows Live agents', r.pill === 'Live agents', r.pill);
  check('live: the api created the match and got contract events', ok.seen.matches >= 1 && ok.seen.events.length > 0 && ok.seen.events.every((e) => e.kind === 'event' && ['goal', 'shot'].includes(e.payload.type)), ok.seen.matches + ' match, ' + ok.seen.events.length + ' events');
  check('live: the api claim shows in the Agents tab with its text', await r.p.evaluate(() => AG.run.claims.some((c) => c.id === 'api-1' && c.source === 'model' && c.text === 'Goal from the api.')));
  await r.p.screenshot({ path: out + '/conn-live.png' }); check('live: no page errors', r.errs.length === 0, r.errs.join('|')); await r.p.close(); ok.s.close();
  // fallback
  const bad = await mock('error'), badBase = 'http://127.0.0.1:' + bad.s.address().port;
  r = await run(b, base, badBase, 'fallback', 9000);
  check('fallback: pill shows Rules fallback after the warm-up', r.pill === 'Rules fallback', r.pill);
  check('fallback: the rules agents keep producing lines', await r.p.evaluate(() => AG.run.claims.filter((c) => c.source === 'rules').length > 0));
  await r.p.screenshot({ path: out + '/conn-fallback.png' }); check('fallback: no page errors', r.errs.length === 0, r.errs.join('|')); await r.p.close(); bad.s.close();
  // offline
  r = await run(b, base, '', 'offline', 500);
  check('offline: pill shows Offline (simulated)', r.pill === 'Offline (simulated)', r.pill);
  check('offline: no api call is made', await r.p.evaluate(() => !LV.enabled));
  await r.p.screenshot({ path: out + '/conn-offline.png' }); check('offline: no page errors', r.errs.length === 0, r.errs.join('|')); await r.p.close();
  const fails = results.filter((x) => !x[1]).length;
  console.log(fails ? fails + ' check(s) failed' : 'all checks passed'); await b.close(); web.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });
