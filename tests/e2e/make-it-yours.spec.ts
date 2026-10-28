import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

async function openMatch(page: Page): Promise<Frame> {
  await openShell(page, 'watch');
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && document.getElementById('load')!.hidden)).catch(() => false), { timeout: 240_000, message: 'Watch never finished loading' }).toBe(true);
  await f.evaluate(() => (document.getElementById('kick') as HTMLElement).click());
  await expect(f.locator('#mc-feedpick')).toBeVisible({ timeout: 60_000 });
  return f;
}

test('Watch offers only Fan and Analyst as audience choices', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await openMatch(page);
  await expect(f.locator('#fan-chip')).toBeHidden();
  await expect(f.locator('#fan-pop')).toBeHidden();
  const audience = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(audience.getByRole('radio')).toHaveCount(2);
  await expect(audience.getByRole('radio').nth(0)).toHaveText('Fan');
  await expect(audience.getByRole('radio').nth(1)).toHaveText('Analyst');
  await audience.getByRole('radio', { name: 'Analyst' }).click();
  await expect.poll(() => f.evaluate(() => document.body.classList.contains('fm-casual'))).toBe(false);
  await audience.getByRole('radio', { name: 'Fan' }).click();
  await expect.poll(() => f.evaluate(() => document.body.classList.contains('fm-casual'))).toBe(true);
  expect(errs).toEqual([]);
});
