import { test, expect } from './fixtures';
import { openShell, ready, viewFrame } from './helpers';

test('Watch keeps one live caption, the six-feed picker and a focused Copilot', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');

  await expect(f.locator('#mcf')).toBeVisible();
  await expect(f.locator('#pulse')).toBeHidden();
  await expect(f.locator('#mcx-box')).toBeHidden();
  await expect(f.locator('#cap')).toBeHidden();
  await expect(f.locator('#mc-two')).toBeHidden();
  await expect(f.locator('#mc-trust')).toBeHidden();
  await expect(f.locator('#mcx-talk')).toBeHidden();
  await expect(f.locator('#mcf-sound')).toBeHidden();
  await expect(f.locator('#fan-chip')).toBeHidden();

  const audience = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(audience.getByRole('radio')).toHaveCount(6);   // all six feeds are live and selectable (AB#450, #482)
  await expect(audience.getByRole('radio').nth(0)).toHaveText('Fan');
  await expect(audience.getByRole('radio').nth(1)).toHaveText('Analyst');
  await audience.getByRole('radio', { name: 'Fan' }).click();
  await expect.poll(() => f.evaluate(() => document.body.classList.contains('fm-casual'))).toBe(true);
  await audience.getByRole('radio', { name: 'Analyst' }).click();
  await expect.poll(() => f.evaluate(() => !document.body.classList.contains('fm-casual'))).toBe(true);

  await f.locator('#cpbtn').click();
  await expect(f.locator('#copilot')).toBeVisible();
  const tabs = f.locator('#cp-tabs [role="tab"]');
  expect(await tabs.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.t))).toEqual(['ask', 'ins', 'tac', 'talk', 'verify']);
  await expect(f.getByRole('tab', { name: 'Ask' })).toHaveAttribute('aria-selected', 'true');
  await expect(f.locator('#copilot .agents')).toBeHidden();
  await expect(f.locator('#cp-tabs')).toBeVisible();
  await expect(f.getByRole('button', { name: 'Ask the Verifier for a verdict' })).toBeHidden();
});
