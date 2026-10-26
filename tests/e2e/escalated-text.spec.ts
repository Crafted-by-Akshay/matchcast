import { test, expect, type Page } from './fixtures';
import { createServer, type Server } from 'node:http';
import { collectErrors, openShell } from './helpers';

// Experience lane: an escalated line's text is withheld from the open stream (a placeholder in its place),
// so the card loads it from the role-gated GET /v1/matches/{id}/lines, for a producer only.
// A mock api serves the stream (line events carry the placeholders the real api sends) and the lines route.
declare const AG: any; declare const LV: any; declare const CM: any;

const NOT_SHOWN = '[not shown: did not pass its checks]', AWAITING = '[awaiting checks]', WITHHELD = '[withheld: refused by Content Safety]';
const TEXT = `Thames Rovers lead 3-0 at 20'. <img src=x onerror="window.__xss=1">`;

type Mode = { lines?: 'ok' | 'fail' | 'forbidden'; frames: (frame: (ev: string, d: object) => void) => void };
type Mock = { server: Server; url: string; seen: { linesReqs: string[]; linesHeaders: Record<string, any>[]; events: number } };
const mock = (mode: Mode) => new Promise<Mock>((resolve) => {
  const seen: Mock['seen'] = { linesReqs: [], linesHeaders: [], events: 0 };
  const server = createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-MatchCast-Role', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    if (q.method === 'POST') {
      let b = ''; q.on('data', (c) => (b += c));
      q.on('end', () => { const ev = /\/events/.test(q.url!); if (ev) seen.events += (JSON.parse(b || '{}').events || []).length; r.writeHead(ev ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); });
      return;
    }
    if (/\/lines\?/.test(q.url!)) {
      seen.linesReqs.push(q.url!); seen.linesHeaders.push(q.headers);
      if (mode.lines === 'fail') { r.writeHead(500, cors); return r.end('{}'); }
      if (mode.lines === 'forbidden') { r.writeHead(403, cors); return r.end('{"code":"forbidden_role"}'); }
      r.writeHead(200, { 'Content-Type': 'application/json', ...cors });
      return r.end(JSON.stringify({ items: [
        { line_id: 'L1', status: 'review', escalated: true, reason_code: 'number_mismatch', text: TEXT, claim_ids: [] },
        { line_id: 'L2', status: 'review', escalated: true, reason_code: 'unknown_player', text: 'Second held line.', claim_ids: [] },
        { line_id: 'LS', status: 'rejected', escalated: false, reason_code: 'unsafe_content', text: WITHHELD, claim_ids: [] },
      ] }));
    }
    if (!/\/stream/.test(q.url!)) { r.writeHead(404, cors); return r.end('{}'); }
    r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
    const frame = (ev: string, d: object) => r.write('event: ' + ev + '\ndata: ' + JSON.stringify(d) + '\n\n');
    frame('status', { status: 'live' });
    let sent = false;
    const t = setInterval(() => { if (!seen.events || sent) return; sent = true; mode.frames(frame); }, 200);
    q.on('close', () => clearInterval(t));
  }).listen(0, () => resolve({ server, url: 'http://127.0.0.1:' + (server.address() as any).port, seen }));
});

async function drive(page: Page, api: string, role?: string) {
  await page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());   // no 3D frames: the shell is driven directly
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';window.MATCHCAST_WARM_MS=6000;' + (role ? 'window.MATCHCAST_ROLE=' + JSON.stringify(role) + ';' : '') }));
  await openShell(page, 'agents');
  await page.evaluate(() => {
    const key = 'k1', names = { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' };
    const roster = { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }, { name: 'C One', team: 'cco' }] };
    AG.reset(key, names); LV.begin(key, roster);
    const batch = [{ minute: 12.3, type: 'shot', team: 'thr', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'open play', data: {} }, { minute: 12.4, type: 'goal', team: 'thr', player: 'A One', score: '1-0' }];
    AG.onWatch(key, batch, []); LV.events(batch);
  });
}
const held = (id: string, extra: object = {}) => ({ line_id: id, status: 'review', escalated: true, reason_code: 'number_mismatch', text: NOT_SHOWN, claim_ids: [], ...extra });
const escalatedFrames: Mode['frames'] = (frame) => { frame('line', held('L1')); frame('line', held('L1')); frame('line', held('L2', { reason_code: 'unknown_player' })); };
const card = (page: Page, id: string) => page.locator(`#aq-list li[data-id="pub-${id}"]`);

