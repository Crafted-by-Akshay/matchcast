import { test, expect } from './fixtures';
import { createServer } from 'node:http';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// CREW-7.3: the Watch feed picker's Catch me up feed. Picking it asks the shell, the shell reads GET /v1/matches/{id}/catch-me-up?session_id&minute
// (PR #413, 200 / 404 held / 429 / 422) and Watch draws the whole recap. The api is a local fixture server here; no live Azure or Foundry call.
// The feed is Planned in the picker until the end-to-end check passes, so these tests mark it live in the page (the shell's CREW.FEEDS), as the
// shell's own flag will. No timers are waited on: every wait polls for state.
declare const CREW: any;
declare const LV: any;
declare const FR: any;
test.skip(!!process.env.E2E_BASE_URL, 'PR checks only: a fixture api feeds the data');

const RECAP = { feed: 'catch_me_up', minute: 37, text: 'After 37 minutes, Northgate FC lead Coastal Rovers 1-0. Northgate FC scored in minute 23.', word_count: 15, cut_sequence: 41,
  source_event_ids: ['E3', 'E9', 'E12'] };
type Reply = { status: number; body?: any; headers?: Record<string, string> };

async function withApi(cmu: (q: { minute: string | null; session: string | null; n: number }) => Reply, body: (api: string, hits: string[], posts: { n: number }) => Promise<void>) {
  const hits: string[] = [], posts = { n: 0 }, sockets = new Set<any>();
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Expose-Headers': 'Retry-After' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') { q.resume(); q.on('end', () => { if (!/\/events/.test(q.url!)) posts.n++; r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); }); return; }
      if (/\/catch-me-up/.test(q.url!)) {
        hits.push(q.url!);
        const u = new URL(q.url!, 'http://x'), a = cmu({ minute: u.searchParams.get('minute'), session: u.searchParams.get('session_id'), n: hits.length });
        r.writeHead(a.status, { 'Content-Type': a.status >= 400 ? 'application/problem+json' : 'application/json', ...cors, ...(a.headers || {}) }); return r.end(JSON.stringify(a.body || {}));
      }
      if (/\/stream/.test(q.url!)) { r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"live"}\n\n'); return; }
      r.writeHead(404, cors); r.end();
    });
    s.on('connection', (sock) => { sockets.add(sock); sock.on('close', () => sockets.delete(sock)); });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try { await body('http://127.0.0.1:' + (server.address() as any).port, hits, posts); }
  finally { sockets.forEach((x) => x.destroy()); await new Promise<void>((res) => server.close(() => res())); }
}

async function open(page: any, api: string, gapMs = 0) {
  await page.addInitScript((ms: number) => { (window as any).MATCHCAST_CATCHUP_MS = ms; }, gapMs);
  await page.route('**/config.js', (rt: any) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
  await page.route('**/broadcast/**', (r: any) => r.abort());   // Watch must load here; a second 3D engine is not needed
  await openShell(page, 'watch', '?crew=1');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect(f.getByRole('radiogroup', { name: 'Feed' })).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => { CREW.FEEDS.find((d: any) => d.key === 'catch_me_up').live = true; CREW.reset(); });   // reset re-sends the defs to Watch
  await page.evaluate(() => LV.begin('k1', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }));
  await expect.poll(() => page.evaluate(() => !!(LV.key && LV.base)), { timeout: 30_000 }).toBe(true);
  await expect(f.getByRole('radio', { name: /Catch me up/ }).locator('.fp-tag')).toHaveCount(0, { timeout: 30_000 });
  return f;
}
const minuteNow = (page: any, m: number) => page.evaluate((x: number) => { Object.defineProperty(FR.watch, 'live', { configurable: true, get: () => ({ minute: x }), set: () => {} }); }, m);   // Watch's own reports (minute 0 before kick-off) must not overwrite it
const setLive = (page: any) => expect.poll(() => page.evaluate(() => LV.status), { timeout: 30_000 }).not.toBe('offline');

test('200: the whole recap, its minute, word count and the Verified line from the route\'s source events; fetched only when picked', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await withApi(() => ({ status: 200, body: RECAP }), async (api, hits, posts) => {
    const f = await open(page, api);
    await setLive(page);
    await expect.poll(() => posts.n, { timeout: 30_000 }).toBeGreaterThan(0);
    await minuteNow(page, 37);
    await page.evaluate(() => post('watch', { src: 'matchcast-shell', type: 'crew-feeds', lang: 'en', simulated: false, defs: CREW.FEEDS, feeds: { casual: [], analyst: [] } }));
    expect(hits.length, 'nothing is read while Casual is the pick').toBe(0);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('After 37 minutes, Northgate FC lead Coastal Rovers 1-0.', { timeout: 30_000 });
    await expect(card).toContainText('15 words');
    await expect(card).toContainText('Verified: recounted from 3 events');
    await expect(card).toContainText("37'");
    expect(hits.length).toBe(1);
    const u = new URL(hits[0], 'http://x');
    expect(u.pathname).toMatch(/^\/v1\/matches\/m-k1\/catch-me-up$/);
    expect(u.searchParams.get('minute')).toBe('37');
    expect(u.searchParams.get('session_id')).toMatch(/^demo-/);
    expect(await card.locator('.fp-sim').count(), 'a real recap is not labelled Simulated').toBe(0);
    await f.getByRole('radio', { name: /Casual/ }).click();
    await expect(card).not.toContainText('After 37 minutes');
    expect(hits.length, 'leaving the feed reads nothing').toBe(1);
  });
  expect(errs).toEqual([]);
});

