import { test, expect, type Page } from './fixtures';
import { createServer, type Server } from 'node:http';
import { collectErrors } from './helpers';

// Event to on air (gap-to-9 item 6): the header pill shows the median wall time from a Watch event reaching the shell to the api's
// published line arriving, matched by the publication's state.max_evidence_sequence. A mock api publishes 300 ms after it accepts events.
declare const AG: any; declare const LV: any;

type Mock = { server: Server; url: string; seen: { lastSeq: number; frame?: (ev: string, d: object) => void } };
const mock = () => new Promise<Mock>((resolve) => {
  const seen: Mock['seen'] = { lastSeq: 0 };
  const server = createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    if (q.method === 'POST') {
      let b = ''; q.on('data', (c) => (b += c));
      q.on('end', () => {
        const j = JSON.parse(b || '{}'), ev = /\/events/.test(q.url!);
        r.writeHead(ev ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}');
        if (!ev) return;
        seen.lastSeq = Math.max(seen.lastSeq, ...j.events.map((e: any) => e.stream_sequence));
        const seq = seen.lastSeq;   // the line rests on the last event of this batch: the publication's snapshot says so
        setTimeout(() => seen.frame && seen.frame('publication', { publication_id: 'pub-' + seq, claim_ids: ['c-' + seq], text: 'Shot for Thames Rovers.', persona: 'casual',
          event_time_ms: 738000, state: { state_revision: seq, event_time_ms: 738000, max_evidence_sequence: seq } }), 300);
      });
      return;
    }
    if (!/\/stream/.test(q.url!) || /persona=booth/.test(q.url!)) { r.writeHead(404, cors); return r.end('{}'); }
    r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
    const frame = (ev: string, d: object) => r.write('event: ' + ev + '\ndata: ' + JSON.stringify(d) + '\n\n');
    seen.frame = frame; frame('status', { status: 'live' });
    q.on('close', () => { if (seen.frame === frame) seen.frame = undefined; });
  }).listen(0, () => resolve({ server, url: 'http://127.0.0.1:' + (server.address() as any).port, seen }));
});

async function drive(page: Page, api: string) {
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';window.MATCHCAST_WARM_MS=6000;' }));
  await page.route(/\/(watch|broadcast|analyst)\/index\.html/, (rt) => rt.abort());   // the shell alone: the 3D views are too slow in headless software rendering
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const key = 'k1', names = { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' };
    const roster = { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }, { name: 'C One', team: 'cco' }] };
    AG.reset(key, names); LV.begin(key, roster);
  });
}
const sendShot = (page: Page, minute: number) => page.evaluate((m) => {
  const batch = [{ minute: m, type: 'shot', team: 'thr', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'open play', data: {} }];
  AG.onWatch('k1', batch, []); LV.events(batch);
}, minute);

test('the header shows event to on air once the api publishes, and clears on a new match', async ({ page }) => {
  const api = await mock(); const errs = collectErrors(page);
  await drive(page, api.url);
  const pill = page.locator('#lat-pill');
  await expect(page.locator('#api-pill')).toHaveText('Live agents', { timeout: 15_000 });
  await expect(pill).toBeHidden();
  await sendShot(page, 12.3);
  await expect(pill).toBeVisible({ timeout: 10_000 });
  await expect(pill).toHaveText(/^Event → on air \d+\.\d s \(1 line\)$/);
  const first = await page.evaluate(() => LV.latency);
  expect(first.n).toBe(1);
  expect(first.median_ms).toBeGreaterThan(250);   // the mock waits 300 ms, so the number is at least that and well under the test's patience
  expect(first.median_ms).toBeLessThan(8000);
  await sendShot(page, 13.1);
  await expect(pill).toHaveText(/\(2 lines\)$/, { timeout: 10_000 });
  await page.evaluate(() => { AG.reset('k2', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }); LV.begin('k2', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }); });
  await expect(pill).toBeHidden();
  expect(errs).toEqual([]); api.server.close();
});
