import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell } from './helpers';

// A11y: the live Analyst tab never tells the two clubs apart by colour alone (WCAG 1.4.1).
// Shot map: the second club's dots carry a cross marker (the first club's do not) and the key pills carry the same glyphs.
// Pass-share bar: the second club's segment is striped, the first is solid.
declare const AG: any;

const block3d = (page: Page) => page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());

test('Analyst live view: clubs differ by marker and fill pattern, not colour alone', async ({ page }) => {
  const errs = collectErrors(page);
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await page.evaluate(() => {
    AG.reset('k', { hk: 'h', ak: 'a', home: 'Harbor City', away: 'Thames Rovers' });
    const sh = (minute: number, team: string, player: string, x: number, y: number, xg: number, fate: string) => ({ minute, type: 'shot', team, player, x, y, xg, fate });
    const pass = (minute: number, team: string, player: string, x0: number, x1: number) => ({ minute, type: 'pass', team, player, to: 'Mate', x0, y0: 30, x1, y1: 34 });
    AG.onWatch('k', [pass(2, 'h', 'E. Belruda', 40, 52), pass(3, 'a', 'T. Marsh', 50, 44), pass(10, 'h', 'E. Belruda', 40, 52), pass(11, 'a', 'T. Marsh', 50, 44), sh(5, 'h', 'E. Belruda', 92, 30, 0.31, 'goal'), sh(12, 'a', 'T. Marsh', 14, 40, 0.07, 'miss')], []);
  });
  const map = page.locator('#al svg[data-map="shots"]');
  await expect(map.locator('circle[data-xg]')).toHaveCount(2);
  // away shot: one cross marker; home shot: none
  await expect(map.locator('path[data-mark="cross"][data-side="1"]')).toHaveCount(1);
  await expect(map.locator('path[data-mark="cross"][data-side="0"]')).toHaveCount(0);
  const key = page.locator('#al [data-panel="shots"] .key');
  await expect(key.locator('span[data-side="0"]')).toContainText('●');
  await expect(key.locator('span[data-side="1"]')).toContainText('✕');
  // share bar: the second segment is a pattern, the first is plain
  const share = page.locator('#al .share');
  await expect(share).toBeVisible();
  const bg = await share.locator('i').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundImage));
  expect(bg[0]).toBe('none');
  expect(bg[1]).toContain('repeating-linear-gradient');
  expect(errs).toEqual([]);
});
