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

// AB#498, final contract (docs/contracts.md "Derived feed lines", 1.2.0): an `onair` or `feed_drop` record fills the Evidence section of an api line, and claims carry
// optional tool_call_ids, evidence_ids (results:<row>) and trace_id. The whole mapping from the record's field names is one function in trace-panel.js (fromFrame).
const apiLine = (page: Page) => page.evaluate(() => {
  AG.ingest({ claim_id: 'c-9', metric: 'goals:home', value: 1, units: 'count', approval_status: 'approved', trace_id: 'match-demo:m-e42', tool_call_ids: ['tc-1', 'tc-2'], evidence_ids: ['results:41230', 'results:7'] }, 'live');
  AG.ingest({ publication_id: 'onair-casual-goal', line_id: 'L-17', claim_ids: ['c-9'], text: 'Goal for Northgate FC.' }, 'live');
  return AG.run.events[0].id as string;
});
const onair = (ev: string) => ({
  kind: 'onair', schema_version: '1.2.0', publication_id: 'onair-casual-goal', feed: 'casual', lang: 'en', text: 'Goal for Northgate FC.',
  source_event_ids: [ev, 'e-gone'], claim_ids: ['c-9'], match_time_ms: 720000, aired_at: '2026-10-17T10:00:01Z', repair_count: 1,
});
const drop = (ev: string) => ({ kind: 'feed_drop', schema_version: '1.2.0', publication_id: 'onair-casual-goal', feed: 'analyst', source_event_ids: [ev], reason_code: 'number_mismatch <i>x</i>', repair_count: 1, audit_id: 'audit-drop-1', match_time_ms: 720000 });
const crew = (page: Page, f: object) => page.evaluate((x) => (window as any).mcCrewTrace(x), f);

test('evidence trace: an onair record and the claim fields fill an api line with its events, history rows, tool call ids, run id and repair count', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  const ev0 = await apiLine(page);
  expect(await crew(page, onair(ev0))).toBe(true);
  await page.evaluate(() => TP.open('onair-casual-goal'));
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-state')).toContainText('published');
  await expect(ev.locator('.tp-state')).toContainText('feed casual');
  await expect(ev.locator('.tp-verifier')).toContainText('(as the api reports it)');
  await expect(ev.locator('.tp-verifier')).toContainText('after one repair');
  await expect(ev.locator('.tp-trace')).toContainText('match-demo:m-e42');
  await expect(ev.locator('.tp-agents'), 'the api does not say which agents ran: still Planned, not guessed').toContainText('Planned (AB#498)');
  await expect(ev.locator('.tp-tools')).toContainText('tc-1, tc-2');
  await expect(ev.locator('.tp-tools')).toContainText('ids only');
  const rows = ev.locator('.tp-rows li');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(ev0);
  await expect(rows.nth(1)).toContainText('an api event id this page no longer holds or never sent');
  await expect(ev.locator('.tp-history')).toContainText('results row 41230');
  await expect(ev.locator('.tp-history')).toContainText('results row 7');
  await expect(ev.locator('.tp-history')).not.toContainText('Planned');
  await expect(ev.locator('.tp-crew-audit')).toHaveCount(0);   // an aired line has no drop audit record
});

test('evidence trace: a record that arrives while the panel is open updates it; a dropped line shows the reason and audit id, not the text', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  const ev0 = await apiLine(page);
  await page.evaluate(() => TP.open('onair-casual-goal'));
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-rows')).toHaveCount(0);
  await expect(ev).toContainText('has not sent this line\'s record');
  await crew(page, drop(ev0));
  await expect(ev.locator('.tp-state')).toContainText('dropped');
  await expect(ev.locator('.tp-state')).toContainText('text is in the audit chain, not shown');
  await expect(ev.locator('.tp-verifier')).toContainText('number_mismatch <i>x</i>');   // escaped, shown as text
  await expect(ev.locator('.tp-verifier i')).toHaveCount(0);
  await expect(ev.locator('.tp-crew-audit')).toContainText('audit-drop-1');
  await expect(ev.locator('.tp-crew-audit')).toContainText('not recomputed in this page');
  await expect(ev.locator('.tp-rows li')).toHaveCount(1);
});

