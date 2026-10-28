import { test, expect, type Page } from './fixtures';
import { createServer, type Server } from 'node:http';
import { collectErrors, openView } from './helpers';

// Ported from apps/unified/tests/connection.cjs (EXP-1). A mock api records what the shell sends.
// Cases: live (pill 'Live agents', contract events reach the api, its claim shows), fallback (api answers 503: 'Rules fallback'), offline (no api).
declare const AG: any; declare const LV: any;

type Mock = { server: Server; url: string; seen: { matches: number; events: any[]; sent?: boolean } };
const mock = (mode: 'ok' | 'error' | 'quiet' | 'rules' | 'drop') => new Promise<Mock>((resolve) => {
  const seen: Mock['seen'] = { matches: 0, events: [], sent: mode === 'quiet' || mode === 'drop' };   // 'quiet': the api says live but sends no claim; 'rules': it says rules_fallback, then sends a claim; 'drop': it says live once, then every stream fails
  let gets = 0;
  const server = createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    if (mode === 'error') { r.writeHead(503, cors); return r.end('{}'); }
    if (q.method === 'POST') {
      let b = ''; q.on('data', (c) => (b += c));
      q.on('end', () => { const j = JSON.parse(b || '{}'); const ev = /\/events/.test(q.url!); if (ev) seen.events.push(...j.events); else seen.matches++; r.writeHead(ev ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); });
      return;
    }
    if (!/\/stream/.test(q.url!)) { r.writeHead(404, cors); return r.end('{}'); }   // only the match stream is an SSE stream (the shell also asks /v1/status)
    if (mode === 'drop' && gets++) { r.writeHead(503, cors); return r.end('{}'); }
    r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
    const frame = (ev: string, d: object, id?: string) => r.write('event: ' + ev + '\n' + (id ? 'id: ' + id + '\n' : '') + 'data: ' + JSON.stringify(d) + '\n\n');
    frame('status', { status: mode === 'rules' ? 'rules_fallback' : 'live' });
    if (mode === 'drop') return void setTimeout(() => r.end(), 300);
    const t = setInterval(() => {
      if (!seen.events.length || seen.sent) return; seen.sent = true;
      frame('claim', { claim_id: 'api-1', metric: 'goals', value: 1, units: 'count', approval_status: 'approved' }, 'claim:api-1');
      frame('publication', { publication_id: 'pub-1', claim_ids: ['api-1'], text: 'Goal from the api.' }, 'pub:pub-1');
    }, 200);
    q.on('close', () => clearInterval(t));
  }).listen(0, () => resolve({ server, url: 'http://127.0.0.1:' + (server.address() as any).port, seen }));
});

async function drive(page: Page, api: string) {
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';window.MATCHCAST_WARM_MS=6000;' }));
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  // drive the shell the way Watch does (its start and one batch of events); the 3D engine is too slow in headless software rendering
  await page.evaluate(() => {
    const key = 'k1', names = { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' };
    const roster = { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }, { name: 'C One', team: 'cco' }] };
    AG.reset(key, names); LV.begin(key, roster);
    const batch = [{ minute: 12.3, type: 'shot', team: 'thr', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'open play', data: {} }, { minute: 12.4, type: 'goal', team: 'thr', player: 'A One', score: '1-0' }];
    AG.onWatch(key, batch, []); LV.events(batch);
  });
}
const pill = (page: Page) => page.locator('#api-pill');

test('live: pill, contract events and the api claim', async ({ page }) => {
  const api = await mock('ok'); const errs = collectErrors(page);
  await drive(page, api.url);
  await expect(pill(page)).toHaveText('Live agents', { timeout: 15_000 });
  await expect.poll(() => api.seen.matches >= 1 && api.seen.events.length > 0).toBe(true);
  expect(api.seen.events.every((e) => e.kind === 'event' && ['goal', 'shot'].includes(e.payload.type))).toBe(true);
  await expect.poll(() => page.evaluate(() => AG.run.claims.some((c: any) => c.id === 'pub-1' && c.api && c.verdict === 'verified' && c.source === 'model' && c.text === 'Goal from the api.'))).toBe(true);
  expect(errs).toEqual([]); api.server.close();
});

test('fallback: Rules fallback after the warm-up, rules lines keep coming', async ({ page }) => {
  const api = await mock('error'); const errs = collectErrors(page);
  await drive(page, api.url);
  await expect(pill(page)).toHaveText('Rules fallback', { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => AG.run.claims.filter((c: any) => c.source === 'rules').length > 0)).toBe(true);
  expect(errs).toEqual([]); api.server.close();
});

