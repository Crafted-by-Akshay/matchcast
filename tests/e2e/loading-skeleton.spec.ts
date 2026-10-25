import { test, expect } from './fixtures';
import { openShell } from './helpers';

// UX review 2026-10-24, finding 8: a slow 3D load shows what is coming (score bar, pitch, moments, commentary) instead of an empty loader.
test('Watch and Broadcast show a labelled skeleton while the 3D engine loads', async ({ page }) => {
  await page.route(/\/(watch|broadcast)\/index\.html/, (r) => r.abort());   // the view never loads, so the loader stays up
  await openShell(page, 'watch');
  const w = page.locator('#v-watch .wait .sk');
  await expect(w).toBeVisible();
  await expect(w).toContainText('3D pitch');
  await expect(w).toContainText('Match Pulse and key moments');
  await expect(page.locator('#v-watch .wait')).toContainText('Starting Watch');
  await expect(w).toHaveAttribute('aria-hidden', 'true');
  expect(await page.locator('#v-broadcast .wait .sk').count()).toBe(1);
  expect(await page.locator('#v-broadcast .wait .sk').textContent()).toContain('Commentary feed and the Broadcast Copilot');
});
