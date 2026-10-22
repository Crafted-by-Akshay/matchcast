import { test, expect, type Page } from '@playwright/test';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// EXP-13: Data platform page in the Analyst view. Fabric and Databricks are not connected, so the page must say Planned.
async function openPage(page: Page, route = 'data-platform') {
  await openShell(page, 'analyst');
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await f.evaluate((r) => (window as any).go(r), route);
  return f;
}

test('data platform: blocks are labelled Planned while their files are missing', async ({ page }) => {
  const errs = collectErrors(page);
  await page.route('**/shared/model-card.json', (r) => r.fulfill({ status: 404, body: '' }));
  await page.route('**/shared/fabric-dashboard.*', (r) => r.fulfill({ status: 404, body: '' }));
  const f = await openPage(page);
  await expect(f.locator('h1')).toHaveText('Data platform');
  await expect(f.locator('#dp-fab')).toContainText('DAT-8');
  await expect(f.locator('#dp-mc [data-planned]')).toContainText('Planned');
  await expect(f.locator('#dp-mc')).toContainText('DAT-6');
  expect(errs).toEqual([]);
});

test('data platform: model card renders escaped, and the Fabric clip notes it is a recording', async ({ page }) => {
  const errs = collectErrors(page);
  await page.route('**/shared/model-card.json', (r) => r.fulfill({ json: { name: 'danger', version: 'v3<b>', trained_at: '2026-10-23', data: 'synthetic', metrics: { auc: 0.71 } } }));
  await page.route('**/shared/fabric-dashboard.png', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgo=', 'base64') }));
  const f = await openPage(page);
  await expect(f.locator('#dp-card')).toContainText('v3<b>');
  await expect(f.locator('#dp-card')).toContainText('0.71');
  await expect(f.locator('#dp-card b')).toHaveCount(0);
  await expect(f.locator('#dp-fab')).toContainText('Paused after filming');
  expect(errs).toEqual([]);
});

// QUA-3: audit chain and report generation. Ledger, approval and server audit join when EXP-11/12 land in this view.
test('audit: Verify chain reports the session chain intact', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'audit');
  await expect(f.locator('.pg')).toContainText('Unverified');
  await f.click('#gv-ver');
  await expect(f.locator('.pg')).toContainText('Intact');
  expect(errs).toEqual([]);
});

test('reports: a sample report is drafted from the latest match and moves to approval', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'reports');
  // a fresh browser context has an empty library, so the empty-state button is there
  await f.click('#gv-sample');
  await expect(f.locator('.pg')).toContainText('Key numbers');
  // the score in the title equals the Goals row of the key-numbers table
  const text = (await f.locator('.pg').innerText()).replace(/\s+/g, ' ');
  const [, h, a] = text.match(/Post-match: .+? (\d+)–(\d+) /)!;
  expect(text).toMatch(new RegExp('Goals ' + h + ' ' + a + ' '));
  await expect(f.getByRole('button', { name: 'Export .md' })).toBeVisible();
  await f.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(f.locator('.pg')).toContainText(/pending approval/i);
  expect(errs).toEqual([]);
});

// AGT-14: the Data Scientist page asks the api; verified answers show table, chart and SQL, anything else shows a fixed sentence and no chart.
async function askDs(page: Page, reply: { status?: number; json?: object; abort?: boolean }) {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="http://api.test/";' }));
  await page.route('http://api.test/v1/ds/ask', (r) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers }); // CORS preflight always passes
    return reply.abort ? r.abort() : r.fulfill({ status: reply.status ?? 200, headers, json: reply.json ?? {} });
  });
  const f = await openPage(page, 'ds-agent');
  await f.fill('#d2-ag-q', 'Which team has the highest average xG?');
  await f.press('#d2-ag-q', 'Enter');
  return f;
}
const verified = (over: object = {}) => ({ answer: 'Guanabara FC: 2.1', verdict: 'verified', sql: 'SELECT team, AVG(xg) FROM team_match GROUP BY team', columns: ['team', 'avg_xg'], rows: [['Guanabara FC', 2.1], ['<i>x</i>', 1.4]], chart_spec: { mark: 'bar' }, ...over });

