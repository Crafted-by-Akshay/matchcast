import { test, expect } from './fixtures';
import { execFileSync } from 'child_process';
import { collectErrors } from './helpers';

// DAT-9: the determinism and Math.random checks run here because they need Chromium (the e2e job has it);
// the two restart guards are exercised on the live engine. The page steps the engine itself (headless).
test.describe('Simulator engine', () => {
  test('xG constants, Math.random allow-list and same-seed determinism hold', async () => {
    test.setTimeout(240_000);
    const out = execFileSync('node', ['services/simulation/tests/checks.cjs'], { encoding: 'utf8', timeout: 220_000 });
    expect(out).not.toMatch(/FAIL/);
    expect(out).toMatch(/ok\s+same seed/i);
  });

  async function open(page: any, seed: number) {
    await page.addInitScript(() => { (window as any).__mcHeadless = true; });
    await page.goto(`/watch/index.html?seed=${seed}&half=45&condense=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__mc && (window as any).__mc.players.length && (window as any).__mc.S.started, null, { timeout: 240_000 });
  }

  test('a free-kick taker who is sent off is replaced, and one who cannot reach the ball is pulled to it', async ({ page }) => {
    test.setTimeout(240_000);
    const errs = collectErrors(page);
    await open(page, 3);
    const r = await page.evaluate(() => {
      const mc = (window as any).__mc, S = mc.S;
      const until = (f: () => boolean, max = 300_000) => { let n = 0; while (!f() && n++ < max) mc.stepSim(0.02); return f(); };
      const out: any = {};
      out.found1 = until(() => S.restart && S.restart.type === 'freekick' && S.restart.taker);
      const R1 = S.restart, tk1 = R1.taker; tk1.off = true;
      mc.stepSim(0.02);
      out.replaced = S.restart === R1 ? (R1.taker !== tk1 && !R1.taker?.off) : true;
      tk1.off = false;
      until(() => S.restart !== R1, 20_000); // let that one finish
      out.found2 = until(() => S.restart && S.restart.type === 'freekick' && S.restart.taker);
      const R2 = S.restart, tk2 = R2.taker;
      tk2.vmax = 0.01; tk2.pos2.set(R2.spot.x < 52 ? 70 : 35, 34); // far away and unable to run
      let t = 0; while (S.restart === R2 && t < 90) { mc.stepSim(0.02); t += 0.02; }
      out.cleared = S.restart !== R2; out.seconds = t;
      return out;
    });
    expect(!!(r.found1 && r.found2), 'the match produced two free kicks').toBe(true);
    expect(r.replaced, 'a sent-off taker is replaced').toBe(true);
    expect(r.cleared, 'the restart ended').toBe(true);
    expect(r.seconds, 'within the 60 s watchdog plus a few seconds').toBeLessThan(75);
    expect(errs).toEqual([]);
  });

  test('a kick-off with no midfielder in the side does not crash', async ({ page }) => {
    const errs = collectErrors(page);
    await open(page, 5);
    const r = await page.evaluate(() => {
      const mc = (window as any).__mc, S = mc.S;
      const R = S.restart; if (!R || R.type !== 'kickoff') return { skipped: true };
      for (const p of mc.players) if (p.ti === R.team) p.pos = p.gk ? 'GK' : 'CB';
      let t = 0; while (S.restart === R && t < 60) { mc.stepSim(0.02); t += 0.02; }
      return { skipped: false, done: S.restart !== R };
    });
    expect(r.skipped, 'the match starts on a kick-off').toBe(false);
    expect(r.done).toBe(true);
    expect(errs).toEqual([]);
  });

  test('re-rolling the forecast refreshes the Auto formation shown in setup to the one kick-off plays', async ({ page }) => {
    await page.addInitScript(() => { (window as any).__mcHeadless = true; });
    await page.goto('/watch/index.html?seed=3&half=45', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__mc && (window as any).__mc.S.started, null, { timeout: 240_000 });
    const r = await page.evaluate(() => {
      const mc = (window as any).__mc; mc.openSetup();
      const seen = new Set<string>(); let shown = '', played = '', ok = true;
      for (let i = 0; i < 6; i++) {
        (document.getElementById('fc-roll') as HTMLElement).click();
        shown = JSON.stringify(mc.SET().tactics.map((t: any) => [t.pf, t.ps]));
        seen.add(shown);
        const card = document.getElementById('setup')!.textContent!;
        ok = ok && mc.SET().tactics.every((t: any) => card.includes(t.pf));
      }
      mc.kickOff(); played = JSON.stringify(mc.SET().tactics.map((t: any) => [t.pf, t.ps]));
      return { shown, played, ok, distinct: seen.size };
    });
    expect(r.played, 'kick-off plays the Auto choice that setup showed').toBe(r.shown);
    expect(r.ok, 'the setup card names the rolled formations').toBe(true);
    expect(r.distinct, 'each re-roll changes the draw').toBeGreaterThan(1);
  });
});
