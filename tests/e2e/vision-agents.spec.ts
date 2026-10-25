import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// ADR-0022 (Vision -> Agents): the Vision stream's summary from the api shows in the Agents strip and as a "From pixels" chip on Watch.
declare const LV: any;

const summary = {
  passes_in: 41,
  lines_verified: 9,
  latest_line: 'Vision has tracked Northgate FC 41 passes and Harbour United 33.',
  agreement: { vision: 74, engine: 80, matched: 69, precision: 0.93, recall: 0.86 },
};

const roster = { teams: ['Harbor', 'Coloso'], players: [{ name: 'Ana Lopez', team: 'Harbor' }, { name: 'Ben Ito', team: 'Harbor' }, { name: 'Cy Roe', team: 'Coloso' }, { name: 'Di Sol', team: 'Coloso' }] };

async function liveShell(page: Page) {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="http://api.test";window.MATCHCAST_WARM_MS=2000;' }));
  await page.route('http://api.test/**', (r) => {
    const u = new URL(r.request().url()), cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (/\/stream$/.test(u.pathname)) return r.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body: 'event: status\ndata: {"status":"live"}\n\n' });
    if (/\/vision\/summary$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(summary) });
    if (r.request().method() === 'POST' && u.pathname === '/v1/matches') return r.fulfill({ status: 201, contentType: 'application/json', headers: cors, body: '{}' });
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
  });
  await openShell(page, 'watch');
  await ready('watch')(page);
  await page.evaluate((ro) => LV.begin('k1', ro), roster);
  await page.waitForFunction(() => !!LV.key, null, { timeout: 20_000 });
}

test('vision -> agents: the Agents strip and the Watch chip show what Vision contributed', async ({ page }) => {
  const errs = collectErrors(page);
  await liveShell(page);
  await expect.poll(() => page.evaluate(() => document.getElementById('ag-vis')!.textContent), { timeout: 20_000 })
    .toContain('41 passes in');
  const strip = await page.evaluate(() => document.getElementById('ag-vis')!.textContent);
  expect(strip).toContain('9 lines verified');
  expect(strip).toContain('93% of Vision');
  const w = await viewFrame(page, 'watch');
  await expect(w.locator('#frompx')).toBeVisible({ timeout: 20_000 });
  await expect(w.locator('#frompx')).toContainText('Vision has tracked Northgate FC 41 passes');
  expect(errs).toEqual([]);
});

test('vision -> agents: with no Vision yet the strip says so and no chip shows', async ({ page }) => {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="";' }));
  await openShell(page, 'watch');
  await ready('watch')(page);
  const text = await page.evaluate(() => document.getElementById('ag-vis')!.textContent);
  expect(text).toContain('waiting for Vision');
  const w = await viewFrame(page, 'watch');
  await expect(w.locator('#frompx')).toBeHidden();
});
