import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// UX review 2026-10-24, finding 1: at 390 px the Vision panel covered the pitch and the camera chips. Now the tracker runs with the panel closed;
// the Vision button and the panel's close button only show or hide the panel. The toast sits under the story row, clear of the brand and of the controls at the bottom of the view.
test('Watch at 390 px: the Vision panel starts closed, the tracker runs, the button opens and closes the panel', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await f.waitForFunction(() => !!(window as any).__mc?.vis?.VIS?.on, null, { timeout: 60_000 });
  await expect(f.locator('#visp')).toBeHidden();
  await f.locator('#visb').click();
  await expect(f.locator('#visp')).toBeVisible();
  expect(await f.evaluate(() => (window as any).__mc.vis.VIS.on), 'opening the panel leaves the tracker on').toBe(true);
  await f.locator('#visp-x').click();
  await expect(f.locator('#visp')).toBeHidden();
  expect(await f.evaluate(() => (window as any).__mc.vis.VIS.on), 'closing the panel leaves the tracker on').toBe(true);
  await expect(f.locator('#fan-strip')).toBeHidden();   // the stats strip no longer sits under the Match Pulse bar
  await page.evaluate(() => { const t = document.getElementById('toast')!; t.textContent = 'Shared match: Harbor City v Thames Rovers'; t.classList.add('on'); });
  const g = await page.evaluate(() => {
    const t = document.getElementById('toast')!.getBoundingClientRect(), s = document.getElementById('story')!.getBoundingClientRect(), h = document.querySelector('header')?.getBoundingClientRect();
    return { top: t.top, storyBottom: s.bottom, headerBottom: h ? h.bottom : 0, bottom: t.bottom, vh: innerHeight };
  });
  expect(g.top, 'under the story row, not over the brand or the utility chips').toBeGreaterThanOrEqual(g.storyBottom);
  expect(g.top, 'under the header').toBeGreaterThanOrEqual(g.headerBottom);
  expect(g.top, 'in the top half, well above the bottom controls').toBeLessThan(g.vh / 2);
  expect(errs).toEqual([]);
});
