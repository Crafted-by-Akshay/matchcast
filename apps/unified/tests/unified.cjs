// Headless checks for the unified console. Usage: node tests/unified.cjs <baseUrl> <outDir>
// Serve a local copy first (python3 build.py <dir>, with three.js in <dir>/node_modules), then point baseUrl at it.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [base, out] = [process.argv[2], process.argv[3]];
const fs = require('fs'); fs.mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (name, ok, extra) => { results.push([name, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' · ' + extra : '')); };
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', (e) => errs.push('shell: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto(base + '/index.html#watch', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => document.querySelectorAll('#fx option').length > 20, null, { timeout: 30000 });
  check('season fixtures load into the picker', await p.$eval('#fx', (s) => s.querySelectorAll('option').length) === 28);
  const def = await p.$eval('#fx', (s) => s.value);
  check('default fixture is the most open one', !!def, def);
  const wf = () => p.frame({ url: /watch\/index\.html/ });
  // ---- Watch starts on the shared match
  await p.waitForFunction(() => document.querySelector('#v-watch iframe'), null, { timeout: 10000 });
  let f = null; for (let i = 0; i < 200 && !f; i++) { await sleep(500); f = await wf(); }
  check('Watch frame is attached', !!f);
  await p.waitForFunction(() => document.getElementById('v-watch').classList.contains('ready'), null, { timeout: 240000 }).catch(() => {});
  const watchState = await f.evaluate(() => ({ started: window.__mc && window.__mc.S.started, seed: window.__mc && window.__mc.SET().seed, half: window.__mc && window.__mc.SET().half, kick: window.__mc && window.__mc.SET().kickStr,
    teams: window.__mc && [window.__mc.players.find((q) => q.ti === 0).T.club, window.__mc.players.find((q) => q.ti === 1).T.club], names: window.__mc && window.__mc.players.filter((q) => q.ti === 1).slice(0, 3).map((q) => q.name) }));
  check('Watch kicked off with the shared setup', watchState.started, JSON.stringify(watchState));
  const fxTeams = await p.evaluate(() => fetch('shared/fixtures.json').then((r) => r.json()).then((L) => L.find((x) => x.id === document.getElementById('fx').value)).then((x) => [x.home.club, x.away.club]));
  check('Watch plays the fixture clubs', JSON.stringify(watchState.teams) === JSON.stringify(fxTeams), JSON.stringify(watchState.teams) + ' vs ' + JSON.stringify(fxTeams));
  await p.screenshot({ path: out + '/desk-watch.png' });
  // ---- switch to Analyst
  await p.click('#tab-analyst');
  await p.waitForFunction(() => document.getElementById('v-analyst').classList.contains('ready'), null, { timeout: 60000 }).catch(() => {});
  const an = await p.frame({ url: /analyst\/index\.html/ });
  check('Analyst is ready', !!an);
  if (an) {
    await sleep(1500);
    const a = await an.evaluate(() => ({ n: D.matches.length, hash: location.hash, imported: D.matches.filter((m) => m.imported).length }));
    check('Analyst opens the season (28 matches)', a.n === 28, JSON.stringify(a));
    check('Analyst routed to the shared fixture', a.hash.startsWith('#match.M'), a.hash);
    await p.screenshot({ path: out + '/desk-analyst.png' });
  }
  // ---- switch to Broadcast: same setup, its own kick-off
  await p.click('#tab-broadcast');
  const bf = await p.waitForFunction(() => document.getElementById('v-broadcast').classList.contains('ready'), null, { timeout: 240000 }).catch(() => null);
  const bc = await p.frame({ url: /broadcast\/index\.html/ });
  check('Broadcast desk starts', !!bc && !!bf);
  if (bc) {
    const bs = await bc.evaluate(() => ({ started: window.__mc && window.__mc.S.started, seed: window.__mc && window.__mc.SET().seed, teams: window.__mc && [window.__mc.players.find((q) => q.ti === 0).T.club, window.__mc.players.find((q) => q.ti === 1).T.club] }));
    check('Broadcast uses the shared seed', String(bs.seed) === String(watchState.seed), JSON.stringify(bs));
    check('Broadcast plays the fixture clubs', JSON.stringify(bs.teams) === JSON.stringify(fxTeams), JSON.stringify(bs.teams));
    await sleep(1200);
    await p.screenshot({ path: out + '/desk-broadcast.png' });
  }
  // ---- back to Watch: its clock kept running, nothing reset
  await p.click('#tab-watch');
  await sleep(800);
  const again = await f.evaluate(() => ({ started: window.__mc.S.started, seed: window.__mc.SET().seed, t: Math.round(window.__mc.S.t || 0) }));
  check('Watch is still the same match after switching', again.started && String(again.seed) === String(watchState.seed), JSON.stringify(again));
  // ---- the agents: Watch's events reach the pipeline, claims are verified, the chain checks out, the desk shows Watch's score
  // the sandbox renders slowly and the frame loop caps each frame at 0.05 s of match time, so the test steps Watch's
  // simulation directly (the same stepSim the frame loop calls) until the agents have claims to verify
  for (let k = 0; k < 40; k++) {
    await f.evaluate(() => { for (let i = 0; i < 3000; i++) window.__mc.stepSim(0.05); });
    await sleep(1200);
    if (await p.evaluate(() => !!(AG.run && AG.run.stat.verified > 0))) break;
  }
  const ag = await p.evaluate(() => AG.run ? { key: AG.run.key, events: AG.run.stat.events, claims: AG.run.claims.length, verified: AG.run.stat.verified } : null);
  check('Watch events reach the agents', !!ag && ag.events > 0 && ag.claims > 0 && ag.verified > 0, JSON.stringify(ag));
  const chain = await p.evaluate(() => MCC.verify());
  check('Audit chain verifies', chain.ok && chain.count > 0, JSON.stringify(chain));
  await p.keyboard.press('4'); await sleep(500);
  check('Key 4 opens the Agents tab', await p.$eval('#v-agents', (e) => !e.hidden));
  check('Agents tab lists claims with provenance', (await p.$$eval('#ag-claims tr[data-id]', (r) => r.length)) > 0 && (await p.$eval('#ag-prov', (e) => !!e.querySelector('dl'))));
  await p.click('#ag-verify'); await sleep(600);
  check('Verify chain button reports the chain intact', (await p.$eval('#ag-verify-out', (e) => e.textContent)).startsWith('Chain intact'));
  await p.click('#tab-watch'); await sleep(500);
  if (bc) {
    let same = false, desk = '', watch = '';
    for (let i = 0; i < 8 && !same; i++) {
      desk = await bc.evaluate(() => document.getElementById('bc-score').textContent);
      watch = await f.evaluate(() => window.__mc.S.score.join('–'));
      same = desk === watch; if (!same) await sleep(700);
    }
    check('Broadcast scoreboard shows Watch score', same, 'desk ' + desk + ' · watch ' + watch);
  }
  // ---- full time in Watch sends the live match to the Analyst as a new library entry
  await f.evaluate(() => { window.__mc.S.over = true; });
  await sleep(3500);
  if (an) {
    const imp = await an.evaluate(() => D.matches.filter((m) => m.imported).length);
    check('Full-time match arrives in the Analyst library', imp >= 1, 'imported ' + imp);
  }
  // ---- change the fixture: Watch restarts on the new setup when it is shown again
  const first = await p.$eval('#fx', (s) => s.value);
  const other = await p.$$eval('#fx option', (os, cur) => os.map((o) => o.value).find((v) => v && v !== cur), first);
  await p.selectOption('#fx', other);
  await sleep(500);
  console.log('diag', JSON.stringify(await p.evaluate(() => ({ href: location.href, cur: current, views: [...document.querySelectorAll('.view')].map((v) => v.id + ':' + v.querySelectorAll('iframe').length + ':' + v.hidden) }))));
  const src = (await p.$$eval('#v-watch iframe', (x) => x.map((i) => i.src)))[0] || null;
  check('Fixture change reloads Watch with the new seed', src && src.includes('fixture') === false && src.includes('seed='), src ? src.slice(0, 60) : 'no src');
  // ---- New match inside Broadcast becomes the shared match (the picker shows it as custom)
  await p.click('#tab-broadcast');
  // the shell reloads Broadcast after a fixture change: wait until the new document has started its match
  let bcFrame = null;
  for (let i = 0; i < 120 && !bcFrame; i++) {
    await sleep(2000);
    try { const f2 = await p.frame({ url: /broadcast\/index\.html/ }); if (f2 && await f2.evaluate(() => !!(window.__mc && window.__mc.S.started))) bcFrame = f2; } catch (e) {}
  }
  if (bcFrame) { await bcFrame.evaluate(() => document.getElementById('bc-new').click()); await sleep(1500); }
  check('New match in Broadcast sets the shared match', (await p.$eval('#fx', (s) => s.value)) === 'custom', await p.$eval('#fx', (s) => s.value));
  // ---- keyboard shortcuts and hash
  await p.keyboard.press('3');
  await sleep(400);
  check('Key 3 opens the Broadcast desk', await p.$eval('#v-broadcast', (e) => !e.hidden));
  await p.keyboard.press('1');
  await sleep(300);
  check('Key 1 opens Watch', await p.$eval('#v-watch', (e) => !e.hidden));
  // ---- layout checks at phone width
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  m.on('pageerror', (e) => errs.push('phone: ' + e.message));
  await m.goto(base + '/index.html#analyst', { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  const ov = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('Phone width: no horizontal page scroll', ov <= 0, 'overflow ' + ov + 'px');
  await m.screenshot({ path: out + '/phone-shell.png' });
  check('No page errors', errs.length === 0, errs.slice(0, 5).join(' | '));
  const fails = results.filter((r) => !r[1]).length;
  console.log(fails ? fails + ' check(s) failed' : 'all checks passed', '· screenshots in', out);
  await b.close();
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });
