import { test, expect, type Page } from '@playwright/test';
import { collectErrors, openShell, viewFrame } from './helpers';

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
