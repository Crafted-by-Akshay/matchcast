import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// Analyst page What if: a paired re-run of N001 (Argentina v Brazil) on a top-down pitch, with play, pause, scrub, a view toggle and the outcome.
async function openWhatIf(page: Page) {
  await openShell(page, 'analyst', '?crew=0');
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await f.evaluate(() => (window as any).go('whatif'));
  return f;
}

test('analyst what-if: a paired re-run plays on the pitch and says it is a simulated estimate', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openWhatIf(page);
  await expect(f.locator('#wi-clip option').first()).toBeAttached({ timeout: 60_000 });
  await expect(f.locator('#wi-body circle[id^="wi-L-"]')).toHaveCount(22);
  await expect(f.locator('#wi-body circle[id^="wi-R-"]')).toHaveCount(22);
  const start = await f.locator('#wi-time').textContent();
  await f.locator('#wi-play').click();
  await expect(f.locator('#wi-time')).not.toHaveText(start ?? '');
  await f.locator('#wi-play').click();
  await expect(f.locator('#wi-play')).toHaveText('Play');
  await f.locator('#wi-view').selectOption('over');
  await expect(f.locator('#wi-body svg')).toHaveCount(1);
  await expect(f.locator('#pg')).toContainText('Simulated estimates, not facts');
  expect(errs).toEqual([]);
});
