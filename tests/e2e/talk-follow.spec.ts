import { test, expect } from './fixtures';
import { openShell, ready, viewFrame } from './helpers';

// Talk: picking a player in the talk roster follows him with the camera (Watch's player mode).
test('picking a player in talk follows him with the camera', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await f.locator('#cpbtn').click();
  await f.locator('#cp-tabs button[data-t="talk"]').click();
  const picked = f.locator('#tk-roster button:not([disabled])').nth(1);
  const surname = await picked.locator('span').innerText();
  await picked.click();
  await expect.poll(() => f.evaluate(() => (window as any).__mc.S.cam)).toBe('player');
  await expect.poll(() => f.evaluate(() => (window as any).__mc.S.follow?.name ?? '')).toContain(surname);
});
