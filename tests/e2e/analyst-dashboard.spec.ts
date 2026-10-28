import { test, expect } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

test('Analyst overview is black, focused and keeps secondary metrics and tools available', async ({ page }) => {
  const errors = collectErrors(page);
  await openShell(page, 'analyst', '?crew=0');
  const frame = await viewFrame(page, 'analyst');
  const frameElement = page.locator('#v-analyst iframe');
  await frame.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await expect(frame.locator('#top .who')).toBeHidden();
  await expect(frame.locator('.mc-hide-data-section')).toHaveCount(2);
  const hiddenAdminLinks = frame.locator('a,button,[role="link"],[role="button"],[role="menuitem"]')
    .filter({ hasText: /^(Users & access|Users and access|Audit log)$/ });
  await expect(hiddenAdminLinks).toHaveCount(2);
  await expect(hiddenAdminLinks.nth(0)).toBeHidden();
  await expect(hiddenAdminLinks.nth(1)).toBeHidden();
  await frame.evaluate(() => (window as any).go('home'));

  const home = frame.locator('#main .pg');
  await expect(home).toHaveClass(/mc-dashboard/);
  await expect(home.locator('.pg-h h1')).toHaveText('Season overview');
  await expect(frame.locator('#top .who')).toBeHidden();
  await expect(home.locator('> .kpis > .kpi')).toHaveCount(4);
  const extras = home.locator('.mc-platform-metrics');
  await expect(extras.locator('summary')).toContainText('2 additional indicators');
  await expect(extras.locator('.kpi')).toHaveCount(2);
  await expect(extras.locator('.kpi').first()).toBeHidden();
  await extras.locator('summary').click();
  await expect(extras.locator('.kpi').first()).toBeVisible();

  const tools = home.locator('.mc-dashboard-tools');
  await expect(tools.locator('summary')).toContainText('Explore analysis tools');
  await expect(tools.locator('.mc-tool')).toHaveCount(6);
  await expect(tools.locator('.mc-tool').first()).toBeHidden();
  await tools.locator('summary').click();
  await expect(tools.locator('.mc-tool').first()).toBeVisible();
  expect(await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('#080809');
  await extras.evaluate((el) => { (el as HTMLDetailsElement).open = false; });
  await tools.evaluate((el) => { (el as HTMLDetailsElement).open = false; });
  const dir = process.env.ANALYST_DASHBOARD_SCREENSHOTS_DIR;
  if (dir) for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await frame.locator('#main').evaluate((el) => { el.scrollTop = 0; });
    await frameElement.screenshot({ path: `${dir}/overview-${width}.png` });
  }
  expect(errors).toEqual([]);
});
