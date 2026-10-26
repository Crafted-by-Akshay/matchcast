import { test, expect } from './fixtures';
import { collectErrors } from './helpers';

// Watch's match clock follows wall time (docs/architecture/11-frontend.md, "Wall-time match clock").
// The frame loop used to cap each frame at 0.05 s, so below 20 fps the match ran slow (8 fps gave 0.4x). Now one frame
// may carry up to 0.25 s, and a frame spends at most 0.3 s of play (15 fixed 0.02 s steps; times the speed above 1x) so a very slow machine
// degrades instead of freezing. The step stays a fixed 0.02 s; the headless runner path is untouched.
//
// The real animation loop is driven by hand: requestAnimationFrame and performance.now are replaced in the Watch page
// by a manual queue (from the first line of the page, so nothing runs until a tick), so a "frame" of exactly N ms is one tick and the test does not depend on how fast the sandbox renders.
const manualClock = () => {
  if (!/\/watch\//.test(location.pathname)) return;
  // manual from the first line of the page: no frame runs before the test ticks, so every run starts from the same kick-off
  let fake = 0, q: FrameRequestCallback[] = [];
  window.requestAnimationFrame = (cb) => q.push(cb);
  performance.now = () => fake;
  (window as any).__manual = {
    pending: () => q.length,
    tick(ms: number) { fake += ms; const c = q; q = []; c.forEach((cb) => cb(fake)); },
  };
};

async function openManual(page: any, query: string) {
  await page.addInitScript(manualClock);
  await page.goto('/watch/index.html?' + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const mc = (window as any).__mc; return mc && mc.players.length && mc.S.started; }, null, { timeout: 240_000, polling: 100 });   // the default polling uses requestAnimationFrame, which is stubbed
  await page.waitForFunction(() => (window as any).__manual.pending() > 0, null, { timeout: 30_000, polling: 100 });
  await page.evaluate(() => (window as any).__manual.tick(0));   // the engine's clock starts on its first frame (a delta of 0)
}

test.use({ viewport: { width: 480, height: 270 } });   // every manual tick draws a frame in software GL: keep the frame small