test('warming: never reads Offline, shows seconds of the warm-up, then Rules fallback', async ({ page }) => {
  const api = await mock('error'); const errs = collectErrors(page);
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api.url) + ';window.MATCHCAST_WARM_MS=6000;' }));
  await page.addInitScript(() => {
    (window as any).__pills = [];
    document.addEventListener('DOMContentLoaded', () => { const p = document.getElementById('api-pill')!; const rec = () => (window as any).__pills.push(p.textContent); rec(); new MutationObserver(rec).observe(p, { childList: true, characterData: true, subtree: true }); });
  });
  await page.goto('/index.html#analyst', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.waitForTimeout(2500);   // idle on the intro first: the counter must restart when the match begins
  await page.evaluate(() => { AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }); LV.begin('k1', { teams: ['thr', 'cco'], players: [] }); });
  await expect(pill(page)).toHaveText(/Warming up the match engine · [01] s of up to 6/, { timeout: 5_000 });
  await expect(pill(page)).toHaveText('Rules fallback', { timeout: 20_000 });
  const seen: string[] = await page.evaluate(() => (window as any).__pills);
  expect(seen.filter((t) => /Offline/.test(t || ''))).toEqual([]);
  expect(errs).toEqual([]); api.server.close();
});

test('warming on a browse page reads Starting…, then counts once the viewer is on another page', async ({ page }) => {
  const api = await mock('error'); const errs = collectErrors(page);
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api.url) + ';window.MATCHCAST_WARM_MS=6000;' }));
  await page.goto('/index.html#home', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => { AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }); LV.begin('k1', { teams: ['thr', 'cco'], players: [] }); });
  await expect(pill(page)).toHaveText('Starting…', { timeout: 5_000 });
  await page.evaluate(() => show('analyst'));
  await expect(pill(page)).toHaveText(/Warming up the match engine · [0-6] s of up to 6/, { timeout: 5_000 });
  await expect(pill(page)).toHaveText('Rules fallback', { timeout: 20_000 });
  expect(errs).toEqual([]); api.server.close();
});

test('offline: the redundant header badge is hidden and makes no api call', async ({ page }) => {
  const errs = collectErrors(page);
  await drive(page, '');
  await expect(pill(page)).toHaveText('Demo mode');
  await expect(pill(page)).toBeHidden();
  expect(await page.evaluate(() => !LV.enabled)).toBe(true);
  expect(errs).toEqual([]);
});

test('status dialog: offline says everything is simulated', async ({ page }) => {
  const errs = collectErrors(page);
  await drive(page, '');
  await page.locator('#more-toggle').click();
  await page.locator('#status-btn').click();
  await expect(page.locator('#status-dlg')).toBeVisible();
  await expect(page.locator('#status-box')).toContainText('No api is configured');
  expect(errs).toEqual([]);
});

test('status dialog: lists each dependency from /v1/status', async ({ page }) => {
  const errs = collectErrors(page);
  const doc = { mode: 'cloud', overall: 'simulated', counts: { live: 1, simulated: 1, planned: 1 }, dependencies: [
    { key: 'a', label: 'Planned thing', status: 'planned', detail: 'not built' },
    { key: 'b', label: 'Live thing', status: 'live', detail: 'configured' },
    { key: 'c', label: 'Sim thing', status: 'simulated', detail: 'in memory' }] };
  await page.route('**/v1/status', (rt) => rt.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(doc) }));
  await drive(page, 'http://127.0.0.1:9');
  await page.locator('#more-toggle').click();
  await page.locator('#status-btn').click();
  const items = page.locator('#status-box li');
  await expect(items).toHaveCount(3);
  await expect(items.first()).toContainText('Live thing');
  await expect(items.last()).toContainText('Planned thing');
  expect(errs.filter((e) => !/127\.0\.0\.1:9|ERR_|Failed to load resource/.test(e))).toEqual([]);
});

test('chips: the Foundry chip and the claim provenance say what /v1/status says', async ({ page }) => {
  const api = await mock('ok'); const errs = collectErrors(page);
  await page.route('**/v1/status', (rt) => rt.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ mode: 'live', overall: 'live', counts: { live: 1 }, dependencies: [{ key: 'foundry', label: 'Microsoft Foundry agents', status: 'live', detail: 'model deployment answers' }] }) }));
  await drive(page, api.url);
  await expect(page.locator('#ag-foundry')).toHaveText('Foundry: live', { timeout: 15_000 });
  await expect(page.locator('#ag-foundry')).not.toHaveClass(/warn/);
  expect(errs).toEqual([]); api.server.close();
});

