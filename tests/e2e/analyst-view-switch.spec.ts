import { test, expect } from './fixtures';
import { openShell, viewFrame } from './helpers';

test('Analyst switches between the match overview and full analysis', async ({ page }) => {
  await openShell(page, 'analyst', '?crew=1');
  const overview = page.locator('#v-analyst #al');
  await expect(overview).toBeVisible();
  const switcher = page.locator('#v-analyst .view-switch');
  await expect(switcher.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true');
  await expect(switcher.getByRole('button', { name: 'Full analysis' })).toHaveAttribute('aria-pressed', 'false');

  await switcher.getByRole('button', { name: 'Full analysis' }).click();
  const frame = await viewFrame(page, 'analyst');
  await expect(page.locator('#v-analyst #al')).toBeHidden();
  await expect(page.locator('#v-analyst #al-bar .view-switch [data-mode="full"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(frame.locator('.mc-hide-data-section')).toHaveCount(2);
  await expect(frame.locator('a,button,[role="link"],[role="button"],[role="menuitem"]')
    .filter({ hasText: /^(Users & access|Users and access|Audit log)$/ })).toHaveCount(2);
  await expect(frame.locator('.mc-hide-nav-entry').first()).toBeHidden();

  const screenshotDir = process.env.ANALYST_SWITCH_SCREENSHOTS_DIR;
  if (screenshotDir) {
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('#v-analyst').screenshot({ path: `${screenshotDir}/full-analysis-${width}.png` });
      await page.locator('#v-analyst #al-bar [data-mode="overview"]').click();
      await expect(overview).toBeVisible();
      await page.locator('#v-analyst').screenshot({ path: `${screenshotDir}/overview-${width}.png` });
      await page.locator('#v-analyst #al .view-switch [data-mode="full"]').click();
      await expect(page.locator('#v-analyst #al-bar')).toBeVisible();
    }
  }

  await page.locator('#v-analyst #al-bar .view-switch [data-mode="overview"]').click();
  await expect(overview).toBeVisible();
  await expect(page.locator('#v-analyst #al .view-switch [data-mode="overview"]')).toHaveAttribute('aria-pressed', 'true');
});
