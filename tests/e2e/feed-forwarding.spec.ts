import { test, expect } from './fixtures';
import { createServer } from 'node:http';

// AB#499: the shell forwards the api's onair and feed_drop records to the desk, and the desk's per-feed kill calls the feed route.
// The records are the docs/contracts.md "Derived feed lines" fields. The api is a mock server here: it streams the two records and takes the kill.
declare const LV: any;

const ONAIR = {
  publication_id: 'P1', feed: 'casual', lang: 'en', text: 'Northgate FC press high up the pitch.', source_event_ids: ['E12'], claim_ids: [],
  match_time_ms: 1860000, aired_at: '2026-10-25T14:00:00Z', repair_count: 0,
};
const DROP = { publication_id: 'P2', feed: 'ticker', source_event_ids: ['E13'], reason_code: 'number_mismatch', repair_count: 1, audit_id: 'audit-9', match_time_ms: 1900000 };

test('the desk shows the api feed records, and its kill calls the feed route', async ({ page }) => {
  test.setTimeout(300_000);
  const kills: { url: string; body: any }[] = [];
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') {
        let b = ''; q.on('data', (c) => (b += c));
        q.on('end', () => {
          if (/\/feeds\/[a-z_]+\/(kill|resume)/.test(q.url!)) kills.push({ url: q.url!, body: JSON.parse(b || '{}') });
          r.writeHead(/\/feeds\//.test(q.url!) ? 200 : /\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors });
          r.end(/\/feeds\//.test(q.url!) ? JSON.stringify({ feed: 'casual', state: 'killed', audit_id: 'audit-1', enforced: true }) : '{}');
        });
        return;
      }
      if (!/\/stream/.test(q.url!)) { r.writeHead(404, cors); return r.end(); }
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors });
      r.write('event: status\ndata: {"status":"live"}\n\n');
      r.write('event: onair\nid: onair:P1:en\ndata: ' + JSON.stringify(ONAIR) + '\n\n');
      r.write('event: feed_drop\nid: feed_drop:P2\ndata: ' + JSON.stringify(DROP) + '\n\n');
    }).listen(0, () => resolve(s));
  });
  try {
    const api = 'http://127.0.0.1:' + (server.address() as any).port;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
    await page.goto('/index.html?split=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
    await page.evaluate(() => { LV.persona('club:thr', 'en'); LV.begin('k1', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }); });

    const desk = page.frameLocator('#v-broadcast iframe');
    await expect(desk.locator('[data-feed="casual"]')).toContainText('Verified 1', { timeout: 120_000 });
    await expect(desk.locator('[data-feed="casual"]')).toContainText('Northgate FC press high up the pitch.');
    await expect(desk.locator('#mc-drop-list')).toContainText('Ticker · number_mismatch');
    await expect(desk.locator('#mc-pq')).not.toContainText('Northgate FC press');   // derived lines never reach the producer queue

    await desk.locator('[data-feed="casual"] [data-kill]').click();
    await expect.poll(() => kills.length, { timeout: 15_000 }).toBe(1);
    expect(kills[0].url).toMatch(/^\/v1\/matches\/[^/]+\/feeds\/casual\/kill/);
    expect(kills[0].body.session_id).toBeTruthy();
    await expect(desk.locator('[data-feed="casual"]')).toContainText('Killed on this desk');
  } finally {
    server.close();
  }
});
