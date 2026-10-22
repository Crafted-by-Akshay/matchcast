// Checks that Watch starts without fetching the Analyst's season files. Usage: node tests/lazy.cjs <baseUrl>
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const base = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const seen = { analyst: 0, broadcast: 0 };
  p.on('request', (r) => { if (/analyst\//.test(r.url())) seen.analyst++; if (/broadcast\//.test(r.url())) seen.broadcast++; });
  await p.goto(base + '/index.html#watch', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelectorAll('#fx option').length > 20, null, { timeout: 60000 });
  let f = null; for (let i = 0; i < 300 && !f; i++) { await sleep(200); f = p.frames().find((x) => /watch\/index\.html/.test(x.url())); }
  await p.waitForFunction(() => document.getElementById('v-watch').classList.contains('ready'), null, { timeout: 300000 });
  await sleep(4000);
  console.log('requests to analyst/ while Watch runs:', seen.analyst, '(expect 0 for the Analyst data)');
  console.log('requests to broadcast/ while Watch runs:', seen.broadcast, '(expect 0 until the desk is opened, except idle prefetch)');
  const loading = await p.$eval('#v-watch .wt', (e) => e.textContent).catch(() => 'n/a');
  console.log('loader text at start:', loading);
  await b.close();
  console.log('done');
})().catch((e) => { console.error('crashed', e.message); process.exit(1); });
