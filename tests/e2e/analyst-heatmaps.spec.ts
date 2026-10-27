import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// Match centre, Heatmaps tab: team heatmaps, a player picker, time in zone and stay, all from the tracking frames.
async function openMatchCentre(page: Page) {
  await openShell(page, 'analyst', '?crew=0');
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await f.evaluate(() => (window as any).go('match'));
  return f;
}

test('analyst heatmaps: team and player maps with zone shares that add up', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openMatchCentre(page);
  await f.locator('.tabs [role=tab]', { hasText: 'Heatmaps' }).click();
  await expect(f.locator('#hm-teams svg')).toHaveCount(2);
  await expect(f.locator('#hm-sel')).toBeVisible();
  const shares = await f.locator('#hm-zones td[data-pct]').evaluateAll((tds) => tds.map((td) => Number((td as HTMLElement).dataset.pct)));
  expect(shares).toHaveLength(9);
  expect(Math.abs(shares.reduce((a, b) => a + b, 0) - 100)).toBeLessThan(1.5);
  const second = f.locator('#hm-sel option').nth(5);
  const name = await second.getAttribute('data-name');
  await f.locator('#hm-sel').selectOption({ index: 5 });
  await expect(f.locator('#hm-head')).toHaveText(name ?? '');
  expect(errs).toEqual([]);
});
