import { test, expect } from './fixtures';
import { openShell, ready, viewFrame } from './helpers';

// Ported from apps/unified/tests/lazy.cjs and timing.cjs, in one cold-cache run so the 3D engine loads once.
test('cold-cache load: Watch does not fetch the Analyst files, then every view becomes ready', async ({ page }) => {
  const seen = { analyst: 0 };
  page.on('request', (r) => { if (/\/analyst\//.test(r.url())) seen.analyst++; });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const t0 = Date.now(); const marks: Record<string, number> = {};
  await openShell(page, 'watch'); marks.picker = Date.now() - t0;
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!(window as any).__mc?.S.started).catch(() => false), { timeout: 300_000, intervals: [250] }).toBe(true);
  marks.watchStarted = Date.now() - t0;
  await page.waitForTimeout(2000);
  expect(seen.analyst, 'requests to analyst/ while only Watch runs').toBe(0);
  await page.click('#tab-analyst'); await ready('analyst', 120_000)(page); marks.analyst = Date.now() - t0;
  await page.click('#tab-broadcast'); await ready('broadcast')(page); marks.broadcast = Date.now() - t0;
  test.info().annotations.push({ type: 'timing (ms)', description: JSON.stringify(marks) });
  expect(marks.picker, 'season picker should appear within 5 s of the shell').toBeLessThan(5000);
});
