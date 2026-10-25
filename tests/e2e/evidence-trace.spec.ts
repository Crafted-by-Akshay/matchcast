import { test, expect, type Page } from './fixtures';
import { createServer } from 'node:http';
import { collectErrors } from './helpers';

declare const AG: any; declare const TP: any; declare const MCC: any; declare const LV: any;

// CREW-6.2 (AB#444): "How was this made?" can list, for an aired line, the agents, the tool calls, the data rows (match events and history rows) and the audit hashes behind it.
// It is built behind ?evidence=1 until the api carries claim-level evidence (AB#498); a line from the rules agents has everything in the page.
async function openEvidence(page: Page, query: string) {
  // a server left running from before #340 (tests/e2e/serve.mjs builds once, and outside CI an existing server is reused) serves a panel with no Evidence section: say so instead of "element not found"
  if (query.includes('evidence=1')) expect((await (await page.request.get('/trace-panel.js')).text()).includes('tp-evidence'), 'the served build predates the Evidence section (#340): restart the server on this test port so it rebuilds').toBe(true);
  await page.goto('/index.html' + query + '#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof AG !== 'undefined' && typeof TP !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => {
    AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.onWatch('k1', [{ minute: 12.3, type: 'shot', team: 'thr', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'open play', data: {} }, { minute: 12.4, type: 'goal', team: 'thr', player: 'A One', score: '1-0' }], []);
  });
  await expect.poll(() => page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.kind === 'score'); return !!c && c.audit.length >= 3; }), { timeout: 15_000 }).toBe(true);
  return page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.kind === 'score'); TP.open(c.id); return c.id as string; });
}

test('evidence trace: a line lists its agents, tool calls, event rows, history rows and audit hashes', async ({ page }) => {
  const errs = collectErrors(page);
  await openEvidence(page, '?evidence=1');
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev).toBeVisible();
  for (const a of ['producer', 'analyst', 'narrator', 'verifier']) await expect(ev.locator('.tp-agents')).toContainText(a);
  await expect(ev.locator('.tp-tools')).toContainText('event_log.goals');
  await expect(ev.locator('.tp-tools')).toContainText('score_counter');
  const row = ev.locator('.tp-rows li').first();
  await expect(row).toContainText("12'");
  await expect(row).toContainText('goal');
  await expect(row).toContainText('A One');
  await expect(ev.locator('.tp-history')).toContainText('Planned');   // history rows (CREW-2.2) are not built: the panel says so instead of inventing any
  const hashes = ev.locator('.tp-audit li');
  expect(await hashes.count()).toBeGreaterThanOrEqual(3);
  await expect(hashes.first()).toContainText('matches the chain record');
  const shown = await hashes.evaluateAll((els) => els.map((e) => ({ ok: e.classList.contains('ok'), seq: Number(/#(\d+)/.exec(e.textContent || '')![1]), hash: e.querySelector('code')!.textContent })));
  const chain = await page.evaluate(() => MCC.records().map((r: any) => r.hash.slice(0, 12)));
  for (const h of shown) { expect(h.ok, 'row #' + h.seq).toBe(true); expect(h.hash, 'hash of #' + h.seq).toBe(chain[h.seq - 1]); }
  await expect(ev.locator('.tp-chain')).toContainText(/Chain intact: \d+ records/, { timeout: 10_000 });
  expect(errs).toEqual([]);
});

test('evidence trace: a hash that is not in the audit chain is marked, not hidden', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  await page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.kind === 'score'); c.audit[0].hash = 'deadbeef0000'; TP.open(c.id); });
  await expect(page.locator('#tp .tp-audit li').first()).toContainText('no matching chain record');
});

test('evidence trace: without the flag the panel is unchanged', async ({ page }) => {
  await openEvidence(page, '');
  await expect(page.locator('#tp')).toBeVisible();
  await expect(page.locator('#tp .tp-evidence')).toHaveCount(0);
  expect(await page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.kind === 'score'); const probe = document.createElement('div'); probe.innerHTML = TP.html(c); return document.querySelector('#tp .tp-b')!.innerHTML === probe.innerHTML; })).toBe(true);
});

