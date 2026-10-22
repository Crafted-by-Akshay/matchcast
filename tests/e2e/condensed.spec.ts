import { test, expect } from '@playwright/test';
import { collectErrors } from './helpers';

// DAT-10: the condensed broadcast director. The page is Watch on its own at full density (half=45); the test steps the
// engine itself (the frame loop is held off) so it does not depend on how fast the runner renders.
test.describe('Condensed broadcast', () => {
  test('passages play live or fast-forward behind a minute-range wipe, and nothing is dropped', async ({ page }) => {
    const errs = collectErrors(page);
    await page.addInitScript(() => { (window as any).__mcHeadless = true; });
    await page.goto('/watch/index.html?seed=3&half=45', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__mc && (window as any).__mc.players.length && (window as any).__mc.S.started, null, { timeout: 240_000 });

    const r = await page.evaluate(() => {
      const mc = (window as any).__mc, D = mc.DIRC, wipe = () => document.getElementById('ffwipe')!;
      const seen = { wipeText: '', wipeVisible: false, shotsLive: true, shots: 0, firstRange: null as any };
      let n = 0, last = mc.ENV.events.length;
      // 25 match minutes: stop once a fast-forward spell has ended
      while (mc.S.mclock < 25 * 60 && n < 200_000) {
        mc.stepSim(0.02); n++;
        if (D.ff && wipe().style.opacity === '1' && !seen.wipeText) { seen.wipeText = wipe().textContent!; seen.wipeVisible = true; }
        for (let i = last; i < mc.ENV.events.length; i++) { const t = mc.ENV.events[i].type; if (t === 'shot' || t === 'goal') { seen.shots++; if (D.ff) seen.shotsLive = false; } }
        last = mc.ENV.events.length;
      }
      seen.firstRange = D.ranges[0] || null;
      const passEvents = mc.ENV.events.filter((e: any) => e.type === 'pass').length;
      return { ...seen, ffS: D.ffS, liveS: D.liveS, ranges: D.ranges.length, statsPasses: mc.STATS.passes[0] + mc.STATS.passes[1], passEvents };
    });

    expect(r.wipeVisible, 'the wipe should show during a fast-forward').toBe(true);
    expect(r.wipeText).toMatch(/^⏩ \d+' → \d+'$/);
    expect(r.ranges, 'at least one fast-forward spell ended in 25 minutes').toBeGreaterThan(0);
    expect(r.firstRange.to).toBeGreaterThanOrEqual(r.firstRange.from);
    expect(r.ffS, 'most of the match is fast-forwarded').toBeGreaterThan(r.liveS);
    expect(r.shots, 'the match produced shots').toBeGreaterThan(0);
    expect(r.shotsLive, 'every shot and goal happened in live mode').toBe(true);
    expect(r.statsPasses, 'stats count every pass, including fast-forwarded ones').toBe(r.passEvents);
    expect(errs).toEqual([]);
  });
});
