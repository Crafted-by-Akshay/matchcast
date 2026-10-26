import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';

// The default Analyst live view (shell) has a Maps section drawn from the live match by MAPS (maps.js), and window.MC.analysis
// renders the same maps into any container for the Ask lane. Synthetic Watch messages stand in for a running match.
test('analyst live view: the Maps section draws the live match and its buttons switch the map', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'watch');   // the default path: the compact Analyst live view is one click behind the Analyst tab
  await page.evaluate(() => { location.hash = 'analyst'; });
  await expect(page.locator('#al-maps')).toBeAttached({ timeout: 60_000 });
  await page.evaluate(() => {
    const setup = { h: 'ARG', a: 'BRA', seed: 2026, st: 4, month: 7, kick: '17:00', half: 15 };
    const names = Array.from({ length: 22 }, (_, i) => 'P' + i);
    const roster = { teams: ['ARG', 'BRA'], players: names.map((n, i) => ({ name: n, team: i < 11 ? 'ARG' : 'BRA' })) };
    (window as any).MAPS.start(setup, roster);
    for (let s = 0; s < 90; s++) (window as any).MAPS.frame(setup, { mclock: s, half: 1, players: names.map((_, i) => [(i * 4 + s * 0.4) % 105, 10 + (i * 3) % 50, 0, 0, 0, 0]) });
    const batch: object[] = [];
    for (let k = 0; k < 4; k++) batch.push({ simT: k, type: 'pass', minute: 1, team: 'ARG', player: 'P2', to: 'P3' });
    (window as any).MAPS.events(setup, batch);
  });
  await expect(page.locator('#al-map svg')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('#al-map svg')).toHaveAttribute('aria-label', /Heatmap/);
  await page.locator('#al-maps [data-map="pass_network"]').click();
  await expect(page.locator('#al-map svg')).toHaveAttribute('aria-label', /Pass network/);
  await expect(page.locator('#al-maps [data-map="pass_network"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#al-maps [data-team="away"]').click();
  await expect(page.locator('#al-maps [data-team="away"]')).toHaveAttribute('aria-pressed', 'true');
  const api = await page.evaluate(() => {
    const el = document.createElement('div');
    const out = (window as any).MC.analysis.render('avg_positions', {}, el);
    return { out, svgs: el.querySelectorAll('svg').length };
  });
  expect(api.out.live).toBe(true);
  expect(api.svgs).toBe(1);
  expect(errs).toEqual([]);
});
