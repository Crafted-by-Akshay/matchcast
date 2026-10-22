import { test, expect } from '@playwright/test';
import { collectErrors, openShell, viewFrame } from './helpers';

// Broadcast draws the same action poses as Watch: Watch's frames carry each player's current action and Broadcast applies it.
const tab = (page: import('@playwright/test').Page, v: string) => page.evaluate((x) => document.getElementById('tab-' + x)!.click(), v);

test('a player action in Watch shows as the same pose in Broadcast', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  const w = await viewFrame(page, 'watch');
  await expect.poll(() => w.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await w.evaluate(() => { const m = (window as any).__mc; m.S.paused = true; m.players[5].act = { type: 'header', t: 0.2, dur: 0.75, h: 0.5 }; m.players[9].act = { type: 'slide', t: 0.3, dur: 1.5, side: 1 }; });
  await tab(page, 'broadcast');
  const b = await viewFrame(page, 'broadcast');
  await expect.poll(() => b.evaluate(() => { const m = (window as any).__mc; return !!m?.S.started && m.players[5].act?.type === 'header'; }), { timeout: 240_000 }).toBe(true);
  expect(await b.evaluate(() => (window as any).__mc.players[9].act?.type)).toBe('slide');
  // Watch's player is idle again: Broadcast drops the pose
  await w.evaluate(() => { const m = (window as any).__mc; m.players[5].act = null; m.players[9].act = null; });
  await expect.poll(() => b.evaluate(() => (window as any).__mc.players[5].act), { timeout: 20_000 }).toBeNull();
  expect(errs).toEqual([]);
});
