import { test, expect } from '@playwright/test';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

declare const AG: any; // top-level const of the shell

test.describe('Watch view', () => {
  test('loads, shows the season picker and kicks off on the shared fixture', async ({ page }) => {
    const errs = collectErrors(page);
    await openShell(page, 'watch');
    await expect(page.locator('#fx option')).toHaveCount(28);
    const want = await page.evaluate(async () => { const L = await fetch('shared/fixtures.json').then((r) => r.json()); const x = L.find((q: any) => q.id === (document.getElementById('fx') as HTMLSelectElement).value); return { seed: String(x.setup.seed), clubs: [x.home.club, x.away.club] }; });
    const f = await viewFrame(page, 'watch');
    await ready('watch')(page);
    const s = await f.evaluate(() => { const m = (window as any).__mc; return { started: m.S.started, seed: String(m.SET().seed), clubs: [0, 1].map((t) => m.players.find((q: any) => q.ti === t).T.club) }; });
    expect(s.started, 'Watch should have kicked off').toBe(true);
    expect(s.seed, 'Watch should use the fixture seed').toBe(want.seed);
    expect(s.clubs).toEqual(want.clubs);
    expect(errs).toEqual([]);
  });

  test('a goal moment is explained by the agents with a verified claim', async ({ page }) => {
    await openShell(page, 'watch');
    const f = await viewFrame(page, 'watch');
    await ready('watch')(page);
    await expect.poll(async () => {
      await f.evaluate(() => { for (let i = 0; i < 3000; i++) (window as any).__mc.stepSim(0.05); });
      return page.evaluate(() => AG?.run?.stat.verified ?? 0);
    }, { timeout: 120_000, message: 'no verified claim reached the agents' }).toBeGreaterThan(0);
  });

  // Match Pulse card, mode switch, mode kept after reload and the trace panel are added here
  // once EXP-3, EXP-4 and EXP-6 merge, so the selectors come from the shipped markup.
});