test('data scientist: a verified answer shows its table, chart and SQL, escaped', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await askDs(page, { json: verified() });
  await expect(f.locator('.d2-a')).toContainText('Guanabara FC: 2.1');
  await expect(f.locator('.d2-a')).toContainText('verified');
  await expect(f.locator('.d2-a [data-ds="table"]')).toContainText('<i>x</i>');
  await expect(f.locator('.d2-a i')).toHaveCount(0);
  await expect(f.locator('.d2-a svg[role="img"]')).toBeVisible();
  await expect(f.locator('.d2-a svg text', { hasText: '<i>x</i>' })).toHaveCount(1);
  await expect(f.locator('.d2-a [data-ds="sql"]')).toContainText('SELECT team');
  expect(errs).toEqual([]);
});

test('data scientist: a verified table without a chart_spec or with non-numeric values has no chart', async ({ page }) => {
  const f = await askDs(page, { json: verified({ chart_spec: null }) });
  await expect(f.locator('.d2-a [data-ds="table"]')).toBeVisible();
  await expect(f.locator('.d2-a svg[role="img"]')).toHaveCount(0);
});

test('data scientist: a rejected result shows a fixed sentence, no numbers, SQL or chart', async ({ page }) => {
  const f = await askDs(page, { json: { ...verified(), answer: 'Guanabara FC: 9.9', verdict: 'rejected', mismatch: 'row 1' } });
  await expect(f.locator('.d2-a')).toContainText('Could not verify this result.');
  await expect(f.locator('.d2-a')).toContainText('unverified');
  await expect(f.locator('.d2-a')).not.toContainText('9.9');
  await expect(f.locator('.d2-a svg[role="img"], .d2-a [data-ds="table"], .d2-a [data-ds="sql"], .d2-a .steps')).toHaveCount(0);
});

test('data scientist: odd shapes (null row, missing columns, empty rows) never break the page', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await askDs(page, { json: verified({ rows: [null, ['a', 'b']], columns: null }) });
  await expect(f.locator('.d2-a')).toContainText('Could not verify this result.');
  await f.fill('#d2-ag-q', 'again'); await f.press('#d2-ag-q', 'Enter');
  await expect(f.locator('.d2-q')).toHaveCount(2);
  expect(errs).toEqual([]);
});

for (const [name, reply] of [['503', { status: 503 }], ['400', { status: 400 }], ['network error', { abort: true }]] as const) {
  test(`data scientist: api ${name} falls back to a rules answer, once, labelled as rules`, async ({ page }) => {
    const f = await askDs(page, reply);
    await expect(f.locator('.d2-a')).toContainText('Data Scientist · rules');
    await expect(f.locator('.d2-a')).not.toContainText('verified');
    await expect(f.locator('.d2-q')).toHaveCount(1);
  });
}

test('data scientist: a rate-limited api says so and the rules answer', async ({ page }) => {
  const f = await askDs(page, { status: 429 });
  await expect(f.locator('.d2-a')).toContainText('rate limited');
  await expect(f.locator('.d2-a')).toContainText('Data Scientist · rules');
  await expect(f.locator('.d2-q')).toHaveCount(1);
});

// AGT-15 task 105: the full-time recap card on the Match centre page of a match that came from Watch.
test('match centre: the recap card waits for the api, then shows the verified recap', async ({ page }) => {
  const errs = collectErrors(page);
  let calls = 0;
  await page.route('http://api.test/v1/matches/m1/recap/analyst**', (r) => {
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (++calls < 2) return r.fulfill({ status: 404, headers, json: { code: 'not_found' } });
    return r.fulfill({ status: 200, headers, json: { text: 'Guanabara won 4-0 <b>x</b>.', word_count: 4, mode: 'rules', sentences: [{ verdict: 'verified', text: 'Guanabara won 4-0 <b>x</b>.' }] } });
  });
  const f = await openPage(page, 'match');
  await f.evaluate(() => { const m = D.matches[D.matches.length - 1]; m.recap = { api: 'http://api.test/', session_id: 's1', match_id: 'm1' }; (window as any).go('match', m.id); });
  await expect(f.locator('#rc-card')).toContainText('Being written');
  await expect(f.locator('#rc-text')).toContainText('Guanabara won 4-0 <b>x</b>.', { timeout: 15_000 });
  await expect(f.locator('#rc-card b')).toHaveCount(0);
  await expect(f.locator('#rc-card')).toContainText('Rules verifier ✓ every sentence shown');
  await expect(f.locator('#rc-card')).toContainText('Rules fallback');
  expect(errs).toEqual([]);
});