test('evidence trace: an unknown record kind or one with no line id is ignored, and the flag off leaves the panel alone', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  await apiLine(page);
  expect(await page.evaluate(() => [(window as any).mcCrewTrace(null), (window as any).mcCrewTrace({}), (window as any).mcCrewTrace({ kind: 'crew_trace', publication_id: 'onair-casual-goal' }), (window as any).mcCrewTrace({ kind: 'onair' })])).toEqual([false, false, false, false]);
  await page.evaluate(() => TP.open('onair-casual-goal'));
  await expect(page.locator('#tp .tp-state')).toHaveCount(0);
  const page2 = await page.context().newPage();
  await openEvidence(page2, '');
  await apiLine(page2);
  expect(await crew(page2, onair('e1')), 'with the flag off the record is refused and nothing is kept').toBe(false);
  await page2.evaluate(() => TP.open('onair-casual-goal'));
  await expect(page2.locator('#tp .tp-evidence')).toHaveCount(0);
  await page2.close();
});

test('evidence trace: a line never borrows another line\'s record, and a claim card takes none', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  const ev0 = await apiLine(page);
  await page.evaluate(() => AG.ingest({ publication_id: 'onair-analyst-goal', line_id: 'L-18', claim_ids: ['c-9'], text: 'Second line citing the same claim.' }, 'live'));
  await crew(page, onair(ev0));   // the record is for onair-casual-goal only
  await page.evaluate(() => TP.open('onair-analyst-goal'));
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-state')).toHaveCount(0);
  await expect(ev).toContainText('has not sent this line\'s record');
  await page.evaluate(() => TP.open('c-9'));   // the claim both lines cite
  await expect(ev.locator('.tp-state')).toHaveCount(0);
  await expect(ev.locator('.tp-verifier')).toHaveCount(0);
});

test('evidence trace: a new match drops the old records; odd fields neither crash nor invent rows; many event ids are capped', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  const ev0 = await apiLine(page);
  // claim fields and record fields that are not strings are shown as nothing, and the panel still opens
  await page.evaluate(() => {
    AG.ingest({ claim_id: 'c-odd', metric: 'goals:home', value: 1, units: 'count', approval_status: 'approved', trace_id: { toString: 1 }, tool_call_ids: [{ toString: 1 }, 'tc-ok', 5], evidence_ids: 'results:3' }, 'live');
    AG.ingest({ publication_id: 'pub-odd', line_id: 'L-odd', claim_ids: ['c-odd', 'c-missing', null], text: 'A line with odd fields.' }, 'live');
    (window as any).mcCrewTrace({ kind: 'onair', publication_id: 'pub-odd', feed: { toString: 1 }, lang: 7, source_event_ids: [null, {}, 12, 'e1', 'e1'], claim_ids: 'x', repair_count: 'one', audit_id: { toString: 1 } });
    TP.open('pub-odd');
  });
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-tools')).toContainText('tc-ok');
  await expect(ev.locator('.tp-rows li')).toHaveCount(2);   // the number 12 and the string e1 once; null and {} are dropped
  await expect(ev.locator('.tp-history'), 'evidence_ids that is not a list is not read as one').toContainText('has not sent');
  // a new match: the old record is gone, and a line of the same id in the next match takes none of it
  await crew(page, onair(ev0));
  await page.evaluate(() => { AG.reset('k2', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }); AG.ingest({ publication_id: 'onair-casual-goal', line_id: 'L-17', claim_ids: [], text: 'A line in the next match.' }, 'live'); TP.open('onair-casual-goal'); });
  await expect(ev.locator('.tp-state')).toHaveCount(0);
  // many event ids: capped, with a count of the rest
  await crew(page, { kind: 'onair', publication_id: 'onair-casual-goal', source_event_ids: Array.from({ length: 120 }, (_, i) => 'x' + i), claim_ids: [], repair_count: 0 });
  await expect(ev.locator('.tp-rows li')).toHaveCount(50);
  await expect(ev).toContainText('+70 more event ids not listed');
  await expect(ev.locator('.tp-verifier')).toContainText('first time');
});