test('404 is a held state in neutral words, not an error', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await withApi(() => ({ status: 404, body: { code: 'not_found', detail: 'the catch-me-up is held at minute 0' } }), async (api, hits) => {
    const f = await open(page, api);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('No catch-me-up for this moment yet', { timeout: 30_000 });
    await expect(card).not.toContainText(/error|failed|404|held at/i);
    expect(await card.locator('[role=alert]').count()).toBe(0);
    expect(await card.locator('.fp-verified').count()).toBe(0);
    expect(hits.length).toBe(1);
  });
  expect(errs).toEqual([]);
});

test('429 shows a short wait note and does not retry: a refresh while limited reads nothing', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(() => ({ status: 429, body: { code: 'rate_limited' }, headers: { 'Retry-After': '60' } }), async (api, hits) => {
    const f = await open(page, api);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('Catch me up is busy. Try again in a minute.', { timeout: 30_000 });
    expect(hits.length).toBe(1);
    await card.getByRole('button', { name: /Update/ }).click();
    await f.getByRole('radio', { name: /Analyst/ }).click();
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    await expect(card).toContainText('Try again in a minute');
    // the note is still up after the clicks and the shell has read nothing more: wait on a page round trip, not a timer
    await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => res(1))));
    expect(hits.length).toBe(1);
  });
});

test('the minute is clamped to 0-200 before the call (the api answers 422 outside it)', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(({ minute }) => (+minute! >= 0 && +minute! <= 200 ? { status: 200, body: { ...RECAP, minute: +minute!, text: 'After ' + minute + ' minutes, 0-0.' } } : { status: 422 }), async (api, hits) => {
    const f = await open(page, api);
    await minuteNow(page, 250);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('After 200 minutes, 0-0.', { timeout: 30_000 });
    await minuteNow(page, -4);
    await card.getByRole('button', { name: /Update/ }).click();
    await expect(card).toContainText('After 0 minutes, 0-0.', { timeout: 30_000 });
    await minuteNow(page, 12.9);
    await card.getByRole('button', { name: /Update/ }).click();
    await expect(card).toContainText('After 12 minutes, 0-0.', { timeout: 30_000 });
    expect(hits.map((h) => new URL(h, 'http://x').searchParams.get('minute'))).toEqual(['200', '0', '12']);
  });
});

test('a 422 from the api (a minute the client let through) is a short error with a retry button, not a crash', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(() => ({ status: 422, body: { code: 'invalid' } }), async (api, hits) => {
    const f = await open(page, api);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    await expect(f.locator('#mc-feedlines')).toContainText("Couldn't load the recap", { timeout: 30_000 });
    expect(hits.length).toBe(1);
  });
});

test('Update asks again for the new minute (throttled): a second press inside the gap reads nothing, one after it reads once', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(({ minute }) => ({ status: 200, body: { ...RECAP, minute: +minute!, text: 'Recap at ' + minute + '.' } }), async (api, hits) => {
    const f = await open(page, api, 600_000);   // a gap no test outlasts
    await minuteNow(page, 10);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('Recap at 10.', { timeout: 30_000 });
    await minuteNow(page, 20);
    await card.getByRole('button', { name: /Update/ }).click();
    await f.getByRole('radio', { name: /Casual/ }).click();
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    await expect(card).toContainText('Recap at 10.');
    expect(hits.length, 'inside the gap the last recap stands').toBe(1);
    await page.evaluate(() => { (window as any).MATCHCAST_CATCHUP_MS = 0; });
    await card.getByRole('button', { name: /Update/ }).click();
    await expect(card).toContainText('Recap at 20.', { timeout: 30_000 });
    expect(hits.length).toBe(2);
  });
});

test('the recap text is set as text: markup in it stays literal and nothing runs', async ({ page }) => {
  test.setTimeout(300_000);
  const evil = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> After 5 minutes, "quoted" & 1-0.';
  const errs = collectErrors(page);
  await withApi(() => ({ status: 200, body: { ...RECAP, text: evil, source_event_ids: ['<b>E1</b>'] } }), async (api) => {
    const f = await open(page, api);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('After 5 minutes, "quoted" & 1-0.', { timeout: 30_000 });
    await expect(card).toContainText('<img src=x onerror="window.__xss=1">');
    expect(await card.locator('img, script, b').count()).toBe(0);
    expect(await f.evaluate(() => (window as any).__xss)).toBeUndefined();
  });
  expect(errs).toEqual([]);
});
