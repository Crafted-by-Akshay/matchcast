import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { openShell, ready, viewFrame, openView } from './helpers';

// Broadcast view: no serious or critical WCAG 2 A/AA violations on any desk tab, in both colour schemes.
// axe scans the Broadcast iframe from the shell page; only serious and critical impacts fail.
const TABS = ['desk', 'calls', 'win', 'focus', 'players', 'script'];

for (const scheme of ['light', 'dark'] as const) test(`broadcast view (${scheme} theme): no serious or critical axe violations on the desk tabs`, async ({ page }) => {
  test.setTimeout(420_000);
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
  await openShell(page, 'agents');
  await openView(page, 'broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  const bad: string[] = [];
  for (const t of TABS) {
    await bc.locator(`#bc-tabs button[data-p="${t}"]`).click();
    const r = await new AxeBuilder({ page }).include('#v-broadcast').withTags(['wcag2a', 'wcag2aa']).analyze();
    for (const v of r.violations) if (v.impact === 'serious' || v.impact === 'critical') bad.push(`${t}: ${v.id} ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
  }
  expect(bad).toEqual([]);
  expect(await bc.locator('html').getAttribute('lang')).toBe('en');
});
