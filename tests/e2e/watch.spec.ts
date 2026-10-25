import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

test.describe('Watch view', () => {
  test('loads, shows the season picker and kicks off on the shared fixture', async ({ page }) => {
    const errs = collectErrors(page);
    await openShell(page, 'watch');
    // The picker lists every fixture in shared/fixtures.json (season plus the national fixture), so the count follows the data, not a literal.
    const total = await page.evaluate(async () => (await fetch('shared/fixtures.json').then((r) => r.json())).length);
    expect(total).toBeGreaterThan(28);
    await expect(page.locator('#fx option')).toHaveCount(total);
    const want = await page.evaluate(async () => { const L = await fetch('shared/fixtures.json').then((r) => r.json()); const x = L.find((q: any) => q.id === (document.getElementById('fx') as HTMLSelectElement).value); return { seed: String(x.setup.seed), clubs: [x.home.club, x.away.club] }; });
    const f = await viewFrame(page, 'watch');
    await ready('watch')(page);
    const s = await f.evaluate(() => { const m = (window as any).__mc; return { started: m.S.started, seed: String(m.SET().seed), clubs: [0, 1].map((t) => m.players.find((q: any) => q.ti === t).T.club) }; });
    expect(s.started, 'Watch should have kicked off').toBe(true);
    expect(s.seed, 'Watch should use the fixture seed').toBe(want.seed);
    expect(s.clubs).toEqual(want.clubs);
    expect(errs).toEqual([]);
  });

  // The agents-verify-a-claim check lives in unified.spec.ts, which already has Watch running; Match Pulse cases are in pulse.spec.ts.
  // Match Pulse card, mode switch, mode kept after reload and the trace panel are added here
  // once EXP-3, EXP-4 and EXP-6 merge, so the selectors come from the shipped markup.
});
