import { test, expect } from './fixtures';
import { openShell, ready, viewFrame } from './helpers';

// Talk call: a Call button sits beside the mic and starts a call (or says why it cannot), and the Pulse log steps aside
// while the Copilot drawer, with its Talk input, is open.
test('talk has a call button, and the pulse log steps aside under the Talk input', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await f.locator('#cpbtn').click();
  await f.locator('#cp-tabs button[data-t="talk"]').click();
  await f.locator('#tk-roster button:not([disabled])').nth(1).click();   // the talk input opens once a player is picked
  const call = f.locator('#tk-call');
  await expect(call).toHaveText('Call');
  await expect(f.locator('#mcx-box')).toBeHidden();
  await call.click();
  // the browser may refuse the mic or have no speech recognition; either way the note says what is happening
  await expect.poll(() => f.locator('#tk-note').innerText(), { timeout: 15_000 }).toMatch(/Call|mic/);
});
