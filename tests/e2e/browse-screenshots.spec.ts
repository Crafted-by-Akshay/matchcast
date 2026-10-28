import { test, expect } from './fixtures';
import { mkdirSync } from 'node:fs';

test('capture Home, Matches and My Club at release viewport widths', async ({ page }) => {
  const dir = process.env.BROWSE_SCREENSHOTS_DIR;
  test.skip(!dir, 'set BROWSE_SCREENSHOTS_DIR to capture review evidence');
  mkdirSync(dir!, { recursive: true });
  const requestedWidth = Number(process.env.BROWSE_SCREENSHOT_WIDTH);
  const widths = Number.isFinite(requestedWidth) && requestedWidth >= 320 ? [requestedWidth] : [390, 768, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/index.html#home', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
    await page.screenshot({ path: `${dir}/home-${width}.png` });
    await page.locator('#tab-matches').click();
    await page.screenshot({ path: `${dir}/matches-${width}.png` });
    await page.locator('#tab-my-club').click();
    await page.locator('#my-club-pick').selectOption('HAR');
    await page.screenshot({ path: `${dir}/my-club-${width}.png` });
    await page.locator('#club-ask-open').click();
    await expect(page.locator('#club-ask-panel')).toBeVisible();
    await page.screenshot({ path: `${dir}/my-club-copilot-${width}.png` });
    await page.locator('#club-ask-close').click();
    await page.goto('/index.html#match/M001', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#match-detail h2')).toBeVisible();
    await page.screenshot({ path: `${dir}/match-${width}.png` });
  }
});
