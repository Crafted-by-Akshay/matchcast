import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// UX review pass 3: on a 1440 px desktop the Match Pulse control line must not run into its label, and the HUD panels must be opaque
// enough that player name labels do not show through them.
test('Watch at 1440 px: the Match Pulse control line does not overlap its label and the panels are opaque', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await f.waitForSelector('#px-ctlv', { state: 'visible', timeout: 60_000 });
  const m = await f.evaluate(() => {
    const k = document.querySelector('#px-body .px-k')!.getBoundingClientRect(), v = document.getElementById('px-ctlv')!.getBoundingClientRect();
    const overlap = k.left < v.right && v.left < k.right && k.top < v.bottom && v.top < k.bottom;
    const alpha = Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(getComputedStyle(document.documentElement).getPropertyValue('--panel'))?.[1] ?? 1);
    return { overlap, alpha };
  });
  expect(m.overlap, 'CONTROL · CHAOS and the control value share no pixels').toBe(false);
  expect(m.alpha).toBeGreaterThanOrEqual(0.95);
  expect(errs).toEqual([]);
});
