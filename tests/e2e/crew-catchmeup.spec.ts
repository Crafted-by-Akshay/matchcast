import { test, expect } from './fixtures';
import { createServer } from 'node:http';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// CREW-7.3: the Watch feed picker's Catch me up feed. Picking it asks the shell, the shell reads GET /v1/matches/{id}/catch-me-up?session_id&minute
// (PR #413, 200 / 404 held / 429 / 422) and Watch draws the whole recap. The api is a local fixture server here; no live Azure or Foundry call.
// The feed is live in the picker (live: true in CREW.FEEDS), so the tests set nothing by hand. No timers are waited on: every wait polls for state.
declare const CREW: any;
declare const LV: any;
declare const FR: any;
test.skip(!!process.env.E2E_BASE_URL, 'PR checks only: a fixture api feeds the data');

const RECAP = { feed: 'catch_me_up', minute: 37, text: 'After 37 minutes, Northgate FC lead Coastal Rovers 1-0. Northgate FC scored in minute 23.', word_count: 15, cut_sequence: 41,
  source_event_ids: ['E3', 'E9', 'E12'] };
type Reply = { status: number; body?: any; headers?: Record<string, string> };

async function withApi(cmu: (q: { minute: string | null; session: string | null; lang: string | null; n: number }) => Reply, body: (api: string, hits: string[], posts: { n: number }) => Promise<void>) {
  const hits: string[] = [], posts = { n: 0 }, sockets = new Set<any>();
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Expose-Headers': 'Retry-After' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') { q.resume(); q.on('end', () => { if (!/\/events/.test(q.url!)) posts.n++; r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); }); return; }
      if (/\/catch-me-up/.test(q.url!)) {
        hits.push(q.url!);
        const u = new URL(q.url!, 'http://x'), a = cmu({ minute: u.searchParams.get('minute'), session: u.searchParams.get('session_id'), lang: u.searchParams.get('lang'), n: hits.length });
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

test('the recap text scrolls inside a capped box on desktop and phone, and a keyboard can reach it (tabindex 0, named region)', async ({ page }) => {
  test.setTimeout(300_000);
  const long = Array.from({ length: 280 }, (_, i) => 'word' + i).join(' ') + '.';
  await withApi(() => ({ status: 200, body: { ...RECAP, text: long, word_count: 280 } }), async (api) => {
    const f = await open(page, api);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('word279.', { timeout: 30_000 });
    const text = card.locator('.fp-cu-text');
    await expect(text).toHaveAttribute('tabindex', '0');
    await expect(card.getByRole('region', { name: 'Catch me up recap' })).toHaveCount(1);
    const box = () => text.evaluate((e) => { const c = getComputedStyle(e); return { max: c.maxHeight, oy: c.overflowY, scrolls: e.scrollHeight > e.clientHeight }; });
    for (const w of [1280, 390]) {
      await page.setViewportSize({ width: w, height: 800 });
      await expect.poll(async () => (await box()).max, { timeout: 30_000 }).not.toBe('none');
      const b = await box();
      expect(['auto', 'scroll'], 'overflow at ' + w).toContain(b.oy);
      expect(b.scrolls, 'a 280-word recap scrolls inside its box at ' + w).toBe(true);
    }
  });
});

// AB#465 / PR #424: GET .../catch-me-up takes lang (the ten feed languages, ADR-0023). A checked translation rides along as variants[lang]; with none, the English text is all
// there is. 422 for a language outside the ten. The page asks in the shell's language (window.setLang) and claims a translation only when variants[lang] came back.
const ES = 'Tras 37 minutos, Northgate FC gana 1-0 a Coastal Rovers.';
const setLang = (page: any, l: string) => page.evaluate((x: string) => (window as any).setLang(x, null), l);
const settle = (page: any) => page.evaluate(() => new Promise((res) => requestAnimationFrame(() => res(1))));
const withVariant = ({ lang }: { lang: string | null }) => ({ status: 200, body: lang && lang !== 'en' ? { ...RECAP, variants: { [lang]: lang === 'es' ? ES : 'Nach 37 Minuten führt Northgate FC 1-0.' } } : RECAP });

test('lang: the shell language goes on the request, a returned variant is shown as text with a Translated tag', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await withApi(withVariant, async (api, hits) => {
    const f = await open(page, api);
    await setLang(page, 'es');
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText(ES, { timeout: 30_000 });
    await expect(card).toContainText(/Translated/);
    await expect(card).not.toContainText('Showing English');
    await expect(card).not.toContainText('After 37 minutes');
    await expect(card).toContainText('Verified: recounted from 3 events');
    expect(hits.length).toBe(1);
    expect(new URL(hits[0], 'http://x').searchParams.get('lang')).toBe('es');
    expect(await card.locator('.fp-cu-text').getAttribute('lang')).toBe('es');
  });
  expect(errs).toEqual([]);
});

