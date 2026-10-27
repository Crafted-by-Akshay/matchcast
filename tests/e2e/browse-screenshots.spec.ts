import { test, expect } from './fixtures';

// Set BROWSE_SCREENSHOTS_DIR=docs/evidence/browse to refresh the checked-in responsive evidence.
const dir = process.env.BROWSE_SCREENSHOTS_DIR;
const sizes = [390, 768, 1440];

test('browse screenshots: Home, Matches and My Club at phone, tablet and desktop widths', async ({ page }) => {
  test.skip(!dir, 'set BROWSE_SCREENSHOTS_DIR to write responsive screenshots');
  test.setTimeout(180_000);
  for (const width of sizes) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/index.html#home', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
    await expect(page.locator('#hero')).toBeVisible();
    await page.screenshot({ path: `${dir}/home-${width}.png`, fullPage: true });
    await page.locator('#tab-matches').click();
    await page.screenshot({ path: `${dir}/matches-${width}.png`, fullPage: true });
    await page.locator('#more-toggle').click();
    await page.locator('#tab-my-club').click();
    await page.locator('#my-club-pick').selectOption({ label: 'Harbor City' });
    await page.locator('#v-my-club').evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: `${dir}/my-club-${width}.png`, fullPage: true });
    await page.locator('#my-club-grid .match-open').first().click();
    await expect(page.locator('#match-detail .moment-list li').first()).toBeVisible();
    await page.locator('#v-match').evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: `${dir}/match-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px has no horizontal page overflow`).toBe(true);
    expect(page.frames().some((frame) => /watch\/index\.html/.test(frame.url())), 'browse must not start the 3D engine').toBe(false);
  }
});