test('a producer: the escalated card loads its text from GET lines, once, escaped', async ({ page }) => {
  const api = await mock({ lines: 'ok', frames: escalatedFrames }); const errs = collectErrors(page);
  await drive(page, api.url);
  await expect(card(page, 'L1').locator('.aq-text')).toContainText(`Thames Rovers lead 3-0 at 20'.`, { timeout: 20_000 });
  await expect(card(page, 'L2').locator('.aq-text')).toHaveText('Second held line.');
  await expect(card(page, 'L1')).toContainText('Escalated');
  await expect(card(page, 'L1').locator('[data-act="kill"]')).toHaveCount(1);
  await expect(card(page, 'L1').locator('[data-act="approve"]')).toHaveCount(0);
  await expect(card(page, 'L1').locator('.aq-text')).not.toContainText('[not shown');
  expect(await page.locator('#aq-list img').count(), 'the text is escaped, not parsed').toBe(0);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  await page.waitForTimeout(2500);   // the replayed line event and the second card must not add requests per card
  expect(api.seen.linesReqs.length, 'one request serves the batch, one per escalated card at most').toBeLessThanOrEqual(1);
  expect(api.seen.linesReqs[0]).toMatch(/\/v1\/matches\/m-k1\/lines\?/);
  expect(api.seen.linesReqs[0]).toContain('session_id=');
  expect(errs).toEqual([]); api.server.close();
});

test('a viewer who is not a producer sees the hidden message and no request is made', async ({ page }) => {
  const api = await mock({ lines: 'ok', frames: escalatedFrames }); const errs = collectErrors(page);
  await drive(page, api.url, 'Viewer');
  await expect(card(page, 'L1').locator('.aq-text')).toHaveText('Text hidden: producer role needed', { timeout: 20_000 });
  await page.waitForTimeout(2500);
  expect(api.seen.linesReqs).toEqual([]);
  await expect(card(page, 'L1')).not.toContainText('Thames Rovers lead 3-0');
  expect(errs).toEqual([]); api.server.close();
});

test('a role the api refuses (403) shows the hidden message', async ({ page }) => {
  const api = await mock({ lines: 'forbidden', frames: escalatedFrames });
  await drive(page, api.url);
  await expect(card(page, 'L1').locator('.aq-text')).toHaveText('Text hidden: producer role needed', { timeout: 20_000 });
  api.server.close();
});

test('a safety-refused line shows it was withheld, never its text', async ({ page }) => {
  const api = await mock({ lines: 'ok', frames: (frame) => frame('line', held('LS', { reason_code: 'unsafe_content', text: WITHHELD })) }); const errs = collectErrors(page);
  await drive(page, api.url);
  await expect(card(page, 'LS').locator('.aq-text')).toHaveText('withheld: refused by Content Safety', { timeout: 20_000 });
  await page.waitForTimeout(2500);
  await expect(card(page, 'LS')).not.toContainText('[');
  expect(errs).toEqual([]); api.server.close();
});

test('a safety-refused line is not shown even if the lines route sends its text', async ({ page }) => {
  // the api never does this; the page must not depend on it. The line arrives as an ordinary placeholder with no reason code.
  const api = await mock({ lines: 'ok', frames: (frame) => frame('line', held('LS', { reason_code: undefined, text: WITHHELD })) });
  await drive(page, api.url);
  await expect(card(page, 'LS').locator('.aq-text')).toHaveText('withheld: refused by Content Safety', { timeout: 20_000 });
  api.server.close();
});

