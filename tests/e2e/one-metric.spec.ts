import { test, expect, type Frame, type Page } from './fixtures';
import { openShell, viewFrame } from './helpers';

async function openWatch(page: Page): Promise<Frame> {
  await openShell(page, 'watch');
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && document.getElementById('load')!.hidden)).catch(() => false), { timeout: 240_000, message: 'Watch never finished loading' }).toBe(true);
  return f;
}

test('specialist persona controls are hidden; Fan and Analyst remain the only audience choices', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await openWatch(page);
  await expect(f.locator('#fan-chip')).toBeHidden();
  await expect(f.locator('#fan-pop')).toBeHidden();
  await expect(f.locator('#fan-intro')).toBeHidden();
  await expect(f.locator('#fan-metric')).toBeHidden();
  const audience = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(audience.getByRole('radio')).toHaveCount(2);
  await expect(audience.getByRole('radio').nth(0)).toHaveText('Fan');
  await expect(audience.getByRole('radio').nth(1)).toHaveText('Analyst');
});

test('a saved specialist mode migrates to a supported audience', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => localStorage.setItem('mcx-mode', JSON.stringify({ mode: 'metric', club: 0, metric: 'speed', lang: 'en', player: null })));
  const f = await openWatch(page);
  await expect.poll(() => f.evaluate(() => (window as any).__mc.fan.state.mode)).toBe('analyst');
  await expect(f.getByRole('radio', { name: 'Analyst', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('audience choices keep the selected commentary language and saved mode in sync', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await openWatch(page);
  await page.locator('#lang-pick').selectOption('es');
  await expect.poll(() => f.evaluate(() => (window as any).__mc.fan.state.lang)).toBe('es');
  for (const [name, mode] of [['Analyst', 'analyst'], ['Fan', 'casual']] as const) {
    const radio = f.getByRole('radio', { name, exact: true });
    await radio.click();
    await expect(radio).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => f.evaluate(() => (window as any).__mc.fan.state.mode)).toBe(mode);
    await expect.poll(() => f.evaluate(() => JSON.parse(localStorage.getItem('mcx-mode') || '{}').mode)).toBe(mode);
    await expect.poll(() => f.evaluate(() => (window as any).__mc.fan.state.lang)).toBe('es');
  }
});
