import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// FIX-02: the trace page shows the archive the Match centre last showed (R.lastMatch), never the latest match or the live fixture.
async function openAnalyst(page: Page) {
  await openShell(page, 'analyst', '?crew=0');
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 1, null, { timeout: 120_000 });
  return f;
}

test('how was this made follows the match the Match centre showed', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openAnalyst(page);
  const [first, last] = await f.evaluate(() => [D.matches[0], D.matches[D.matches.length - 1]].map((m: any) => ({ id: m.id, title: m.title })));
  expect(first.id).not.toBe(last.id);
  await f.evaluate((id) => (window as any).go('match', id), first.id);
  await f.evaluate(() => (window as any).go('trace'));
  await expect(f.locator('#pg')).toContainText(first.title);
  await expect(f.locator('#pg')).not.toContainText(last.title);
  expect(errs).toEqual([]);
});
