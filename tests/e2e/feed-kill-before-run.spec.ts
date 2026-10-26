import { test, expect } from './fixtures';
import { createServer } from 'node:http';

// AB#499: a kill the desk makes before the match exists is held, and sent once the match is created, so it is never dropped.
declare const LV: any;

test('a kill made before the match exists is sent once the match is created', async ({ page }) => {
  test.setTimeout(300_000);
  const kills: { url: string; body: any }[] = [];
  const held: (() => void)[] = [];   // the match create is held until the test lets it through: the desk's kill lands while the match does not exist yet
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') {
        let b = ''; q.on('data', (c) => (b += c));
        q.on('end', () => {
          if (new URL(q.url!, 'http://api').pathname === '/v1/matches') { held.push(() => { r.writeHead(201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); }); return; }
          if (/\/feeds\/[a-z_]+\/(kill|resume)/.test(q.url!)) kills.push({ url: q.url!, body: JSON.parse(b || '{}') });
          r.writeHead(/\/feeds\//.test(q.url!) ? 200 : /\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors });
          r.end(/\/feeds\//.test(q.url!) ? JSON.stringify({ feed: 'casual', state: 'killed', audit_id: 'audit-1', enforced: true }) : '{}');
        });
        return;
      }
      if (!/\/stream/.test(q.url!)) { r.writeHead(404, cors); return r.end(); }
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors });
      r.write('event: status\ndata: {"status":"live"}\n\n');
    }).listen(0, () => resolve(s));
  });
  try {
    const api = 'http://127.0.0.1:' + (server.address() as any).port;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
    await page.goto('/index.html?split=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });

    const desk = page.frameLocator('#v-broadcast iframe');
    await expect(desk.locator('[data-feed="casual"]')).toBeVisible({ timeout: 120_000 });
    await expect.poll(() => held.length, { timeout: 60_000 }).toBe(1);   // the match create is in flight and not answered
    await desk.locator('[data-feed="casual"] [data-kill]').click();
    await expect(desk.locator('[data-feed="casual"]')).toContainText('Killed on this desk');
    await page.waitForTimeout(500);
    expect(kills.length).toBe(0);   // the match does not exist yet: the kill is held, not sent

    held.forEach((release) => release());   // the match is created
    await expect.poll(() => kills.length, { timeout: 60_000 }).toBe(1);
    expect(kills[0].url).toMatch(/^\/v1\/matches\/[^/]+\/feeds\/casual\/kill/);
    expect(kills[0].body.session_id).toBeTruthy();
  } finally {
    server.close();
  }
});
