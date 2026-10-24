import { test, expect } from './fixtures';
import { readFileSync } from 'fs';
import { collectErrors, openShell, ready, stepSim, viewFrame } from './helpers';

// DAT-4 task 272: control, chaos and tempo. The port holds to the Python results; Watch draws the sparkline and the Analyst's match page shows the numbers.
const golden = JSON.parse(readFileSync('packages/metrics/golden/indices-golden.json', 'utf8'));
// the embed is a browser script that exports itself when `module` exists
const idx = (() => { const m: any = { exports: {} }; new Function('module', readFileSync('apps/unified/embed/indices.js', 'utf8'))(m); return m.exports; })();
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

test('indices: the JavaScript port matches the Python results at every probe and on the rolling series', () => {
  expect(golden.events.length).toBeGreaterThan(500);
  for (const p of golden.probes) {
    near(idx.control(golden.events, p.now_ms), p.control);
    near(idx.chaos(golden.events, p.now_ms), p.chaos);
    near(idx.tempo(golden.events, p.now_ms), p.tempo);
  }
  const s = idx.series(golden.events, 60 * 60000);
  expect(s).toHaveLength(golden.series.length);
  s.forEach((p: any, i: number) => { near(p.control, golden.series[i].control); near(p.chaos, golden.series[i].chaos); near(p.tempo, golden.series[i].tempo); });
});

test('indices: an empty window is bounded and does not throw', () => {
  expect(idx.control([], 60000)).toBeGreaterThanOrEqual(0);
  expect(idx.chaos([], 60000)).toBe(0);
  expect(idx.tempo([], 60000)).toBe(0);
});

test('indices: Watch in Analyst mode draws the sparkline and the Analyst match page shows the indices', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const w = await viewFrame(page, 'watch');
  await stepSim(w, 6000);   // 5 simulated minutes
  await expect.poll(() => w.evaluate(() => (window as any).mcIndicesNow().passes), { timeout: 60_000 }).toBeGreaterThan(5);
  const now: any = await w.evaluate(() => (window as any).mcIndicesNow());
  expect(now.control).toBeGreaterThanOrEqual(0); expect(now.control).toBeLessThanOrEqual(100);
  expect(now.chaos).toBeGreaterThanOrEqual(0); expect(now.chaos).toBeLessThanOrEqual(100);
  await expect(w.locator('#mcx-idx')).toBeVisible({ timeout: 10_000 });
  await expect(w.locator('#mcx-idx')).toContainText('Control');
  await page.locator('#tabs [data-view="analyst"], [role="tab"]:has-text("Analyst")').first().click();
  const a = await viewFrame(page, 'analyst');
  await a.evaluate(() => (window as any).go('match'));
  await expect(a.locator('#idx-panel table')).toBeVisible({ timeout: 20_000 });
  await expect(a.locator('#idx-panel')).toContainText('Control');
  await expect(a.locator('#idx-panel')).toContainText('Tempo');
  expect(errs).toEqual([]);
});

test('indices: the sparkline panel stays hidden until it has two minutes to draw (no stuck "too early" box)', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const w = await viewFrame(page, 'watch');
  await stepSim(w, 300);   // 15 simulated seconds
  await expect.poll(() => w.evaluate(() => (window as any).mcIndicesNow().series.length), { timeout: 30_000 }).toBeLessThan(2);
  await w.waitForTimeout(2500);   // the panel repaints every 2 s
  await expect(w.locator('#mcx-idx')).toBeHidden();
  await stepSim(w, 3000);
  await expect(w.locator('#mcx-idx')).toBeVisible({ timeout: 10_000 });
  await expect(w.locator('#mcx-idx')).not.toContainText('too early');
  expect(errs).toEqual([]);
});
