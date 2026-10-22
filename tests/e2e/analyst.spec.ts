import { test, expect, type Page } from '@playwright/test';
import { collectErrors, openShell, viewFrame } from './helpers';

// EXP-13: Data platform page in the Analyst view. Fabric and Databricks are not connected, so the page must say Planned.
async function openPage(page: Page) {
  await openShell(page, 'analyst');
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await f.evaluate(() => (window as any).go('data-platform'));
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
  await openShell(page, 'analyst');
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await f.evaluate(() => (window as any).go('audit'));
  await expect(f.locator('.pg')).toContainText('Unverified');
  await f.click('#gv-ver');
  await expect(f.locator('.pg')).toContainText('Intact');
  expect(errs).toEqual([]);
});

test('reports: a sample report is drafted from the match numbers and can be submitted', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'analyst');
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await f.evaluate(() => (window as any).go('reports'));
  await f.click('#gv-sample');
  await expect(f.locator('.pg')).toContainText('Key numbers');
  await expect(f.locator('.pg')).toContainText('Expected goals');
  await expect(f.getByRole('button', { name: 'Submit for approval' })).toBeVisible();
  await expect(f.getByRole('button', { name: 'Export .md' })).toBeVisible();
  expect(errs).toEqual([]);
});
