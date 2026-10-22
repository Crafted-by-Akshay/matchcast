import { test, expect } from '@playwright/test';
import { openShell, viewFrame } from './helpers';

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

test('tour: ?tour=1 opens it, and number keys never switch views while it is open, even after Back loses focus', async ({ page }) => {
  await openShell(page, 'watch', '?tour=1');
  const d = page.locator('#tour');
  await expect(d).toBeVisible();
  await expect(page.locator('#tour-go')).toBeFocused();   // Enter goes to Next, not Close
  await page.click('#tour-go');
  await page.click('#tour-back');                         // Back hides itself, so focus falls to the page
  await expect(d).toContainText('Step 1 of 5');
  await page.keyboard.press('3');
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  expect(await page.evaluate(() => location.hash)).toBe('#watch');
  await expect(d).toContainText('Step 1 of 5');
});

test('shortcuts: keys 1 to 4 pressed inside a view switch the shell view', async ({ page }) => {
  await page.route('**/watch/index.html*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body><input id="n"><button id="b">x</button></body></html>' }));
  await openShell(page, 'watch');
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => document.readyState)).toBe('complete');
  await f.locator('#b').focus();
  await page.keyboard.press('4');
  await expect(page.locator('#v-agents')).toBeVisible();
  await page.goto('/index.html#watch');
  const g = await viewFrame(page, 'watch');
  await expect.poll(() => g.evaluate(() => document.readyState)).toBe('complete');
  await g.locator('#n').focus();
  await page.keyboard.press('2');                          // typing in a field inside the view is left alone
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  expect(await page.evaluate(() => location.hash)).toBe('#watch');
});