test('match centre: a recorded season match has no recap card', async ({ page }) => {
  const f = await openPage(page, 'match');
  await expect(f.locator('#rc-card')).toHaveCount(0);
});

async function recapCard(page: Page, status: number, json: object) {
  await page.route('http://api.test/v1/matches/m1/recap/analyst**', (r) => r.fulfill({ status, headers: { 'Access-Control-Allow-Origin': '*' }, json }));
  const f = await openPage(page, 'match');
  await f.evaluate(() => { const m = D.matches[D.matches.length - 1]; m.recap = { api: 'http://api.test', session_id: 's1', match_id: 'm1' }; (window as any).go('match', m.id); });
  return f;
}

test('match centre: a sentence the Verifier did not pass is never shown', async ({ page }) => {
  const f = await recapCard(page, 200, { text: 'One ok. Two bad.', word_count: 4, mode: 'agents', sentences: [{ verdict: 'verified', text: 'One ok.' }, { verdict: 'review', text: 'Two bad.' }] });
  await expect(f.locator('#rc-text')).toHaveText('One ok.');
  await expect(f.locator('#rc-card')).not.toContainText('Two bad');
  await expect(f.locator('#rc-card')).toContainText('1 unverified hidden');
});

test('match centre: with no verified sentence the card shows no recap text', async ({ page }) => {
  const f = await recapCard(page, 200, { text: 'Only bad.', word_count: 2, mode: 'agents', sentences: [{ verdict: 'review', text: 'Only bad.' }] });
  await expect(f.locator('#rc-card')).toContainText('No sentence passed the Verifier');
  await expect(f.locator('#rc-card')).not.toContainText('Only bad');
});

test('match centre: text without verified sentence rows, or malformed rows, shows no text', async ({ page }) => {
  const f = await recapCard(page, 200, { text: 'Unchecked claim.', sentences: [null, { verdict: 'verified', text: 7 }, { verdict: 'verified' }] });
  await expect(f.locator('#rc-card')).toContainText('No sentence passed the Verifier');
  await expect(f.locator('#rc-card')).not.toContainText('Unchecked');
});

test('match centre: empty recap text and api errors are said plainly, not polled as "being written"', async ({ page }) => {
  const f = await recapCard(page, 200, { text: ' ', sentences: [] });
  await expect(f.locator('#rc-card')).toContainText('no recap');
});

test('match centre: a 500 from the recap api shows Unavailable', async ({ page }) => {
  const f = await recapCard(page, 500, {});
  await expect(f.locator('#rc-card')).toContainText('Unavailable');
  await expect(f.locator('#rc-card')).toContainText('HTTP 500');
});

