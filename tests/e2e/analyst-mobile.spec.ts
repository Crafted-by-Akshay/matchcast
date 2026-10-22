import { test, expect } from './fixtures';

// Analyst polish: at phone width no main page scrolls sideways (wide tables scroll inside their own box) and each shows a heading.
const PAGES = ['home', 'library', 'audit', 'reports', 'data-platform', 'ds-agent', 'agents', 'api', 'settings', 'usage', 'status', 'scouting', 'board'];

test('analyst view at 390px: no page scrolls sideways', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/analyst/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  const wide: string[] = [];
  for (const p of PAGES) {
    await page.evaluate((p) => (window as any).go(p), p);
    await expect(page.locator('#main h1').first()).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) wide.push(`${p}: ${over}px`);
  }
  expect(wide).toEqual([]);
});