test('chips: with no api the Foundry chip says not connected', async ({ page }) => {
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="";' }));
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#ag-foundry')).toHaveText('Foundry: not connected', { timeout: 15_000 });
});

// Judge re-test: Broadcast read "Rules fallback" while Analyst read "Live agents". An api that has said "live" stays live while it waits for events;
// the warm-up timer only falls back for an api that never answered. And the Broadcast desk's line always matches the shell pill.
test('an api that said live stays live through a quiet warm-up', async ({ page }) => {
  const api = await mock('quiet');
  await drive(page, api.url);
  await expect(pill(page)).toHaveText('Live agents', { timeout: 15_000 });
  await page.waitForTimeout(8000);   // past the 6 s warm-up of this test (MATCHCAST_WARM_MS)
  await expect(pill(page)).toHaveText('Live agents');
  api.server.close();
});

test('the Broadcast desk says the same agents state as the shell pill', async ({ page }) => {
  test.setTimeout(300_000);
  const api = await mock('ok');
  await drive(page, api.url);
  await expect(pill(page)).toHaveText('Live agents', { timeout: 20_000 });
  await openView(page, 'broadcast');
  await page.waitForFunction(() => document.getElementById('v-broadcast')!.classList.contains('ready'), null, { timeout: 240_000 });
  const f = page.frames().find((x) => /broadcast\/index\.html/.test(x.url()))!;
  const words: Record<string, string> = { 'Live agents': 'Agents: live from the api', 'Rules fallback': 'Agents: api did not answer, rules in this page', 'Demo mode': 'Agents: rules in this page (no api connected)' };
  await expect.poll(async () => { const p = String(await pill(page).textContent()); const d = String(await f.locator('#mc-agentstate').textContent()); return p.startsWith('Warming') ? d.startsWith('Agents: Warming') : d === words[p]; }, { timeout: 30_000 }).toBe(true);
  api.server.close();
});

// the judge fix must not make a real fallback look live: the api's own rules_fallback stays "Rules fallback" even when it sends a claim,
// a silent warm-up of an api that said nothing promotes to live on its first claim, and a stream that keeps failing stops reading "Live agents".
test('an api that says rules_fallback stays Rules fallback when a claim arrives', async ({ page }) => {
  const api = await mock('rules');
  await drive(page, api.url);
  await expect.poll(() => api.seen.sent, { timeout: 15_000 }).toBe(true);   // the mock has sent its claim and publication
  await page.waitForTimeout(1500);
  await expect(pill(page)).toHaveText('Rules fallback');
  api.server.close();
});

test('a stream that keeps failing stops reading Live agents', async ({ page }) => {
  test.setTimeout(60_000);
  const api = await mock('drop');
  await drive(page, api.url);
  await expect(pill(page)).toHaveText('Rules fallback', { timeout: 30_000 });
  api.server.close();
});

test('eager: the match is created and the stream opened at begin, so the pill says Live agents before any event', async ({ page }) => {
  const api = await mock('ok'); const errs = collectErrors(page);
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api.url) + ';' }));   // the default 90 s warm-up
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => { AG.reset('k2', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }); LV.begin('k2', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }, { name: 'C One', team: 'cco' }] }); });
  await expect(pill(page)).toHaveText('Live agents', { timeout: 10_000 });
  expect(api.seen.matches).toBeGreaterThanOrEqual(1);
  expect(api.seen.events.length, 'no event was sent yet').toBe(0);
  expect(errs).toEqual([]); api.server.close();
});

test('warm-up clock: an unreachable api falls back by itself; a client that has not kicked off yet is not timed', async ({ page }) => {
  const down = await mock('error'); const errs = collectErrors(page);
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(down.url) + ';window.MATCHCAST_WARM_MS=3000;' }));
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => { AG.reset('k3', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }); LV.begin('k3', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }); });
  await expect(pill(page)).toHaveText('Rules fallback', { timeout: 15_000 });   // begin alone: the eager create failed, so the clock ran
  down.server.close();
  const quiet = await mock('ok');   // reachable but silent about 'live': no events yet means no clock
  await page.evaluate((url) => { (window as any).MATCHCAST_API = url; }, quiet.url);
  quiet.server.close();
  expect(errs).toEqual([]);
});
