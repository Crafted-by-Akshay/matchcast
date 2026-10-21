// Cold-cache load timing for each view. Usage: node tests/timing.cjs <baseUrl>
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const base = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const t0 = Date.now(); const T = (l) => console.log(String(Date.now() - t0).padStart(7) + ' ms  ' + l);
  const bytes = {}; cdp.on('Network.loadingFinished', (e) => { bytes[e.requestId] = e.encodedDataLength; });
  p.on('response', (r) => {});
  await p.goto(base + '/index.html#watch', { waitUntil: 'domcontentloaded' }); T('shell DOM ready');
  await p.waitForFunction(() => document.querySelectorAll('#fx option').length > 20, null, { timeout: 60000 }); T('season fixtures in picker');
  const wait = async (fn, label, to = 600000) => { const s = Date.now(); const h = await p.waitForFunction(fn, null, { timeout: to, polling: 250 }).catch(() => null); T(label + (h ? '' : ' (timeout)')); return h; };
  await wait(() => document.querySelector('#v-watch iframe'), 'watch iframe created');
  let f = null; for (let i = 0; i < 300 && !f; i++) { await sleep(200); f = p.frames().find((x) => /watch\/index\.html/.test(x.url())); }
  // poll inside the Watch frame: when the engine has players, when the loader hides, when the match starts
  let seen = { players: null, load: null, start: null };
  for (let i = 0; i < 6000 && !seen.start; i++) {
    const s = await f.evaluate(() => ({ n: window.__mc ? window.__mc.players.length : 0, loaded: document.getElementById('load') ? document.getElementById('load').hidden : null, started: window.__mc ? window.__mc.S.started : false })).catch(() => null);
    if (s) { if (s.n && !seen.players) { seen.players = Date.now(); T('watch: players built (' + s.n + ')'); }
      if (s.loaded && !seen.load) { seen.load = Date.now(); T('watch: loader hidden'); }
      if (s.started && !seen.start) { seen.start = Date.now(); T('watch: match started'); } }
    await sleep(150);
  }
  const res = await f.evaluate(() => performance.getEntriesByType('resource').map((r) => [r.name.split('/').pop().split('?')[0], Math.round(r.duration), Math.round(r.transferSize || 0)]));
  console.log('watch resources:', JSON.stringify(res.filter((r) => r[1] > 150)));
  await p.click('#tab-analyst'); const ta = Date.now(); T('switched to analyst');
  await wait(() => document.getElementById('v-analyst').classList.contains('ready'), 'analyst ready (28 season files loaded)');
  await p.click('#tab-broadcast'); T('switched to broadcast');
  await wait(() => document.getElementById('v-broadcast').classList.contains('ready'), 'broadcast match started');
  console.log('done');
  await b.close();
})().catch((e) => { console.error('crashed', e.message); process.exit(1); });
