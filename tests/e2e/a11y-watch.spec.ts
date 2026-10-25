import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';
import { openShell, ready, stepSim, viewFrame } from './helpers';

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

// Quality screenshot findings: Watch does not call its in-page lines API-verified, labels its own xG as the engine's, and the Analyst sparkline panel stays clear of the Match Pulse panel.
test('watch labels: commentary is checked in the page (simulated), xG is the engine\'s, sparkline panel clear of Match Pulse', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShell(page, 'watch');
  await ready('watch')(page);
  const w = await viewFrame(page, 'watch');
  await expect(w.locator('#cap .h span').first()).toHaveText('COMMENTARY · CHECKED IN PAGE · SIMULATED');
  await expect(w.locator('body')).not.toContainText('AI COMMENTARY');
  await stepSim(w, 6000);   // a few match minutes so the Match Pulse panel has cards
  await expect(w.locator('text=xG (engine)').first()).toBeVisible();
  await expect(w.locator('#mcx-idx')).toBeVisible({ timeout: 10_000 });
  const boxes = await w.evaluate(() => ['pulse', 'mcx-idx', 'third'].map((id) => { const r = document.getElementById(id)!.getBoundingClientRect(); return { id, l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
  const hit = (x: any, y: any) => x.l < y.r && y.l < x.r && x.t < y.b && y.t < x.b;
  // a frame of 1100 px or more docks the sparkline panel beside Pulse; the Watch pane in the split stage is narrower, where the panel is part of Pulse's own column and must sit inside it
  const iw = await w.evaluate(() => innerWidth);
  if (iw >= 1100) expect(hit(boxes[0], boxes[1]), 'sparkline panel does not cover Match Pulse').toBe(false);
  else expect(boxes[1].l >= boxes[0].l && boxes[1].r <= boxes[0].r && boxes[1].t >= boxes[0].t && boxes[1].b <= boxes[0].b + 1, 'in a narrow pane the sparkline panel sits inside the Match Pulse column').toBe(true);
  expect(hit(boxes[0], boxes[2]), 'Match Pulse does not cover the On-the-ball card').toBe(false);
  expect(hit(boxes[1], boxes[2]), 'sparkline panel does not cover the On-the-ball card').toBe(false);
});
