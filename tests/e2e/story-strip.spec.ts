import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// UX review 2026-10-24, finding 10: the five stages of the challenge (ingest, interpret, explain, render, personalise) and the
// Fan v Analyst difference are on screen, and the switch really changes Watch's mode.
test('the story strip names the five stages in order and starts waiting for kick-off', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShell(page, 'analyst');
  const heads = await page.$$eval('#story b', (bs) => bs.map((b) => b.textContent));
  expect(heads).toEqual(['1 Ingest', '2 Interpret', '3 Explain', '4 Render', '5 Personalise']);
  await expect(page.locator('#st-1 span')).toHaveText('waiting for kick-off');
  await expect(page.locator('#st-4 span')).toHaveText('Analyst: console');
  await expect(page.locator('#st-demo')).toBeVisible();   // the strip offers the quick-pace demo
  await expect(page.locator('#st-demo')).toHaveAttribute('href', /seed=2026&speed=4#watch$/);
  await page.locator('#st-2 button').click();
  await expect(page).toHaveURL(/#agents$/);
  await expect(page.locator('#st-4 span')).toHaveText('3D in Watch and Broadcast');
});

test('the Fan and Analyst switch sets Watch\'s mode and follows it back', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  const fan = page.locator('.story-who [data-persona=casual]'), analyst = page.locator('.story-who [data-persona=analyst]');
  await expect(analyst).toHaveAttribute('aria-pressed', 'true');
  await fan.click();
  await expect(fan).toHaveAttribute('aria-pressed', 'true');
  await expect(analyst).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => f.evaluate(() => document.body.classList.contains('fm-casual'))).toBe(true);
  // the viewer picks a club inside Watch: the shell says what it is showing instead of lighting Fan or Analyst
  if (await f.evaluate(() => (document.getElementById('fan-pop') as HTMLElement).hidden)) await f.click('#fan-chip');
  await f.click('.fm-b[data-m="club"]');
  await expect(page.locator('#st-who')).toContainText('Showing: club');
  await expect(fan).toHaveAttribute('aria-pressed', 'false');
  expect(errs).toEqual([]);
});

test('the strip is hidden on a phone, where the match gets the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openShell(page, 'analyst');
  await expect(page.locator('#story')).toBeHidden();
});

test('Demo at 4x reloads Watch at four times speed and the strip then drops the button', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShell(page, 'watch');
  await page.locator('#st-demo').click();
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await f.waitForFunction(() => (window as any).__mc.S.started === true, null, { timeout: 60_000 });
  expect(await f.evaluate(() => (window as any).__mc.S.speed)).toBe(4);
  await expect(page.locator('#st-demo')).toBeHidden();
  await expect.poll(() => page.locator('#st-1 span').textContent(), { timeout: 60_000 }).toMatch(/\d+ events/);
});