test('evidence trace: a line from the api says what is not sent yet instead of showing a guess', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  await page.evaluate(() => {
    AG.ingest({ claim_id: 'api-1', metric: 'goals', value: 1, units: 'count', approval_status: 'approved' }, 'live');
    TP.open('api-1');
  });
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev).toBeVisible();
  await expect(ev).toContainText('Planned (AB#498)');
  await expect(ev.locator('.tp-agents')).toContainText('Planned (AB#498)');
  await expect(ev.locator('.tp-tools')).toContainText('Planned (AB#498)');
  await expect(ev.locator('.tp-rows li')).toHaveCount(0);
});

test('evidence trace: a tampered chain says where it breaks, and a running total says it cites no single event', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  await page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.kind === 'xg_total'); MCC.records()[0].detail = { tampered: true }; TP.open(c.id); });
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-chain')).toContainText(/Chain broken at record #1/, { timeout: 10_000 });
  await expect(ev).toContainText('cites no single event');
});

test('evidence trace: an unknown event id, a history row and a hostile name are shown honestly and escaped', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  await page.evaluate(() => {
    const c = AG.run.claims.find((x: any) => x.kind === 'score');
    c.evidence = ['e2', 'e99']; c.history = [{ label: 'Head-to-head <b>x</b>', value: '3 wins', dataset: 'synthetic' }];
    AG.run.events.find((e: any) => e.id === 'e2').player = '<img src=x onerror=window.__xss=1>';
    TP.open(c.id);
  });
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-rows li').nth(1)).toContainText('not in the event log');
  await expect(ev.locator('.tp-history')).toContainText('Head-to-head <b>x</b> 3 wins');
  await expect(ev.locator('.tp-history')).not.toContainText('Planned');
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  await expect(ev.locator('.tp-rows li').first()).toContainText('<img src=x');
});

// AB#498 (proposal: matchcast-v2/vision/interfaces/crew-frames-proposal.md): a crew_trace frame for a line fills the Evidence section of an api line.
// The whole mapping from the frame's field names is one function in trace-panel.js (CT.fromFrame), so a rename there is the only change.
const apiLine = (page: Page) => page.evaluate(() => {
  AG.ingest({ claim_id: 'c-9', metric: 'goals:home', value: 1, units: 'count', approval_status: 'approved' }, 'live');
  AG.ingest({ publication_id: 'pub-L-17', line_id: 'L-17', claim_ids: ['c-9'], text: 'Goal for Northgate FC.' }, 'live');
  return AG.run.events[0].id as string;
});
const frame = (ev: string) => ({
  match_id: 'm1', at_ms: 720000, line_id: 'L-17', moment_id: 'm-e42', feed: 'analyst', state: 'published', text: 'Goal for Northgate FC.',
  claims: [{ claim_id: 'c-9', metric: 'goals:home', value: 1, source_event_ids: [ev, 'e-gone'], history_row_ids: ['results:41230'] }],
  verifier: { verdict: 'verified', reason_code: null, checks: ['numbers', 'names', 'freshness'] }, repair_of: 'L-16', called: ['analyst', 'narrator', 'verifier'], audit_hash: 'sha256:' + 'ab'.repeat(32),
});

test('evidence trace: a crew_trace frame fills an api line with its agents, event rows, history rows, verifier verdict and repair', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  const ev0 = await apiLine(page);
  await page.evaluate((f) => { (window as any).mcCrewTrace(f); TP.open('pub-L-17'); }, frame(ev0));
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-agents')).toContainText('analyst → narrator → verifier');
  await expect(ev.locator('.tp-agents')).not.toContainText('Planned');
  await expect(ev.locator('.tp-tools'), 'tool names are not on the frame: still said to be Planned, not guessed').toContainText('Planned (AB#498)');
  const rows = ev.locator('.tp-rows li');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(ev0);
  await expect(rows.nth(1)).toContainText('not in the event log');
  await expect(ev.locator('.tp-history')).toContainText('results row 41230');
  await expect(ev.locator('.tp-history')).not.toContainText('Planned');
  await expect(ev.locator('.tp-verifier')).toContainText('verified');
  await expect(ev.locator('.tp-verifier')).toContainText('numbers, names, freshness');
  await expect(ev.locator('.tp-repair')).toContainText('repairs L-16');
  await expect(ev.locator('.tp-crew-audit')).toContainText('sha256:abab');
  await expect(ev.locator('.tp-crew-audit')).toContainText('not recomputed in this page');
});

