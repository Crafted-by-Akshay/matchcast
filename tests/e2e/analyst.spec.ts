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

// AGT-14: the Data Scientist page asks the api; verified answers show table, chart and SQL, unverified ones show no chart.
async function askDs(page: Page, reply: { status?: number; json?: object }) {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="http://api.test";' }));
  await page.route('http://api.test/v1/ds/ask', (r) =>
    r.fulfill({ status: reply.status ?? 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, json: reply.json ?? {} }));
  const f = await openPage(page, 'ds-agent');
  await f.fill('#d2-ag-q', 'Which team has the highest average xG?');
  await f.press('#d2-ag-q', 'Enter');
  return f;
}

test('data scientist: a verified answer shows its table, chart and SQL', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await askDs(page, { json: { answer: 'Guanabara FC: 2.1', verdict: 'verified', sql: 'SELECT team, AVG(xg) FROM team_match GROUP BY team', columns: ['team', 'avg_xg'], rows: [['Guanabara FC', 2.1], ['<i>x</i>', 1.4]], chart_spec: { mark: 'bar' } } });
  await expect(f.locator('.d2-a')).toContainText('Guanabara FC: 2.1');
  await expect(f.locator('.d2-a')).toContainText('verified');
  await expect(f.locator('.d2-a [data-ds="table"]')).toContainText('2.1');
  await expect(f.locator('.d2-a [data-ds="table"] i')).toHaveCount(0);
  await expect(f.locator('.d2-a svg[role="img"]')).toBeVisible();
  await expect(f.locator('.d2-a [data-ds="sql"]')).toContainText('SELECT team');
  expect(errs).toEqual([]);
});

test('data scientist: a result the Verifier rejects shows no chart', async ({ page }) => {
  const f = await askDs(page, { json: { answer: 'Could not verify this result.', verdict: 'rejected', sql: 'SELECT 1', columns: ['x'], rows: [[1]], chart_spec: null } });
  await expect(f.locator('.d2-a')).toContainText('Could not verify this result.');
  await expect(f.locator('.d2-a svg[role="img"], .d2-a [data-ds="table"]')).toHaveCount(0);
});

test('data scientist: with the api down the rules answer is used and labelled', async ({ page }) => {
  const f = await askDs(page, { status: 503 });
  await expect(f.locator('.d2-a')).toContainText('highest xG');
  await expect(f.locator('.d2-a')).toContainText('Data Scientist · rules');
});
