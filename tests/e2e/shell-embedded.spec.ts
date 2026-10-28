import { test, expect } from './fixtures';

test('the Broadcast embed uses the shell match header and keeps its desk tabs', async ({ page }) => {
  await page.goto('/index.html#broadcast', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.frames().some((frame) => /broadcast\/index\.html/.test(frame.url())), { timeout: 60_000 }).toBe(true);
  const desk = page.frames().find((frame) => /broadcast\/index\.html/.test(frame.url()))!;
  await expect(desk.locator('.bc-top')).toBeHidden();
  await expect(desk.locator('#bc-tabs')).toBeVisible();
});