test('lang: English sends no lang param and shows no Translated tag', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(withVariant, async (api, hits) => {
    const f = await open(page, api);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('After 37 minutes', { timeout: 30_000 });
    expect(new URL(hits[0], 'http://x').searchParams.get('lang')).toBeNull();
    await expect(card).not.toContainText(/Translated|Showing English/);
  });
});

test('lang: no variant came back (the re-check dropped it): the English recap and "Showing English", no Translated claim', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(() => ({ status: 200, body: RECAP }), async (api, hits) => {
    const f = await open(page, api);
    await setLang(page, 'fr');
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('After 37 minutes, Northgate FC lead', { timeout: 30_000 });
    await expect(card).toContainText('Showing English');
    await expect(card).not.toContainText('Translated');
    expect(new URL(hits[0], 'http://x').searchParams.get('lang')).toBe('fr');
    expect(await card.locator('.fp-cu-text').getAttribute('lang')).toBe('en');
  });
});

test('lang: a variant for a different language than the one asked is not shown as a translation', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(() => ({ status: 200, body: { ...RECAP, variants: { de: 'Nach 37 Minuten.' } } }), async (api) => {
    const f = await open(page, api);
    await setLang(page, 'es');
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('After 37 minutes', { timeout: 30_000 });
    await expect(card).toContainText('Showing English');
    await expect(card).not.toContainText('Nach 37');
  });
});

test('lang: changing language after the recap is shown asks once more, in the new language; the same language again asks nothing', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(withVariant, async (api, hits) => {
    const f = await open(page, api);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('After 37 minutes', { timeout: 30_000 });
    expect(hits.length).toBe(1);
    await setLang(page, 'es');
    await expect(card).toContainText(ES, { timeout: 30_000 });
    expect(hits.length).toBe(2);
    expect(new URL(hits[1], 'http://x').searchParams.get('lang')).toBe('es');
    await setLang(page, 'es');
    await settle(page);
    expect(hits.length, 'the same language asks nothing').toBe(2);
    await setLang(page, 'en');
    await expect(card).toContainText('After 37 minutes', { timeout: 30_000 });
    await expect(card).not.toContainText('Translated');
    expect(hits.length).toBe(3);
  });
});

test('lang: a language change inside the gap waits for it and asks once, in the latest language (no storm)', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(withVariant, async (api, hits) => {
    const f = await open(page, api, 2000);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('After 37 minutes', { timeout: 30_000 });
    await setLang(page, 'es'); await setLang(page, 'de'); await setLang(page, 'es');
    await expect(card).toContainText(ES, { timeout: 30_000 });
    await settle(page);
    expect(hits.length, 'one more read, not one per change').toBe(2);
    expect(new URL(hits[1], 'http://x').searchParams.get('lang')).toBe('es');
  });
});

test('lang: 429 keeps the busy note and a language change sends nothing more', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(() => ({ status: 429, body: { code: 'rate_limited' }, headers: { 'Retry-After': '60' } }), async (api, hits) => {
    const f = await open(page, api);
    await setLang(page, 'es');
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('Catch me up is busy. Try again in a minute.', { timeout: 30_000 });
    await setLang(page, 'de');
    await settle(page);
    await expect(card).toContainText('Try again in a minute');
    expect(hits.length).toBe(1);
  });
});

test('lang: 404 held under a language is the neutral held state', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(() => ({ status: 404, body: { code: 'not_found' } }), async (api) => {
    const f = await open(page, api);
    await setLang(page, 'es');
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('No catch-me-up for this moment yet', { timeout: 30_000 });
    await expect(card).not.toContainText(/error|failed|404|Translated/i);
  });
});

test('lang: a 422 on a language is a neutral error note, the last good recap stays, nothing is called a translation', async ({ page }) => {
  test.setTimeout(300_000);
  await withApi(({ lang }) => (lang ? { status: 422, body: { code: 'invalid' } } : { status: 200, body: RECAP }), async (api, hits) => {
    const f = await open(page, api);
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('After 37 minutes', { timeout: 30_000 });
    await setLang(page, 'ja');
    await expect(card).toContainText("Couldn't load the recap", { timeout: 30_000 });
    await expect(card).toContainText('After 37 minutes');
    await expect(card).not.toContainText(/Translated|422/);
    expect(await card.locator('[role=alert]').count()).toBe(0);
    expect(hits.length).toBe(2);
  });
});

test('lang: the translated text is set as text; markup in it stays literal', async ({ page }) => {
  test.setTimeout(300_000);
  const evil = '<img src=x onerror="window.__xss=1"> Tras 5 minutos, 1-0 & "x".';
  await withApi(() => ({ status: 200, body: { ...RECAP, variants: { es: evil } } }), async (api) => {
    const f = await open(page, api);
    await setLang(page, 'es');
    await f.getByRole('radio', { name: /Catch me up/ }).click();
    const card = f.locator('#mc-feedlines');
    await expect(card).toContainText('Tras 5 minutos, 1-0 & "x".', { timeout: 30_000 });
    expect(await card.locator('img').count()).toBe(0);
    expect(await f.evaluate(() => (window as any).__xss)).toBeUndefined();
  });
});
