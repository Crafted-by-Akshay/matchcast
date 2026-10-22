import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { ready, viewFrame } from './helpers';

// Filming URL: ?seed=2026&speed=4&seedBadClaim=1 makes the takes repeatable (docs/judge/demo-fact-check.md items 1 and 2).
declare const url: (view: string) => string; declare const M: any; declare const AG: any; declare const LV: any;

test('seed and speed come from the URL; the bad-claim switch is on and reaches the api at match creation', async ({ page }) => {
  const created: any[] = [];
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') {
        let b = ''; q.on('data', (c) => (b += c));
        q.on('end', () => { const ev = /\/events/.test(q.url!); if (!ev) created.push(JSON.parse(b || '{}')); r.writeHead(ev ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); });
        return;
      }
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"live"}\n\n');
    }).listen(0, () => resolve(s));
  });
  const api = 'http://127.0.0.1:' + (server.address() as any).port;
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
  await page.goto('/index.html?seed=2026&speed=4&seedBadClaim=1#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  expect(await page.evaluate(() => M.setup.seed)).toBe(2026);
  const watch = await page.evaluate(() => new URLSearchParams(url('watch').split('?')[1]));
  expect(Object.fromEntries(watch as any)).toMatchObject({ seed: '2026', speed: '4' });
  expect(await page.evaluate(() => new URLSearchParams(url('broadcast').split('?')[1]).get('speed')), 'Broadcast keeps its own pace').toBeNull();
  await expect(page.locator('#ag-bad')).toBeChecked();
  expect(await page.evaluate(() => AG.seeding)).toBe(true);
  await expect(page.locator('#ag-bad-note')).toContainText('server Verifier');
  await page.evaluate(() => {
    const roster = { teams: ['ars', 'che'], players: [{ name: 'A One', team: 'ars' }, { name: 'C One', team: 'che' }] };
    LV.begin('k1', roster); LV.events([{ minute: 1, type: 'shot', team: 'ars', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'open play' }]);
  });
  await expect.poll(() => created.length).toBe(1);
  expect(created[0].seed_bad_claim).toBe(true);
  await expect(page.locator('#ag-bad-note')).toContainText('Sent to the server Verifier');
  server.close();
});

test('without the URL parameters nothing is seeded and no speed is forced', async ({ page }) => {
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await expect(page.locator('#ag-bad')).not.toBeChecked();
  expect(await page.evaluate(() => new URLSearchParams(url('watch').split('?')[1]).get('speed'))).toBeNull();
});

test('Watch plays at the speed in the URL', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/index.html?speed=4#watch', { waitUntil: 'domcontentloaded' });
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  expect(await f.evaluate(() => (window as any).__mc.S.speed)).toBe(4);
});
