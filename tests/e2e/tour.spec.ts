import { test, expect } from '@playwright/test';
import { openShell } from './helpers';

// First-time tour: opens from the Tour button or ?tour=1, never by itself; each step shows its view; Esc and Close leave it.
test('tour: the button opens a five-step guide that switches views, and Escape closes it', async ({ page }) => {
  await openShell(page, 'watch');
  await expect(page.locator('#tour')).not.toBeVisible();   // never opens by itself
  await page.click('#tour-btn');
  const d = page.locator('#tour');
  await expect(d).toBeVisible();
  await expect(d).toContainText('Step 1 of 5');
  await expect(page.locator('#tour-back')).toBeHidden();
  await page.click('#tour-go');
  await expect(d).toContainText('Step 2 of 5');
  await expect(page.locator('#v-agents')).toBeVisible();
  await page.click('#tour-go'); await expect(d).toContainText('Broadcast');
  await page.click('#tour-back'); await expect(d).toContainText('Step 2 of 5');
  for (let i = 0; i < 3; i++) await page.click('#tour-go');
  await expect(d).toContainText('Step 5 of 5');
  await expect(page.locator('#tour-go')).toHaveText('Done');
  await page.click('#tour-go');
  await expect(d).not.toBeVisible();
  await page.click('#tour-btn');
  await page.keyboard.press('Escape');
  await expect(d).not.toBeVisible();
});

test('tour: ?tour=1 opens it, and number keys do not switch views while it is open', async ({ page }) => {
  await openShell(page, 'watch', '?tour=1');
  await expect(page.locator('#tour')).toBeVisible();
  await page.keyboard.press('3');
  await expect(page.locator('#v-watch')).toBeVisible();
});
