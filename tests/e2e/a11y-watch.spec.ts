import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { openShell, ready, viewFrame } from './helpers';

// Watch view: no serious or critical WCAG 2 A/AA violations in the HUD (modes, Match Pulse, Ask, talk), with reduced motion on.
// axe scans the Watch iframe from the shell page; only serious and critical impacts fail.
test('watch view: no serious or critical axe violations in the HUD, and the page language is set', async ({ page }) => {
  test.setTimeout(420_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openShell(page, 'watch');
  await ready('watch')(page);
  const w = await viewFrame(page, 'watch');
  const r = await new AxeBuilder({ page }).include('#v-watch').withTags(['wcag2a', 'wcag2aa']).analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(', ')}`);
  expect(bad).toEqual([]);
  expect(await w.locator('html').getAttribute('lang')).toBe('en');
});

// The default viewer keeps only the live commentary and its two audience controls.
test('Watch keeps duplicate captions, diagnostics and specialist controls out of the viewer', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShell(page, 'watch');
  await ready('watch')(page);
  const w = await viewFrame(page, 'watch');
  await expect(w.locator('#mcf')).toBeVisible();
  for (const id of ['cap', 'pulse', 'mcx-box', 'fan-pop', 'fan-chip', 'fan-metric']) {
    await expect(w.locator('#' + id)).toBeHidden();
  }
  await expect(w.getByRole('radiogroup', { name: 'Feed' }).getByRole('radio')).toHaveCount(2);
  expect(await w.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});