// DAT-11 task 278: the Tracking lab shows Watch's vision accuracy, with OCR marked Planned.
test('tracking lab: shows the vision report from Watch and shows the OCR row honestly', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'ds-tracking');
  await expect(f.locator('#vis-panel')).toContainText('No vision run yet');
  const report = { on: true, camera: 'broadcast', captures: 120, resolution: '640x316', detection: { gt: 400, recall: 95.5, precision: 97, posErr: 0.45 },
    identity: { frames: 300, accuracy: 71.2, unknownPct: 8, switches: 3 }, speed: { playerErr: 0.6, ballErr: 1.1 }, ball: { inView: 100, found: 80, posErr: 0.7 }, passes: { gt: 20, vis: 15, recall: 61, precision: 80 } };
  await f.evaluate((r) => window.postMessage({ src: 'matchcast-shell', type: 'vision', report: r }, '*'), report);
  await expect(f.locator('#vis-panel')).toContainText('95.5%');
  await expect(f.locator('#vis-panel')).toContainText('71.2%');
  await expect(f.locator('#vis-panel tr', { hasText: 'glyph + Azure OCR' })).toContainText('None accepted yet');
  await expect(f.locator('#vis-panel tr', { hasText: 'OCR crops sent' })).toHaveCount(0);
  await f.evaluate((r) => window.postMessage({ src: 'matchcast-shell', type: 'vision', report: { ...r, ocr: { sent: 4, answered: 3, read: 2, no_digits: 1, skipped_small: 20, unavailable: 0, errors: 1, per_minute_cap: 15, accepted: 2, scored: 2, glyph_right: 1, ocr_right: 2, agreed: 1, changed: 1 } } }, '*'), report);
  await expect(f.locator('#vis-panel tr', { hasText: 'OCR crops sent' })).toContainText('digits read 2');
  await expect(f.locator('#vis-panel tr', { hasText: 'OCR crops sent' })).toContainText('too small to read 20');
  await expect(f.locator('#vis-panel tr', { hasText: 'glyph + Azure OCR' })).toContainText('low-confidence tracks only, 2 scored of 2 accepted: glyph alone 50%, glyph + OCR 100%');
  await f.evaluate((r) => window.postMessage({ src: 'matchcast-shell', type: 'vision', report: { ...r, on: false, detection: { ...r.detection, recall: null } } }, '*'), report);
  await expect(f.locator('#vis-panel')).toContainText('n/a');
  await expect(f.locator('#vis-panel')).toContainText('switched off');
  // a report with whole sections missing still draws; a null report (new match) goes back to the empty state
  await f.evaluate(() => window.postMessage({ src: 'matchcast-shell', type: 'vision', report: { on: true, detection: {} } }, '*'));
  await expect(f.locator('#vis-panel [data-vis="table"]')).toBeVisible();
  await f.evaluate(() => window.postMessage({ src: 'matchcast-shell', type: 'vision', report: null }, '*'));
  await expect(f.locator('#vis-panel')).toContainText('No vision run yet');
  expect(errs).toEqual([]);
});

// DAT-11 task 278, end to end: Vision switched on in Watch reaches the Analyst's Tracking lab through the shell.
test('vision on in Watch reaches the Tracking lab', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'watch');
  const watch = await viewFrame(page, 'watch');
  await ready('watch')(page);
  await watch.evaluate(() => { const b = document.getElementById('visb') as HTMLElement; if (b.getAttribute('aria-pressed') !== 'true') b.click(); });
  await expect(watch.locator('#visb')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { location.hash = 'analyst'; });
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await f.evaluate(() => (window as any).go('ds-tracking'));
  await expect(f.locator('#vis-panel')).toContainText(/frames at 640x\d+/, { timeout: 20_000 });
  await expect(f.locator('#vis-panel')).toContainText('Identity, glyph reader only');
});

test('service status: shows the api account of what is live, simulated and planned', async ({ page }) => {
  const errs = collectErrors(page);
  const doc = { mode: 'cloud', overall: 'simulated', counts: { live: 1, planned: 1 }, dependencies: [
    { key: 'a', label: 'Fabric', status: 'planned', detail: 'not connected yet' },
    { key: 'b', label: 'Table Storage', status: 'live', detail: 'events and audit are in Table Storage' }] };
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="http://127.0.0.1:9";' }));
  await page.route('**/v1/status', (rt) => rt.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(doc) }));
  const f = await openPage(page, 'status');
  await expect(f.locator('#ss-card')).toContainText('Table Storage');
  await expect(f.locator('#ss-card')).toContainText('Planned');
  expect(errs.filter((e) => !/127\.0\.0\.1:9|ERR_|Failed to load resource/.test(e))).toEqual([]);
});

test('service status: without an api it says the console is simulated', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'status');
  await expect(f.locator('#ss-card')).toContainText('No api is configured');
  expect(errs).toEqual([]);

