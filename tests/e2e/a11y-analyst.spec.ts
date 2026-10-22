import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// EXP-14: the Analyst view has no serious or critical WCAG 2 A/AA violations on any of its main pages.
// The view is opened on its own (not inside the shell iframe) so axe sees the whole document.
const PAGES = ['home', 'library', 'audit', 'reports', 'data-platform', 'ds-agent', 'agents', 'api', 'settings', 'usage', 'status', 'scouting', 'board'];

test('analyst view: no serious or critical axe violations on the main pages', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/analyst/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  const bad: string[] = [];
  for (const p of PAGES) {
    await page.evaluate((p) => (window as any).go(p), p);
    await expect(page.locator('#main h1').first()).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    for (const v of r.violations) if (v.impact === 'serious' || v.impact === 'critical') bad.push(`${p}: ${v.id} ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(', ')}`);
  }
  expect(bad).toEqual([]);
});

test('analyst view: keyboard reaches the navigation and the page language is set', async ({ page }) => {
  await page.goto('/analyst/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.locator('#nav .ni').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main h1').first()).toBeVisible();
});