test.describe('Wall-time match clock', () => {
  test('a 250 ms frame carries 250 ms of play, not 50 ms, and a long stall is capped, not frozen', async ({ page }) => {
    test.setTimeout(300_000);
    const errs = collectErrors(page);
    await openManual(page, 'seed=3&half=5&condense=0');
    const r = await page.evaluate(() => {
      const mc = (window as any).__mc, S = mc.S, m = (window as any).__manual;
      S.paused = false; S.speed = 1; mc.DIRC.on = false;
      const run = (ms: number) => { const t0 = S.t, c0 = S.mclock; m.tick(ms); return { t: S.t - t0, clock: S.mclock - c0 }; };
      const out: any = { mscale: S.mscale, step: run(250), small: [] as number[] };
      // many small frames add up to the same play time as the wall time they cover
      let sum = 0; for (let i = 0; i < 10; i++) sum += run(25).t; out.sum = sum;
      out.stall = run(5000);   // a five second stall (tab throttled, software GL)
      // frame() itself, where the step cap truly binds: a 5 s budget asked of one call
      const direct = (sp: number) => { S.speed = sp; const t0 = S.t; mc.frame(5, false); return S.t - t0; };
      out.directCap = direct(1); out.directCap2 = direct(2); S.speed = 1;
      out.after = run(16);     // and the clock carries on
      S.speed = 2; out.fast = run(250); out.fastStall = run(5000); S.speed = 1;
      return out;
    });
    expect(r.mscale).toBe(9);
    expect(r.step.t, '250 ms frame at 1x').toBeGreaterThan(0.25 - 0.021);
    expect(r.step.t).toBeLessThan(0.25 + 0.021);
    expect(r.step.clock, 'match clock moves dt x speed x mscale').toBeCloseTo(r.step.t * r.mscale, 6);
    expect(r.sum, 'ten 25 ms frames').toBeGreaterThan(0.25 - 0.021);
    expect(r.sum).toBeLessThan(0.25 + 0.021);
    expect(r.stall.t, 'a stall does not freeze the clock').toBeGreaterThan(0.2);
    expect(r.stall.t, 'bounded by the loop frame cap of 0.25 s (plus the carried remainder)').toBeLessThanOrEqual(0.3 + 0.021);
    expect(r.directCap, 'frame(5) at 1x: 15 steps plus the carried remainder').toBeGreaterThan(0.28);
    expect(r.directCap).toBeLessThanOrEqual(0.3 + 0.021);
    expect(r.directCap2, 'frame(5) at 2x: 30 steps').toBeGreaterThan(0.58);
    expect(r.directCap2).toBeLessThanOrEqual(0.6 + 0.021);
    expect(r.after.t, 'the next frame is normal again').toBeLessThan(0.021);
    expect(r.fast.t, '2x: 250 ms of wall time is 0.5 s of play, under the 2x cap of 0.6 s').toBeGreaterThan(0.5 - 0.021);
    expect(r.fast.t).toBeLessThan(0.5 + 0.021);
    expect(r.fastStall.t, '2x stall: capped at 15 steps x 2').toBeGreaterThan(0.5);
    expect(r.fastStall.t).toBeLessThanOrEqual(0.6 + 0.021);
    expect(errs).toEqual([]);
  });

  test('wall-time playback is a multiple of the fixed 0.02 s step: the same seed gives the same events at 250 ms and 100 ms frames', async ({ browser }) => {
    test.setTimeout(500_000);
    const run = async (ms: number) => {
      const page = await browser.newPage();
      await openManual(page, 'seed=2026&st=1&month=3&h=NAV&a=LOM&half=5&condense=0');
      const r = await page.evaluate((frameMs) => {
        const mc = (window as any).__mc, S = mc.S, m = (window as any).__manual;
        mc.composer.render = () => {};   // the frame is not under test: skip the software-GL draw
        S.paused = false; S.speed = 1; const t0 = S.t;
        while (S.t - t0 < 20 - 1e-9) m.tick(frameMs);
        // a common stopping point: events up to the same match time
        return JSON.stringify(mc.ENV.events.filter((e: any) => e.minute <= 2.9).map((e: any) => [e.type, e.minute, e.team, e.player]));
      }, ms);
      await page.close();
      return r;
    };
    const a = await run(250), b = await run(100);
    expect(JSON.parse(a).length, 'the match produced events').toBeGreaterThan(3);
    expect(b).toBe(a);
  });
});

// The headless runner (services/simulation/run.cjs, sim-engine.spec.ts) must see the same steps as before the change.
// The digests below were taken from the build before the wall-time patch: frame() driven with a large fixed budget
// (__mcDt = 0.37, above the 0.3 catch-up cap) must not be clamped, with and without the condensed director.
const GOLDEN: Record<string, string> = {
  live: 'db0ce795',
  condensed: '966667b7',
};
for (const [name, q] of [['live', 'half=15&condense=0'], ['condensed', 'half=45']] as const) {
  test(`headless path is unchanged (${name}): same seed, same steps, same digest as before the patch`, async ({ page }) => {
    test.setTimeout(400_000);
    await page.addInitScript(() => { (window as any).__mcHeadless = true; });   // __mcDt stays 0 until the page is driven: the real loop must not step the match before the digest starts
    await page.goto(`/watch/index.html?seed=2026&st=1&month=3&h=NAV&a=LOM&${q}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { const mc = (window as any).__mc; return mc && mc.players.length && mc.S.started; }, null, { timeout: 240_000 });
    const d = await page.evaluate(() => {
      const mc = (window as any).__mc, S = mc.S;
      (window as any).__mcDt = 0.37; const t0 = S.t; let n = 0;
      while (S.mclock < 400 && n++ < 100_000) mc.frame(1 / 60, false);
      const state = [S.t - t0, S.mclock, S.score, mc.ball.p.x, mc.ball.p.y, mc.ball.p.z, mc.players.map((p: any) => [p.pos2.x, p.pos2.y]),
        mc.ENV.events.map((e: any) => [e.type, e.minute, e.team, e.player])];
      const s = JSON.stringify(state); let h = 2166136261;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return { h: h.toString(16), frames: n, nEvents: mc.ENV.events.length };
    });
    console.log(`digest ${name}: ${d.h} (${d.frames} frames, ${d.nEvents} events)`);
    expect(d.nEvents).toBeGreaterThan(0);
    expect(d.h).toBe(GOLDEN[name]);
  });
}
