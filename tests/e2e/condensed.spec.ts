import { test, expect } from '@playwright/test';
import { collectErrors } from './helpers';

// DAT-10: the condensed broadcast director. Watch at full density (half=45). The test drives the real frame loop with a
// fixed time budget per frame (window.__mcDt, headless only), so the fast-forward budget accounting in frame() is
// exercised, not just the director's score.
test.describe('Condensed broadcast', () => {
  test('frame() fast-forwards quiet passages behind a minute-range wipe, spends its budget exactly, and drops nothing', async ({ page }) => {
    test.setTimeout(300_000);
    const errs = collectErrors(page);
    await page.addInitScript(() => { (window as any).__mcHeadless = true; (window as any).__mcDt = 0.1; });
    await page.goto('/watch/index.html?seed=3&half=45', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__mc && (window as any).__mc.players.length && (window as any).__mc.S.started, null, { timeout: 240_000 });

    const r = await page.evaluate(() => {
      const mc = (window as any).__mc, D = mc.DIRC, wipe = () => document.getElementById('ffwipe')!;
      let frames = 0, wipeText = '';
      while (mc.S.mclock < 20 * 60 && frames < 60_000) {
        mc.frame(0.05, false); frames++;
        if (D.ff && !wipeText && wipe().style.opacity === '1') wipeText = wipe().textContent!;
      }
      const passEvents = mc.ENV.events.filter((e: any) => e.type === 'pass').length;
      return { frames, wipeText, ffX: D.ffX, ffS: D.ffS, liveS: D.liveS, ranges: D.ranges, clock: mc.S.mclock,
               statsPasses: mc.STATS.passes[0] + mc.STATS.passes[1], passEvents };
    });

    expect(r.clock, 'the match reached minute 20').toBeGreaterThanOrEqual(20 * 60);
    expect(r.wipeText).toMatch(/^⏩ \d+' → \d+'$/);
    expect(r.ranges.length, 'at least one fast-forward spell ended').toBeGreaterThan(0);
    expect(r.ranges[0].to).toBeGreaterThanOrEqual(r.ranges[0].from);
    // each frame hands the engine 0.1 s of viewing time: live seconds cost 1, fast-forwarded seconds cost 1/ffX
    const spent = r.liveS + r.ffS / r.ffX;
    expect(spent).toBeGreaterThan(r.frames * 0.1 - 0.5);
    expect(spent).toBeLessThan(r.frames * 0.1 + 0.5);
    expect(r.ffS, 'most of the match is fast-forwarded').toBeGreaterThan(r.liveS);
    expect(r.liveS + r.ffS, 'viewing time was condensed').toBeGreaterThan(spent * 2);
    expect(r.statsPasses, 'stats count every pass, including fast-forwarded ones').toBe(r.passEvents);
    expect(errs).toEqual([]);
  });
});
