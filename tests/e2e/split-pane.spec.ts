import { test, expect } from './fixtures';

// ADR-0019: Watch can optionally show a side-by-side comparison. Production Studio opens alone to avoid confusing dual previews.

test('with the Broadcast desk asked for (?split=1) it sits beside the live match', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/index.html?split=1#watch', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#stage')).toHaveClass(/split/);
  await expect(page.locator('#v-watch')).toBeVisible();
  await expect(page.locator('#v-broadcast')).toBeVisible();
  await expect(page.locator('#split-bar')).toBeVisible();
  await expect(page.locator('#v-analyst')).toBeHidden();
});

test('the divider resizes the panes, stays within bounds, and is kept per viewer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/index.html?split=1#watch', { waitUntil: 'domcontentloaded' });
  const bar = page.locator('#split-bar');
  await expect(bar).toBeVisible();
  const before = await page.locator('#v-watch').evaluate((el) => el.getBoundingClientRect().width);
  await bar.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  const after = await page.locator('#v-watch').evaluate((el) => el.getBoundingClientRect().width);
  expect(after, 'the arrow keys narrow the Watch pane').toBeLessThan(before);
  for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowLeft');
  const floor = await page.locator('#v-watch').evaluate((el) => el.getBoundingClientRect().width);
  expect(floor / 1280, 'the Watch pane stops at 25 percent').toBeGreaterThanOrEqual(0.24);
  expect(await bar.getAttribute('aria-valuenow')).toBe('25');
  const saved = await page.evaluate(() => localStorage.getItem('mc.split'));
  expect(Number(saved)).toBeCloseTo(0.25, 2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#split-bar')).toHaveAttribute('aria-valuenow', '25');
});

test('a drag with the pointer resizes the split', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/index.html?split=1#watch', { waitUntil: 'domcontentloaded' });
  const bar = page.locator('#split-bar');
  const box = await bar.boundingBox();
  if (!box) throw new Error('the divider has no box');
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const value = Number(await bar.getAttribute('aria-valuenow'));
  expect(value).toBeLessThan(58);
  expect(value).toBeGreaterThanOrEqual(25);
});

test('a phone shows one view at a time, with no divider and no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html#broadcast', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#stage')).not.toHaveClass(/split/);
  await expect(page.locator('#v-broadcast')).toBeVisible();
  await expect(page.locator('#v-watch')).toBeHidden();
  await expect(page.locator('#split-bar')).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Watch opens alone; Studio opens alone too; ?split=1 only adds a comparison beside Watch', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/index.html#watch', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#v-watch')).toBeVisible();
  await expect(page.locator('#v-broadcast'), 'the desk is not shown on the first screen').toBeHidden();
  expect(await page.locator('#v-broadcast iframe').count(), 'no second 3D view is loaded until asked').toBe(0);
  await expect(page.locator('#bc-toggle'), 'the second 3D view is off the first screen for the sprint (AB#497)').toBeHidden();
  await page.goto('/index.html?split=1#watch', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await expect(page.locator('#stage')).toHaveClass(/split/);
  await expect(page.locator('#v-broadcast')).toBeVisible();
  expect(await page.locator('#v-broadcast iframe').count()).toBe(1);
  await page.locator('.switch [data-view="broadcast"]').click();
  await expect(page.locator('#v-broadcast')).toBeVisible();
  await expect(page.locator('#v-watch')).toBeHidden();
  await expect(page.locator('#stage')).not.toHaveClass(/split/);
  await expect(page.locator('#v-watch iframe'), 'Watch stays loaded as the hidden source for the Studio preview').toHaveCount(1);
});