test('evidence trace: a record for another line does not redraw the open panel', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  const ev0 = await apiLine(page);
  await page.evaluate((f) => { (window as any).mcCrewTrace(f); TP.open('onair-casual-goal'); document.querySelector('#tp .tp-evidence')!.setAttribute('data-mark', '1'); }, onair(ev0));
  await page.evaluate((f) => (window as any).mcCrewTrace({ ...f, publication_id: 'onair-other' }), onair(ev0));
  expect(await page.evaluate(() => document.querySelector('#tp .tp-evidence')!.getAttribute('data-mark')), 'not redrawn').toBe('1');
  await page.evaluate((f) => (window as any).mcCrewTrace({ ...f, repair_count: 0 }), onair(ev0));   // the line on screen: redrawn
  await expect(page.locator('#tp .tp-verifier')).toContainText('first time');
});

// the stream end to end: an onair event from the api reaches the panel through live.js (a mock api, as in connection.spec.ts)
test('evidence trace: an onair event on the api stream reaches the panel', async ({ page }) => {
  const errs = collectErrors(page);
  // events the api's numbering skips (no team or player) make the page's ids and the api's ids differ from the second event on: e1 to the api is the goal, e1 to the page is the whistle
  const rec = { schema_version: '1.2.0', publication_id: 'onair-casual-goal', feed: 'casual', lang: 'en', source_event_ids: ['e1', 'e77'], claim_ids: ['c-9'], match_time_ms: 720000, repair_count: 0 };
  const server = createServer((q, r) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    if (q.method === 'POST') { q.resume(); q.on('end', () => { r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); }); return; }
    if (!/\/stream/.test(q.url!)) { r.writeHead(404, cors); return r.end('{}'); }
    r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors });
    const send = (ev: string, d: object) => r.write('event: ' + ev + '\ndata: ' + JSON.stringify(d) + '\n\n');
    send('status', { status: 'live' });
    send('claim', { claim_id: 'c-9', metric: 'goals:home', value: 1, units: 'count', approval_status: 'approved', tool_call_ids: ['tc-9'], evidence_ids: ['results:7'], trace_id: 'match-demo:m-e42' });
    send('publication', { publication_id: 'onair-casual-goal', line_id: 'L-17', claim_ids: ['c-9'], text: 'Goal for Northgate FC.' });
    send('onair', rec);
    send('feed_drop', { schema_version: '1.2.0', publication_id: 'onair-analyst-goal', feed: 'analyst', source_event_ids: ['e1'], reason_code: 'number_mismatch', repair_count: 1, audit_id: 'audit-drop-1', match_time_ms: 720000 });
  });
  await new Promise<void>((res) => server.listen(0, res));
  const api = 'http://127.0.0.1:' + (server.address() as any).port;
  try {
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';window.MATCHCAST_WARM_MS=6000;' }));
  await page.goto('/index.html?evidence=1#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && typeof TP !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const names = { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }, roster = { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }, { name: 'C One', team: 'cco' }] };
    AG.reset('k1', names); LV.begin('k1', roster);
    const batch = [{ minute: 3, type: 'whistle' }, { minute: 12.4, type: 'goal', team: 'thr', player: 'A One', score: '1-0' }];
    AG.onWatch('k1', batch, []); LV.events(batch);
  });
  await expect.poll(() => page.evaluate(() => AG.run.claims.some((c: any) => c.id === 'onair-casual-goal')), { timeout: 20_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => { TP.open('onair-casual-goal'); return document.querySelectorAll('#tp .tp-state').length; }), { timeout: 10_000 }).toBe(1);
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-state')).toContainText('published');
  await expect(ev.locator('.tp-verifier')).toContainText('first time');
  const rows = ev.locator('.tp-rows li');
  await expect(rows.first(), 'the api\'s e1 is the goal it was sent, not the page\'s own e1 (the whistle)').toContainText('goal · A One');
  await expect(rows.first()).not.toContainText('whistle');
  await expect(rows.nth(1)).toContainText('an api event id this page no longer holds or never sent');
  await expect(ev.locator('.tp-tools')).toContainText('tc-9');
  await expect(ev.locator('.tp-trace')).toContainText('match-demo:m-e42');
  await expect(ev.locator('.tp-history')).toContainText('results row 7');
  expect(errs.filter((e) => !/EventSource/.test(e))).toEqual([]);
  } finally { server.closeAllConnections(); server.close(); }
});
