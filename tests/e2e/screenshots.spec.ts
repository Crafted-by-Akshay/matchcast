import { test, expect } from './fixtures';
import { openShell, stepSim, viewFrame } from './helpers';

// SUB-2 task 343: README and Devpost screenshots, taken from the real app on the shared fixture.
//   SCREENSHOTS_DIR=docs/screenshots npx playwright test tests/e2e/screenshots.spec.ts --project=chromium
// Skipped otherwise, so make e2e never writes files. Synthetic clubs and players only.
const dir = process.env.SCREENSHOTS_DIR;
const tab = (page: import('@playwright/test').Page, v: string) => page.evaluate((x) => document.getElementById('tab-' + x)!.click(), v);

test('screenshots: Watch, Broadcast, Analyst and Agents', async ({ page }) => {
  test.skip(!dir, 'set SCREENSHOTS_DIR to write the images');
  test.setTimeout(480_000);
  await openShell(page, 'watch');
  const w = await viewFrame(page, 'watch');
  await expect.poll(() => w.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await stepSim(w, 4000);   // several match minutes: events, a Match Pulse card, a score
  await w.evaluate(() => { (window as any).__mc.S.paused = true; });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/watch.png` });

  await tab(page, 'broadcast');
  const b = await viewFrame(page, 'broadcast');
  await expect.poll(() => b.evaluate(() => { const m = (window as any).__mc; return !!(m?.S.started && m.S.paused); }), { timeout: 240_000 }).toBe(true);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${dir}/broadcast.png` });

  await tab(page, 'analyst');
  const a = await viewFrame(page, 'analyst');
  await a.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/analyst.png` });

  await tab(page, 'agents');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${dir}/agents.png` });
});
