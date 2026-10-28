import { test, expect } from './fixtures';
import { mkdirSync } from 'node:fs';
import { openShell, ready, viewFrame } from './helpers';

test('Production Studio opens alone with a quiet preview and progressive production controls', async ({ page }) => {
  test.setTimeout(420_000);
  const dir = process.env.PRODUCTION_STUDIO_SCREENSHOTS_DIR;
  if (dir) mkdirSync(dir, { recursive: true });

  await openShell(page, 'broadcast');
  const frame = await viewFrame(page, 'broadcast');
  await ready('broadcast')(page);
  await expect(page.locator('#v-broadcast')).toBeVisible();
  await expect(page.locator('#v-watch')).toBeHidden();
  await expect(page.locator('#split-bar')).toBeHidden();
  await expect(frame.locator('#mc-pitch')).toHaveText('Match preview · follows Watch');
  await expect(frame.locator('#mc-desk-hide')).toHaveText('Production tools');
  await expect(frame.locator('#mc-desk-body')).toBeHidden();
  await expect(frame.locator('#mc-onair-export')).toBeHidden();

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect.poll(() => frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (dir) await page.screenshot({ path: `${dir}/studio-${width}.png` });
  }

  await frame.locator('#mc-desk-hide').click();
  await expect(frame.locator('#mc-desk-hide')).toHaveText('Hide tools');
  await expect(frame.locator('#mc-desk-body')).toBeVisible();
  await expect(frame.locator('#mc-producer')).toBeVisible();
  await expect(frame.locator('#mc-cop')).toBeVisible();
  await expect(frame.locator('#mc-onair-export')).toBeVisible();
  await expect(frame.locator('#mc-lens-more')).toBeHidden();
  await frame.locator('#mc-cop [data-cop="focus"]').click();
  // Read rendered text: inline scripts include the internal filename by design.
  await expect.poll(() => frame.locator('body').innerText()).not.toContain('predict.js');
  await frame.locator('#mc-desk-hide').click();
  await expect(frame.locator('#mc-desk-body')).toBeHidden();
  await expect(frame.locator('#mc-desk-hide')).toHaveAttribute('aria-expanded', 'false');

  await page.locator('#more-toggle').click();
  await expect(page.locator('#tab-agents,#crew-btn')).toHaveCount(0);
});
