import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openShell } from './helpers';

// Shell chrome only (top bar, fixture picker, tabs). The three views are canvas-heavy and get
// their own checks as their markup settles; see docs/release-check.md for the manual pass.
test('shell has no serious or critical accessibility violations', async ({ page }) => {
  await openShell(page, 'watch');
  const results = await new AxeBuilder({ page })
    .include('body')
    .exclude('iframe')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    blocking.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
});
