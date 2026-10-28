import { test, expect } from './fixtures';

// FIX-07 (AB#373): the analyst console's Watch links point at the Watch app beside it, not at an external artifact.
test('analyst: every Watch link points at the Watch app beside the console, and no claude.ai artifact link remains', async ({ page }) => {
  await page.goto('/analyst/index.html', { waitUntil: 'commit' });
  await expect(page.locator('a[href="../watch/index.html"]').first()).toBeAttached();
  const hrefs = await page.locator('a[href*="watch"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const h of hrefs) expect(h).toBe('../watch/index.html');
  await expect(page.locator('a[href*="claude.ai/artifact"]')).toHaveCount(0);
});