// Service status: a card from the agent api's GET /v1/status above the console's own checks.
async function statusPage(page: Page, reply: { status?: number; json?: object; abort?: boolean } | null) {
  if (reply) {
    await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="http://api.test";' }));
    await page.route('http://api.test/v1/status', (r) => (reply.abort ? r.abort() : r.fulfill({ status: reply.status ?? 200, headers: { 'Access-Control-Allow-Origin': '*' }, json: reply.json ?? {} })));
  }
  return openPage(page, 'status');
}
const statusBody = { mode: 'local', overall: 'degraded', counts: { live: 1, simulated: 2, planned: 1, unavailable: 0 }, dependencies: [
  { key: 'api', label: 'Agent api', status: 'live', detail: 'answering' }, { key: 'foundry', label: 'Microsoft Foundry <b>x</b>', status: 'simulated', detail: 'rules fallback' },
  { key: 'speech', label: 'Azure AI Speech', status: 'simulated', detail: 'browser voices' }, { key: 'fabric', label: 'Fabric', status: 'planned', detail: 'not built' }] };

test('status page: the api card lists each dependency with its own label, escaped', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await statusPage(page, { json: statusBody });
  const card = f.locator('#st-api');
  await expect(card.locator('[data-st="table"] tbody tr')).toHaveCount(4);
  await expect(card.locator('[data-st="table"] thead th')).toHaveText(['Service', 'State', 'Detail']);
  await expect(card.locator('tr', { hasText: 'Agent api' })).toContainText('Live');
  await expect(card.locator('tr', { hasText: 'Fabric' })).toContainText('Planned');
  await expect(card.locator('tr', { hasText: 'Foundry' })).toContainText('Simulated');
  await expect(card.locator('b')).toHaveText(['local', 'degraded']);   // only the summary's mode and overall; the label's <b> is escaped
  await expect(card).toContainText('overall degraded');
  await expect(f.locator('.pf-banner')).toBeVisible();   // the console's own checks are still there
  expect(errs.filter((e) => !/api\.test/.test(e))).toEqual([]);
});

test('status page: no api connected says so, an api error says Unavailable', async ({ page }) => {
  const f = await statusPage(page, null);
  await expect(f.locator('#st-api')).toContainText('No agent api is connected');
  const p2 = await page.context().newPage();
  const g = await statusPage(p2, { status: 500, json: {} });
  await expect(g.locator('#st-api')).toContainText('Unavailable');
  await expect(g.locator('#st-api')).toContainText('HTTP 500');
  await p2.close();
});

test('status page: odd bodies never crash the page or pose as a good answer', async ({ page }) => {
  const errs = collectErrors(page);
  const odd = { mode: 'local', overall: 'ok', counts: { live: 1 }, dependencies: [null, 'x', { key: 'k', label: 'Constructor test', status: 'constructor', detail: 'd' }, { key: 'u', label: 'Unreachable', status: 'unavailable', detail: 'no endpoint' }, { label: 'Empty' }] };
  const f = await statusPage(page, { json: odd });
  const card = f.locator('#st-api');
  await expect(card.locator('tbody tr')).toHaveCount(3);
  await expect(card.locator('tr', { hasText: 'Constructor test' })).toContainText('Unknown');
  await expect(card.locator('tr', { hasText: 'Unreachable' })).toContainText('Unavailable');
  await expect(f.locator('.pf-banner')).toBeVisible();
  expect(errs.filter((e) => !/api\.test/.test(e))).toEqual([]);
});

test('status page: a body that is not an object with dependencies shows Unavailable, not an empty good answer', async ({ page }) => {
  const f = await statusPage(page, { json: null as any });
  await expect(f.locator('#st-api')).toContainText('Unavailable');
  await expect(f.locator('#st-api')).not.toContainText('overall');
});

test('status page: a network failure says Unavailable without a stale HTTP code', async ({ page }) => {
  const f = await statusPage(page, { abort: true });
  await expect(f.locator('#st-api')).toContainText('Unavailable');
  await expect(f.locator('#st-api')).not.toContainText('HTTP');
});

test('status page: Run checks again refetches the api card', async ({ page }) => {
  let n = 0;
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="http://api.test";' }));
  await page.route('http://api.test/v1/status', (r) => { n++; return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, json: { ...statusBody, overall: 'pass' + n } }); });
  const f = await openPage(page, 'status');
  await expect(f.locator('#st-api')).toContainText('overall pass1');
  await f.locator('#pf-rc').click();
  await expect(f.locator('#st-api')).toContainText('overall pass2', { timeout: 20_000 });
});