test('evidence trace: a frame that arrives while the panel is open updates it; a dropped line shows the reason, not the text', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  const ev0 = await apiLine(page);
  await page.evaluate(() => TP.open('pub-L-17'));
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-agents')).toContainText('Planned (AB#498)');
  await page.evaluate((f) => (window as any).mcCrewTrace({ ...f, state: 'dropped', text: undefined, verifier: { verdict: 'rejected', reason_code: 'number_mismatch <i>x</i>', checks: ['numbers'] } }), frame(ev0));
  await expect(ev.locator('.tp-agents')).toContainText('analyst → narrator → verifier');
  await expect(ev.locator('.tp-verifier')).toContainText('rejected');
  await expect(ev.locator('.tp-verifier')).toContainText('number_mismatch <i>x</i>');   // escaped, shown as text
  await expect(ev.locator('.tp-verifier i')).toHaveCount(0);
  await expect(ev.locator('.tp-state')).toContainText('dropped');
  await expect(ev.locator('.tp-state')).toContainText('text is in the audit chain, not shown');
});

test('evidence trace: a malformed crew_trace frame is ignored, and the flag off leaves the panel alone', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  await apiLine(page);
  const r = await page.evaluate(() => [(window as any).mcCrewTrace(null), (window as any).mcCrewTrace({}), (window as any).mcCrewTrace({ line_id: 'L-17', claims: 'x' })]);
  expect(r).toEqual([false, false, true]);   // a frame with no line id is refused; one with a bad claims field is kept with no claims
  await page.evaluate(() => TP.open('pub-L-17'));
  await expect(page.locator('#tp .tp-agents')).toContainText('none recorded');
  const page2 = await page.context().newPage();
  await openEvidence(page2, '');
  await apiLine(page2);
  await page2.evaluate(() => { (window as any).mcCrewTrace({ line_id: 'L-17', called: ['analyst'] }); TP.open('pub-L-17'); });
  await expect(page2.locator('#tp .tp-evidence')).toHaveCount(0);
});

// the stream end to end: a crew_trace event from the api reaches the panel through live.js (a mock api, as in connection.spec.ts)
test('evidence trace: a crew_trace event on the api stream reaches the panel', async ({ page }) => {
  const errs = collectErrors(page);
  const server = createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    if (q.method === 'POST') { q.resume(); q.on('end', () => { r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); }); return; }
    if (!/\/stream/.test(q.url!)) { r.writeHead(404, cors); return r.end('{}'); }
    r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
    const frame = (ev: string, d: object) => r.write('event: ' + ev + '\ndata: ' + JSON.stringify(d) + '\n\n');
    frame('status', { status: 'live' });
    frame('claim', { claim_id: 'c-9', metric: 'goals:home', value: 1, units: 'count', approval_status: 'approved' });
    frame('publication', { publication_id: 'pub-L-17', line_id: 'L-17', claim_ids: ['c-9'], text: 'Goal for Northgate FC.' });
    frame('crew_trace', frame0);
  }).listen(0);
  const frame0 = { match_id: 'm1', at_ms: 720000, line_id: 'L-17', moment_id: 'm-e42', feed: 'analyst', state: 'published', claims: [{ claim_id: 'c-9', source_event_ids: [], history_row_ids: ['results:7'] }], verifier: { verdict: 'verified', reason_code: null, checks: ['numbers'] }, called: ['analyst', 'verifier'], audit_hash: 'sha256:' + 'cd'.repeat(32) };
  const api = 'http://127.0.0.1:' + (server.address() as any).port;
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';window.MATCHCAST_WARM_MS=6000;' }));
  await page.goto('/index.html?evidence=1#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && typeof TP !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const names = { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }, roster = { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }, { name: 'C One', team: 'cco' }] };
    AG.reset('k1', names); LV.begin('k1', roster);
    const batch = [{ minute: 12.4, type: 'goal', team: 'thr', player: 'A One', score: '1-0' }];
    AG.onWatch('k1', batch, []); LV.events(batch);
  });
  await expect.poll(() => page.evaluate(() => AG.run.claims.some((c: any) => c.id === 'pub-L-17')), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => TP.open('pub-L-17'));
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-agents')).toContainText('analyst → verifier', { timeout: 10_000 });
  await expect(ev.locator('.tp-history')).toContainText('results row 7');
  await expect(ev.locator('.tp-crew-audit')).toContainText('sha256:cdcd');
  expect(errs.filter((e) => !/EventSource/.test(e))).toEqual([]);
  server.close();
});
