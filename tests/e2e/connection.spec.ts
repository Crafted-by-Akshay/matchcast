import { test, expect, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { collectErrors } from './helpers';

// Ported from apps/unified/tests/connection.cjs (EXP-1). A mock api records what the shell sends.
// Cases: live (pill 'Live agents', contract events reach the api, its claim shows), fallback (api answers 503: 'Rules fallback'), offline (no api).
declare const AG: any; declare const LV: any;

type Mock = { server: Server; url: string; seen: { matches: number; events: any[]; sent?: boolean } };
const mock = (mode: 'ok' | 'error') => new Promise<Mock>((resolve) => {
  const seen: Mock['seen'] = { matches: 0, events: [] };
  const server = createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    if (mode === 'error') { r.writeHead(503, cors); return r.end('{}'); }
    if (q.method === 'POST') {
      let b = ''; q.on('data', (c) => (b += c));
      q.on('end', () => { const j = JSON.parse(b || '{}'); const ev = /\/events/.test(q.url!); if (ev) seen.events.push(...j.events); else seen.matches++; r.writeHead(ev ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); });
      return;
    }
    r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
    const frame = (ev: string, d: object, id?: string) => r.write('event: ' + ev + '\n' + (id ? 'id: ' + id + '\n' : '') + 'data: ' + JSON.stringify(d) + '\n\n');
    frame('status', { status: 'live' });
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
    const key = 'k1', names = { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' };
    const roster = { teams: ['ars', 'che'], players: [{ name: 'A One', team: 'ars' }, { name: 'C One', team: 'che' }] };
    AG.reset(key, names); LV.begin(key, roster);
    const batch = [{ minute: 12.3, type: 'shot', team: 'ars', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'open play', data: {} }, { minute: 12.4, type: 'goal', team: 'ars', player: 'A One', score: '1-0' }];
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
  await expect.poll(() => page.evaluate(() => AG.run.claims.some((c: any) => c.id === 'api-1' && c.source === 'model' && c.text === 'Goal from the api.'))).toBe(true);
  expect(errs).toEqual([]); api.server.close();
});

test('fallback: Rules fallback after the warm-up, rules lines keep coming', async ({ page }) => {
  const api = await mock('error'); const errs = collectErrors(page);
  await drive(page, api.url);
  await expect(pill(page)).toHaveText('Rules fallback', { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => AG.run.claims.filter((c: any) => c.source === 'rules').length > 0)).toBe(true);
  expect(errs).toEqual([]); api.server.close();
});

test('offline: Offline (simulated) and no api call', async ({ page }) => {
  const errs = collectErrors(page);
  await drive(page, '');
  await expect(pill(page)).toHaveText('Offline (simulated)');
  expect(await page.evaluate(() => !LV.enabled)).toBe(true);
  expect(errs).toEqual([]);
});
