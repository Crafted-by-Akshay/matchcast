import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// Live commentary remains legible against the match; hidden diagnostics do not enter the viewer.
test('Watch at 1440 px: commentary is opaque and the diagnostic panel stays hidden', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect(f.locator('#mcf')).toBeVisible();
  await expect(f.locator('#pulse')).toBeHidden();
  const card = await f.evaluate(() => {
    const e = document.getElementById('mcf')!;
    const color = getComputedStyle(e).backgroundColor;
    const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(color);
    const r = e.getBoundingClientRect();
    return { alpha: alpha ? Number(alpha[1]) : 1, left: r.left, right: r.right, width: innerWidth };
  });
  expect(card.alpha, 'live commentary has an opaque background').toBe(1);
  expect(card.left).toBeGreaterThanOrEqual(0);
  expect(card.right).toBeLessThanOrEqual(card.width);
  expect(errs).toEqual([]);
});
