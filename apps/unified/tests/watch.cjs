// Headless checks for EXP-3 (Match Pulse cards) and EXP-4 (watch modes). Usage: node tests/watch.cjs <appDir> <outDir>
// <appDir> is a local copy from `python3 build.py <appDir>`. Cards are posted to Watch the way the shell does; the 3D match runs in software rendering, so only DOM is checked.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const [dir, out] = [process.argv[2], process.argv[3]];
fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (name, ok, extra) => { results.push([name, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' · ' + extra : '')); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const serve = () => new Promise((res) => { const s = http.createServer((q, r) => { const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); }).listen(0, () => res(s)); });
const goal = (id, extra) => Object.assign({ id, minute: 12.4, kind: 'score', text: 'Goal for Arsenal (A One) at 12\'. Arsenal 1–0 Chelsea.', plain: 'Goal for Arsenal!', verdict: 'verified', source: 'model', player: null, chips: ['Score 1–0', "12'"], evidence: [{ minute: 12.4, type: 'goal', player: 'A One', team: 'ars', xg: null }] }, extra || {});
(async () => {
  const web = await serve(), base = 'http://127.0.0.1:' + web.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const open = async () => {
    await p.goto(base + '/index.html#watch', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => document.querySelectorAll('#fx option').length > 20, null, { timeout: 30000 });
    let f = null; for (let i = 0; i < 240 && !f; i++) { await sleep(500); const c = p.frame({ url: /watch\/index\.html/ }); if (c && await c.evaluate(() => !!(window.__mc && window.__mc.players.length && window.__mcxCards && document.getElementById('load').hidden)).catch(() => false)) f = c; }
    return f;
  };
  const post = (card) => p.evaluate((c) => post('watch', { src: 'matchcast-shell', type: 'pulse', card: c }), card);
  let f = await open();
  check('Watch frame is ready', !!f);
  const pick = async (m) => { if (await f.evaluate(() => document.getElementById('fan-pop').hidden)) await f.click('#fan-chip');
    await f.click('.fm-b[data-m="' + m + '"]'); await sleep(200); };
  // ---- EXP-3
  await pick('analyst');
  await post(goal('c1'));
  await sleep(500);
  const t = await f.evaluate(() => { const c = document.querySelector('#mcx-live .mcx-c'); return c && { text: c.querySelector('p').textContent, tick: c.querySelector('.mcx-t').textContent, chips: c.querySelectorAll('.mcx-ch:not(.fb)').length, fb: !!c.querySelector('.mcx-ch.fb') }; });
  check('card with a green tick shows within 1 s', t && /Verified/.test(t.tick), JSON.stringify(t));
  check('Analyst shows at least two metric chips', t && t.chips >= 2, String(t && t.chips));
  check('a model claim has no Rules fallback chip', t && !t.fb);
  await post(goal('c2', { source: 'rules', verdict: 'pending' }));
  await sleep(300);
  const r = await f.evaluate(() => { const c = document.querySelector('#mcx-live .mcx-c'); return { fb: !!c.querySelector('.mcx-ch.fb'), wait: !!c.querySelector('.mcx-t.wait') }; });
  check('a rules-fallback card carries the Rules fallback chip', r.fb);
  check('an unverified card shows the amber dot', r.wait);
  await f.evaluate(() => document.querySelector('#mcx-live .mcx-c [data-why]').click());
  check('Why? shows the cited events', await f.evaluate(() => /goal/.test(document.querySelector('#mcx-live .mcx-w').textContent) && !document.querySelector('#mcx-live .mcx-w').hidden));
  for (let i = 0; i < 12; i++) await post(goal('k' + i));
  await sleep(300);
  check('the last 10 stay in the scrollable list', await f.evaluate(() => document.querySelectorAll('#mcx-log .mcx-c').length) === 10);
  await f.evaluate(() => { for (const el of document.querySelectorAll('#mcx-live .mcx-c')) { el.classList.add('out'); } });
  // ---- EXP-4
  await pick('casual');
  await post(goal('c3'));
  await sleep(300);
  const ca = await f.evaluate(() => { const c = document.querySelector('#mcx-live .mcx-c'); return { text: c.querySelector('p').textContent, chips: c.querySelectorAll('.mcx-ch:not(.fb)').length }; });
  check('Casual and Analyst explain the same goal differently', ca.text !== t.text, ca.text + ' / ' + t.text);
  check('Casual shows no metric chips', ca.chips === 0, String(ca.chips));
  await pick('player');
  const who = await f.evaluate(() => { const n = window.__mc.players.map((q) => q.name).find((n) => document.getElementById('fan-pcard').textContent.includes(n)); return n || null; });
  if (who) { await post(goal('c4', { player: who })); await sleep(300); check('Player focus leads the line with the player', await f.evaluate((n) => document.querySelector('#mcx-live .mcx-c p').textContent.startsWith(n + ':'), who), who); }
  else check('Player focus names a player in the mode chip', false, await f.evaluate(() => document.getElementById('fan-chip').textContent));
  await pick('club');
  const saved = await f.evaluate(() => JSON.parse(localStorage.getItem('mcx-mode')).mode);
  check('the mode is saved', saved === 'club', saved);
  f = await open();
  const chip = f && await f.evaluate(() => document.getElementById('fan-chip').textContent);
  check('after a reload the last mode is restored', chip && /My club/.test(chip), chip);
  if (await f.evaluate(() => document.getElementById('fan-pop').hidden)) await f.click('#fan-chip');
  check('languages beyond English, Spanish and Hindi are labelled Planned', await f.evaluate(() => [...document.querySelectorAll('.fm-l')].map((l) => [l.dataset.l, !!l.querySelector('.fm-planned')]).every(([k, pl]) => (['en', 'es', 'hi'].includes(k)) !== pl)));
  await p.screenshot({ path: out + '/watch-pulse.png' });
  check('no page errors', errs.length === 0, errs.slice(0, 3).join('|'));
  const fails = results.filter((x) => !x[1]).length;
  console.log(fails ? fails + ' check(s) failed' : 'all checks passed'); await b.close(); web.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });
