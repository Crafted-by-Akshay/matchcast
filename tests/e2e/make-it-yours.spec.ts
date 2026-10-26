import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// Make it yours: the Watch mode panel says what the viewer is watching, and the choice it names is the one Watch uses.

async function openMatch(page: Page): Promise<Frame> {
  await openShell(page, 'watch');
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && document.getElementById('load')!.hidden)).catch(() => false), { timeout: 240_000, message: 'Watch never finished loading' }).toBe(true);
  await f.evaluate(() => (document.getElementById('kick') as HTMLElement).click());
  await expect(f.locator('#fan-chip')).toBeVisible({ timeout: 60_000 });
  return f;
}

test('Make it yours: the mode panel names the viewer\'s choice and follows each change', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await openMatch(page);
  if (await f.evaluate(() => (document.getElementById('fan-pop') as HTMLElement).hidden)) await f.click('#fan-chip');

  await expect(f.locator('#fan-pop .fm-h')).toContainText('Make it yours');
  const now = f.locator('#fan-pop .fm-now');
  await expect(now).toContainText('Analyst');

  await f.click('#fan-pop .fm-b[data-m="metric"]');
  await expect(now).toContainText('One metric');
  await expect(now).toContainText('xG');

  await f.click('#fan-pop .fm-b[data-m="club"]');
  await f.click('#fan-pop .fm-c[data-c="1"]');
  await expect(now).toContainText('My club');
  await expect(now).toContainText('Brazil');
  expect(errs).toEqual([]);
});
