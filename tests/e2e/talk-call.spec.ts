import { test, expect } from './fixtures';
import { openShell, ready, viewFrame } from './helpers';

// Talk: the Pulse log steps aside while the Copilot drawer, with its Talk input, is open. The Call button is frozen behind
// CALL_ENABLED in embed/watch.js for this release, so it must not show.
test('the pulse log steps aside under the Talk input, and the frozen call button is absent', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await f.locator('#cpbtn').click();
  await f.locator('#cp-tabs button[data-t="talk"]').click();
  await f.locator('#tk-roster button:not([disabled])').nth(1).click();   // the talk input opens once a player is picked
  await expect(f.locator('#mcx-box')).toBeHidden();
  await expect(f.locator('#tk-call')).toHaveCount(0);
});
