import { test, expect } from './fixtures';
import { readFileSync, existsSync } from 'node:fs';
import { openShell } from './helpers';

// EXP-14: keyboard and screen-reader behaviour of the shell. The axe scan runs when axe-core is installed (QUA-9 adds it to the repo).
declare const AG: any;

test('shell: route and tool menus work by keyboard, a skip link exists, published lines are announced', async ({ page }) => {
  await openShell(page, 'watch');
  await page.focus('#tab-watch');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#tab-matches')).toBeFocused();
  await expect(page.locator('#tab-matches')).toHaveAttribute('aria-current', 'page');
  await page.focus('#more-toggle');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#tab-highlights')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#tab-agents')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#agents$/);
  await expect(page.locator('#more-toggle')).toHaveAttribute('aria-label', 'More, current page: Agents');
  await expect(page.locator('#more-toggle')).toBeFocused();
  await expect(page.locator('a.skip')).toHaveAttribute('href', '#stage');
  // a published line goes to the polite live region
  await page.evaluate(() => {
    AG.setMode('demo');   // the default mode holds each line for a person; an aired line is the one announced
    AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.onWatch('k1', [{ minute: 10.1, type: 'goal', team: 'thr', player: 'A One', score: '1-0', data: {} }], []);
  });
  await expect(page.locator('#sr-lines')).toContainText('Verified line:');
  await expect(page.locator('#sr-lines')).toHaveAttribute('aria-live', 'polite');
});

test('shell: no serious or critical axe violations on the Agents tab', async ({ page }) => {
  test.skip(!existsSync('node_modules/axe-core/axe.min.js'), 'axe-core is not installed');
  await openShell(page, 'agents');
  await page.addScriptTag({ content: readFileSync('node_modules/axe-core/axe.min.js', 'utf8') });
  await page.evaluate(() => {
    AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.onWatch('k1', [{ minute: 10.1, type: 'goal', team: 'thr', player: 'A One', score: '1-0', data: {} }], []);
  });
  const bad = await page.evaluate(async () => {
    const r = await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] });
    return r.violations.filter((v: any) => v.impact === 'serious' || v.impact === 'critical').map((v: any) => v.id + ': ' + v.nodes.map((n: any) => n.target.join(' ')).join(', '));
  });
  expect(bad).toEqual([]);
});
