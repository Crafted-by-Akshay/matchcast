import { test, expect } from './fixtures';
import { readFileSync, existsSync } from 'node:fs';
import { openShell } from './helpers';

// EXP-14: keyboard and screen-reader behaviour of the shell. The axe scan runs when axe-core is installed (QUA-9 adds it to the repo).
declare const AG: any;

test('shell: arrow keys move between tabs, a skip link exists, published lines are announced', async ({ page }) => {
  await openShell(page, 'agents');
  await page.focus('#tab-agents');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-watch')).toBeFocused();
  await expect(page.locator('#tab-watch')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(page.locator('#tab-agents')).toBeFocused();
  await expect(page.locator('a.skip')).toHaveAttribute('href', '#stage');
  // a published line goes to the polite live region
  await page.evaluate(() => {
    AG.reset('k1', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' });
    AG.onWatch('k1', [{ minute: 10.1, type: 'goal', team: 'ars', player: 'A One', score: '1-0', data: {} }], []);
  });
  await expect(page.locator('#sr-lines')).toContainText('Verified line: Goal for Arsenal');
  await expect(page.locator('#sr-lines')).toHaveAttribute('aria-live', 'polite');
});

test('shell: no serious or critical axe violations on the Agents tab', async ({ page }) => {
  test.skip(!existsSync('node_modules/axe-core/axe.min.js'), 'axe-core is not installed');
  await openShell(page, 'agents');
  await page.addScriptTag({ content: readFileSync('node_modules/axe-core/axe.min.js', 'utf8') });
  await page.evaluate(() => {
    AG.reset('k1', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' });
    AG.onWatch('k1', [{ minute: 10.1, type: 'goal', team: 'ars', player: 'A One', score: '1-0', data: {} }], []);
  });
  const bad = await page.evaluate(async () => {
    const r = await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] });
    return r.violations.filter((v: any) => v.impact === 'serious' || v.impact === 'critical').map((v: any) => v.id + ': ' + v.nodes.map((n: any) => n.target.join(' ')).join(', '));
  });
  expect(bad).toEqual([]);
});
