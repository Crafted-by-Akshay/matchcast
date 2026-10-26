import { test, expect } from './fixtures';
import { collectErrors } from './helpers';

// Watch's 3D pass draws at pixel ratio 1 while the measured frame rate is low (embed/watch.js, MCRes), as it already does
// until the first verified card. Below 24 fps over a 2 s window it drops to ratio 1; it returns after three windows at 50 fps
// or better; a window between 24 and 50 fps does not count towards that; a second drop is kept. The test feeds the sampler
// frame times by hand (window.__mcRes.feed), so it does not depend on how fast the sandbox renders.
test.use({ deviceScaleFactor: 2 });   // the 1x test below opens its own context

test.describe('Adaptive 3D resolution', () => {

  test('the 3D pass drops to pixel ratio 1 when fps stays low, and returns only when it recovers comfortably', async ({ page }) => {
    test.setTimeout(240_000);
    const errs = collectErrors(page);
    await page.goto('/watch/index.html?seed=3&half=15&condense=0', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__mcRes?.state().startup === true, null, { timeout: 240_000 });
    const r = await page.evaluate(() => {
      const M = (window as any).__mcRes, mc = (window as any).__mc, rend = mc.composer.renderer;
      M.stop(); M.full(); M.reset();   // end the first-load hold and forget what the live sampler saw on this busy machine; from here only the fed frames count
      const out: any = { base: M.state().base, afterStartup: rend.getPixelRatio() };
      let t = 1000; M.feed(t);   // opens the first window
      const run = (ms: number, step: number) => { for (const end = t + ms; t < end;) { t += step; M.feed(t); } return rend.getPixelRatio(); };
      out.steady = run(4000, 16.7);          // 60 fps: stays at the engine's ratio
      out.slowish = run(2100, 100);          // 10 fps for one window: drops
      out.state1 = M.state();
      out.midway = run(2100, 33.3);          // 30 fps window: not low, not recovered
      out.calm1 = run(4100, 16.7);           // two calm windows only
      out.broken = run(2100, 33.3);          // interrupted: the count starts again
      out.calm2 = run(4100, 16.7);
      out.back = run(2100, 16.7);            // the third calm window in a row: restored
      out.state2 = M.state();
      out.second = run(4100, 100);           // a second drop (two windows, whatever the drift of the first)
      out.latched = run(30000, 16.7);        // is kept for the session: no flapping
      out.state3 = M.state();
      return out;
    });
    expect(r.base, 'the engine draws above ratio 1 on a 2x screen').toBeGreaterThan(1);
    expect(r.afterStartup).toBe(r.base);
    expect(r.steady).toBe(r.base);
    expect(r.slowish).toBe(1);
    expect(r.state1.drops).toBe(1);
    expect([r.midway, r.calm1, r.broken, r.calm2]).toEqual([1, 1, 1, 1]);
    expect(r.back).toBe(r.base);
    expect(r.state2).toMatchObject({ slow: false, drops: 1 });
    expect(r.second).toBe(1);
    expect(r.latched, 'after the second drop it stays at 1').toBe(1);
    expect(r.state3.drops).toBe(2);
    expect(errs).toEqual([]);
  });
});

test('a long gap between frames (hidden tab, offscreen frame) restarts the window and does not drop the ratio', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/watch/index.html?seed=3&half=5&condense=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__mcRes?.state().startup === true, null, { timeout: 240_000 });
  const r = await page.evaluate(() => {
    const M = (window as any).__mcRes, rend = (window as any).__mc.composer.renderer;
    M.stop(); M.full(); M.reset();
    const before = rend.getPixelRatio();
    M.feed(1000); M.feed(60000);   // one frame after a minute away: not a 0.02 fps window
    for (let t = 60000; t < 62200; t += 16.7) M.feed(t);   // and then 60 fps
    return { before, pr: rend.getPixelRatio(), s: M.state() };
  });
  expect(r.before).toBeGreaterThan(1);
  expect(r.pr).toBe(r.before);
  expect(r.s).toMatchObject({ slow: false, drops: 0 });
});

test('windows measured during the first-load hold do not count', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/watch/index.html?seed=3&half=5&condense=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__mcRes?.state().startup === true, null, { timeout: 240_000 });
  const s = await page.evaluate(() => {
    const M = (window as any).__mcRes; M.stop(); M.reset();
    let t = 1000; M.feed(t); for (let i = 0; i < 30; i++) { t += 100; M.feed(t); }   // 10 fps while the hold is on
    return M.state();
  });
  expect(s).toMatchObject({ startup: true, slow: false, drops: 0 });
});

test('a 1x screen never changes ratio, whatever the frame rate', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto('/watch/index.html?seed=3&half=15&condense=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__mc?.players.length && (window as any).__mc.S.started, null, { timeout: 240_000 });
  const r = await page.evaluate(() => {
    const M = (window as any).__mcRes, rend = (window as any).__mc.composer.renderer;
    M.stop(); let t = 1000; M.feed(t); for (let i = 0; i < 60; i++) { t += 100; M.feed(t); }
    return { pr: rend.getPixelRatio(), s: M.state() };
  });
  expect(r.pr).toBe(1);
  expect(r.s.slow).toBe(false);
  await ctx.close();
});