test('a failed fetch keeps a not-shown placeholder and shows no error', async ({ page }) => {
  const api = await mock({ lines: 'fail', frames: escalatedFrames }); const errs = collectErrors(page);
  await drive(page, api.url);
  await expect(card(page, 'L1').locator('.aq-text')).toContainText('Text not shown', { timeout: 20_000 });
  await expect(card(page, 'L1')).toContainText('The Verifier could not repair this line');
  await expect(card(page, 'L1').locator('[data-act="kill"]')).toHaveCount(1);
  expect(await page.evaluate(() => AG.run.claims.find((c: any) => c.id === 'pub-L1').text || '')).toBe('');
  expect(errs).toEqual([]); api.server.close();
});

test('no placeholder is drawn as line text anywhere in the shell', async ({ page }) => {
  const api = await mock({ lines: 'fail', frames: (frame) => {
    frame('claim', { claim_id: 'api-1', metric: 'goals', value: 1, units: 'count', approval_status: 'approved' });
    frame('publication', { publication_id: 'pub-1', claim_ids: ['api-1'], text: 'Goal from the api.' });
    frame('line', { line_id: 'D1', status: 'drafted', text: AWAITING, claim_ids: ['api-1'] });
    frame('line', { line_id: 'D2', status: 'verifying', text: AWAITING, claim_ids: ['api-1'] });
    frame('line', { line_id: '1', status: 'rejected', text: NOT_SHOWN, claim_ids: ['api-1'] });   // the id of the published card
    frame('line', { line_id: 'W1', status: 'rejected', reason_code: 'unsafe_content', text: WITHHELD, claim_ids: ['api-1'] });
    frame('publication', { publication_id: 'pub-2', claim_ids: ['api-1'], text: AWAITING });   // not sent by the api; the page must still not show it
    frame('line', held('H1', { text: NOT_SHOWN }));
  } }); const errs = collectErrors(page);
  await drive(page, api.url);
  await expect.poll(() => page.evaluate(() => AG.run.claims.some((c: any) => c.id === 'pub-H1')), { timeout: 20_000 }).toBe(true);
  await page.waitForTimeout(1500);
  const bad = /\[(awaiting|not shown|withheld)/;
  const dump = await page.evaluate(() => JSON.stringify({
    claims: AG.run.claims.map((c: any) => [c.id, c.text, c.airText]), feed: AG.run.feed, queue: AG.queue(), cm: CM.view(80),
  }));
  expect(dump, 'no card, feed line, booth line or queue item carries a placeholder').not.toMatch(bad);
  for (const tab of ['agents', 'broadcast', 'watch']) {
    await page.evaluate((t) => { location.hash = t; }, tab);
    expect(await page.evaluate(() => document.body.innerText), tab + ' view text').not.toMatch(bad);
  }
  expect(await page.evaluate(() => document.getElementById('sr-lines')!.textContent || '')).not.toMatch(bad);
  // the pill / trace panel for a card without text draws a state, not a placeholder
  await page.evaluate(() => { location.hash = 'agents'; });
  expect(await page.evaluate(() => (document.getElementById('aq-list')!.textContent || '') + (document.getElementById('ag-lanes')!.textContent || ''))).not.toMatch(bad);
  expect(errs).toEqual([]); api.server.close();
});

test('rules fallback (no api): the queue and escalated cards with text are unchanged', async ({ page }) => {
  await page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());
  await openShell(page, 'agents');
  await page.evaluate(() => { AG.reset('k-esc', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }); AG.ingest({ line_id: 'L9', status: 'review', escalated: true, reason_code: 'number_mismatch', text: "Thames Rovers lead 3-0 at 20'." }, 'live'); });
  await expect(card(page, 'L9').locator('.aq-text')).toHaveText("Thames Rovers lead 3-0 at 20'.");
});
