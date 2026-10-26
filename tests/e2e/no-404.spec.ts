import { test, expect } from './fixtures';
import { openShell, ready } from './helpers';

// Every same-origin file the shell, Watch and the link prefetch ask for must exist. The default fixture is the national
// N001 (Argentina v Brazil), which has no recorded-match file, so the prefetch must not ask for analyst/data/N001.json.
for (const query of ['?split=0', '?split=0&demo=1', '?split=0&crew=0']) {
  test(`no same-origin request fails on Watch (${query})`, async ({ page }) => {
    test.setTimeout(300_000);
    const bad: string[] = [];
    const origin = new URL(page.url() === 'about:blank' ? (test.info().project.use.baseURL || 'http://localhost:4173') : page.url()).origin;
    let prefetched = 0;
    page.on('response', (r) => { if (r.url().includes('/analyst/data/')) prefetched++; if (r.url().startsWith(origin) && r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
    await openShell(page, 'watch', query);
    await ready('watch')(page);
    // the prefetch runs a few seconds after kick-off; wait until its links exist, then until each was answered
    await page.waitForFunction(() => document.querySelectorAll('link[rel=prefetch][href^="analyst/data/"]').length > 1, null, { timeout: 120_000 });
    // each prefetch link has been answered (200, or a 404 that fails the test)
    await expect.poll(async () => prefetched >= (await page.locator('link[rel=prefetch][href^="analyst/data/"]').count()), { timeout: 60_000 }).toBe(true);
    expect(bad, 'same-origin responses with status >= 400').toEqual([]);
  });
}
