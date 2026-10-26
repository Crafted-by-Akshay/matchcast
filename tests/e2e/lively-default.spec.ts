import { test, expect } from './fixtures';
import { openShell } from './helpers';

// A judge who opens the default match (the shell's default fixture, N001 Argentina v Brazil) must see something happen:
// a few shots and at least one goal in the first 50 simulated minutes. The fixture's own setup (seed, formations, styles) is
// what the shell hands to Watch, so this plays exactly that, headless, on the runner's fixed 0.02 s step. Simulated, deterministic.
declare const byId: (id: string) => any, setupOf: (fx: any) => Record<string, unknown>;
const MIN_SHOTS = 8;

test('the default match has shots and a goal in its first 50 simulated minutes', async ({ page }) => {
  test.setTimeout(420_000);
  await openShell(page, 'watch');
  const q = await page.evaluate(() => {
    const fx = byId((document.getElementById('fx') as HTMLSelectElement).value);
    return new URLSearchParams(Object.entries(setupOf(fx)).map(([k, v]) => [k, String(v)])).toString();
  });
  const ctx = page.context(); await page.close();   // the shell's own Watch frame would share the CPU
  const w = await ctx.newPage();
  await w.addInitScript(() => { (window as any).__mcHeadless = true; });
  await w.goto('/watch/index.html?' + q, { waitUntil: 'domcontentloaded' });
  await w.waitForFunction(() => (window as any).__mc && (window as any).__mc.players.length && (window as any).__mc.S.started, null, { timeout: 240_000 });
  const r = await w.evaluate(() => {
    const mc = (window as any).__mc, S = mc.S; let n = 0;
    while (!S.over && S.mclock < 50 * 60 && n++ < 2_000_000) mc.stepSim(0.02);
    return { shots: (mc.STATS.shots as number[]).reduce((a, b) => a + b, 0), goals: (S.score as number[]).reduce((a, b) => a + b, 0), minute: S.mclock / 60 };
  });
  expect(r.minute, 'played 50 minutes').toBeGreaterThanOrEqual(50);
  expect(r.shots, 'shots in the first 50 minutes of the default match').toBeGreaterThanOrEqual(MIN_SHOTS);
  expect(r.goals, 'goals in the first 50 minutes of the default match').toBeGreaterThanOrEqual(1);
});
