import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// Pipeline processing remains active but its implementation stages are not viewer navigation.
test('Analyze keeps the processing strip out of the viewer interface', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShell(page, 'analyst');
  await expect(page.locator('#story')).toBeHidden();
  await expect(page.getByRole('button', { name: /[1-5] (Ingest|Interpret|Explain|Render|Personalise)/ })).toHaveCount(0);
});

test('Watch offers Fan and Analyst commentary without extra persona controls', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect(page.locator('.story-who')).toHaveCount(0);
  await expect(f.locator('#fan-chip')).toBeHidden();
  await expect(f.locator('#fan-pop')).toBeHidden();
  const audience = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(audience.getByRole('radio')).toHaveCount(2);
  await audience.getByRole('radio', { name: 'Analyst' }).click();
  await expect.poll(() => f.evaluate(() => !document.body.classList.contains('fm-casual'))).toBe(true);
  await audience.getByRole('radio', { name: 'Fan' }).click();
  await expect.poll(() => f.evaluate(() => document.body.classList.contains('fm-casual'))).toBe(true);
  expect(errs).toEqual([]);
});

test('on a phone the duplicate Viewing as row is removed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openShell(page, 'analyst');
  await expect(page.locator('#story ol')).toBeHidden();
  await expect(page.locator('#st-demo')).toBeHidden();
  await expect(page.locator('.story-who')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('the shell leaves saved mode selection to Watch without displaying processing controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => { try { localStorage.setItem('mcx-mode', JSON.stringify({ mode: 'casual' })); } catch (e) { /* storage blocked */ } });
  await page.goto('/index.html?foo=1#analyst', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await expect(page.locator('.story-who')).toHaveCount(0);
  await expect(page.locator('#story')).not.toContainText('Viewing as');
  await expect(page.locator('#story')).toBeHidden();
});

test('a season load error is readable on a 1280 px desktop, not an ellipsis', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/shared/fixtures.json*', (r) => r.abort());
  await page.goto('/index.html#watch', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#meta')).toContainText('Could not load the season fixtures');
  const m = await page.locator('#meta').evaluate((e) => ({ c: e.clientWidth, s: e.scrollWidth }));
  expect(m.s, 'the error text is not clipped').toBeLessThanOrEqual(m.c + 1);
});
