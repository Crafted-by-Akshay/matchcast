import { test, expect } from './fixtures';
import { openShell } from './helpers';

// EXP-15: a view that cannot start says why, and a slow start offers a reload instead of a spinner for ever.
test('loading: without WebGL, Watch and Broadcast say so, Agents still opens', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t: string, ...a: any[]) { return /webgl/.test(t) ? null : (get as any).call(this, t, ...a); } as any;
  });
  await openShell(page, 'watch');
  const wait = page.locator('#v-watch .wait');
  await expect(wait).toContainText('needs WebGL', { timeout: 10_000 });
  await expect(wait.locator('.bar')).toBeHidden();
  await expect(wait.locator('.sk'), 'no skeleton for a view that cannot load').toBeHidden();
  await page.click('#tab-broadcast');
  await expect(page.locator('#v-broadcast .wait')).toContainText('needs WebGL', { timeout: 10_000 });
  await page.click('#tab-agents');
  await expect(page.locator('#v-agents')).toBeVisible();
});

test('loading: a slow start shows a note and a reload button that reloads the view and goes away', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).MC_SLOW_MS = 1500;
    const get = HTMLCanvasElement.prototype.getContext;   // the note must not depend on the runner having WebGL
    HTMLCanvasElement.prototype.getContext = function (t: string, ...a: any[]) { return /webgl/.test(t) ? ({} as any) : (get as any).call(this, t, ...a); } as any;
  });
  let hits = 0;
  await page.route('**/watch/index.html*', (r) => { hits++; return r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stuck</body></html>' }); });
  await openShell(page, 'watch');
  const wait = page.locator('#v-watch .wait');
  await expect(wait).toContainText('Still loading', { timeout: 15_000 });
  const btn = page.locator('#v-watch .stall');
  await expect(btn).toBeVisible();
  expect(await page.locator('#v-watch .wait .stall').count(), 'the button sits outside the live region').toBe(0);
  const before = hits;
  await btn.click();
  await expect(btn).toHaveCount(0);
  await expect.poll(() => hits).toBeGreaterThan(before);
});

// Quality review of #119: the slow note counts from when the view began loading, not from its last progress message.
test('loading: progress messages do not postpone the slow-start note, and the note is separate from the progress text', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).MC_SLOW_MS = 2500;
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t: string, ...a: any[]) { return /webgl/.test(t) ? ({} as any) : (get as any).call(this, t, ...a); } as any;
  });
  await page.route('**/watch/index.html*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>stuck</body></html>' }));
  await openShell(page, 'watch');
  const t0 = Date.now();
  // a progress message every 500 ms for the whole wait
  const ticker = setInterval(() => { page.evaluate(() => (window as any).waitText('watch', 'Loading squads')).catch(() => {}); }, 500);
  await expect(page.locator('#v-watch .stallmsg')).toContainText('Still loading', { timeout: 15_000 });
  clearInterval(ticker);
  expect(Date.now() - t0, 'the note appears about MC_SLOW_MS after load began, not after progress stopped').toBeLessThan(9_000);
  await expect(page.locator('#v-watch .wt').first()).toContainText('Loading squads');   // progress text is kept beside the note
});
