import { test, expect, type Page } from './fixtures';
import { createServer, type Server } from 'node:http';
import { collectErrors } from './helpers';

// The failure drill (gap-to-9 item 4, ADR-0014 on camera): "Cut the model" on the Agents tab sends POST /v1/matches/{id}/drill to the api,
// the pill drops to Rules fallback when the stream says so, and "Restore the model" sends the cut off again. A mock api records the drill calls.
declare const AG: any; declare const LV: any;

type Mock = { server: Server; url: string; seen: { drills: boolean[]; frame?: (ev: string, d: object) => void } };
const mock = () => new Promise<Mock>((resolve) => {
  const seen: Mock['seen'] = { drills: [] };
  const server = createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    if (q.method === 'POST') {
      let b = ''; q.on('data', (c) => (b += c));
      q.on('end', () => {
        const j = JSON.parse(b || '{}');
        if (/\/drill(\?|$)/.test(q.url!)) {   // the shell adds ?session_id; the api's answer: the cut as it now stands, and the match's agent mode
          seen.drills.push(j.model_cut);
          if (seen.frame) seen.frame('status', j.model_cut ? { status: 'rules_fallback', reason: 'model_error' } : { status: 'live' });
          r.writeHead(200, { 'Content-Type': 'application/json', ...cors }); return r.end(JSON.stringify({ model_cut: j.model_cut, mode: 'live' }));
        }
        r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}');
      });
      return;
    }
    if (!/\/stream/.test(q.url!) || /persona=booth/.test(q.url!)) { r.writeHead(404, cors); return r.end('{}'); }
    r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
    const frame = (ev: string, d: object) => r.write('event: ' + ev + '\ndata: ' + JSON.stringify(d) + '\n\n');
    seen.frame = frame;
    frame('status', { status: 'live' });
    q.on('close', () => { if (seen.frame === frame) seen.frame = undefined; });
  }).listen(0, () => resolve({ server, url: 'http://127.0.0.1:' + (server.address() as any).port, seen }));
});

async function drive(page: Page, api: string) {
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';window.MATCHCAST_WARM_MS=6000;' }));
  await page.route(/\/(watch|broadcast|analyst)\/index\.html/, (rt) => rt.abort());   // the shell alone: the 3D views are too slow in headless software rendering
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => {   // the shell as Watch drives it: a match start and one batch of events
    const key = 'k1', names = { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' };
    const roster = { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }, { name: 'C One', team: 'cco' }] };
    AG.reset(key, names); LV.begin(key, roster);
    const batch = [{ minute: 12.3, type: 'shot', team: 'thr', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'open play', data: {} }];
    AG.onWatch(key, batch, []); LV.events(batch);
  });
}

test('cut the model: the api gets the drill, the pill drops to Rules fallback, restore brings it back', async ({ page }) => {
  const api = await mock(); const errs = collectErrors(page);
  await drive(page, api.url);
  const pill = page.locator('#api-pill'), btn = page.locator('#ag-drill'), note = page.locator('#ag-drill-note');
  await expect(pill).toHaveText('Live agents', { timeout: 15_000 });
  await expect(btn).toHaveText('Cut the model');
  await btn.click();
  await expect.poll(() => api.seen.drills).toEqual([true]);
  await expect(btn).toHaveText('Restore the model');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect(note).toContainText('Model cut on the api');
  await expect(pill).toHaveText('Rules fallback', { timeout: 10_000 });
  await btn.click();
  await expect.poll(() => api.seen.drills).toEqual([true, false]);
  await expect(btn).toHaveText('Cut the model');
  await expect(note).toContainText('Model restored');
  await expect(pill).toHaveText('Live agents', { timeout: 10_000 });
  expect(errs).toEqual([]); api.server.close();
});

test('without an api the drill says there is no model to cut', async ({ page }) => {
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="";' }));
  await page.route(/\/(watch|broadcast|analyst)\/index\.html/, (rt) => rt.abort());
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.locator('#ag-drill').click();
  await expect(page.locator('#ag-drill-note')).toContainText('no model to cut');
  await expect(page.locator('#ag-drill')).toHaveText('Cut the model');
});
