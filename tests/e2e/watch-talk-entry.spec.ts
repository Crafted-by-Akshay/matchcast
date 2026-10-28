import { test, expect } from './fixtures';
import { openShell, ready, viewFrame } from './helpers';

// Talk lives in Copilot so a second floating button does not crowd the pitch.
for (const [name, width, height] of [['desktop', 1440, 900], ['laptop', 1024, 768], ['phone', 390, 844]] as const) {
  test(`Watch on ${name}: Copilot owns the Talk entry`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height });
    await openShell(page, 'watch');
    await ready('watch')(page);
    const f = await viewFrame(page, 'watch');
    await expect(f.locator('#mcx-talk')).toBeHidden();
    await expect(f.locator('#cpbtn')).toBeVisible({ timeout: 60_000 });
    await f.locator('#cpbtn').click();
    await expect(f.locator('#copilot')).toBeVisible();
    await expect(f.getByRole('tab', { name: 'Ask' })).toHaveAttribute('aria-selected', 'true');
    await f.locator('#cp-tabs [data-t="talk"]').click();
    await expect(f.locator('#tk-roster')).toBeVisible();
  });
}
