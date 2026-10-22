import { test, expect } from '@playwright/test';
import { openShell } from './helpers';

// EXP-15: a view that cannot start says why, and a slow start offers a reload instead of a spinner for ever.
test('loading: without WebGL, Watch says so at once and Analyst still opens', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t: string, ...a: any[]) { return /webgl/.test(t) ? null : (get as any).call(this, t, ...a); } as any;
  });
  await openShell(page, 'watch');
  const wait = page.locator('#v-watch .wait');
  await expect(wait).toContainText('needs WebGL', { timeout: 10_000 });
  await expect(wait.locator('.bar')).toBeHidden();
  await page.click('#tab-agents');
  await expect(page.locator('#v-agents')).toBeVisible();
});

test('loading: a slow start shows a note and a working reload button', async ({ page }) => {
  await page.addInitScript(() => { (window as any).MC_SLOW_MS = 1500; });
  await page.route('**/watch/index.html*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stuck</body></html>' }));
  await openShell(page, 'watch');
  const wait = page.locator('#v-watch .wait');
  await expect(wait).toContainText('Still loading', { timeout: 15_000 });
  const btn = wait.getByRole('button', { name: 'Reload this view' });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(wait).toContainText('Loading again');
  await expect(btn).toHaveCount(0);
});
