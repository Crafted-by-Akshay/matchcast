import { test, expect } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// Broadcast shows the referee and assistants where Watch has them and with the same signal or flag; Watch's frames carry them.
test('referee signals and assistant flags in Watch show in Broadcast', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  const w = await viewFrame(page, 'watch');
  await expect.poll(() => w.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await page.evaluate(() => document.getElementById('tab-broadcast')!.click());
  const b = await viewFrame(page, 'broadcast');
  await expect.poll(() => b.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  // hold back Watch's own frames at the shell and send the only ones
  await page.evaluate(() => { const orig = (window as any).post; (window as any).post = (v: string, m: any) => (m?.type === 'frame' ? undefined : orig(v, m)); });
  await b.evaluate(() => {
    const m = (window as any).__mc;
    (window as any).__send = (offs: any[]) => {
      const f = { mclock: m.S.mclock, half: m.S.half, ht: false, over: false, paused: false, speed: 1, mscale: 1, score: m.S.score.slice(), stats: {}, ball: [m.ball.p.x, m.ball.p.y, m.ball.p.z],
        players: m.players.map((p: any) => [p.pos2.x, p.pos2.y, 0, 0, p.yaw, 0]), officials: offs };
      window.dispatchEvent(new MessageEvent('message', { data: { src: 'matchcast-shell', type: 'frame', synthetic: true, frame: f } }));
    };
    (window as any).__send([[40, 20, 0, 0, 1, { type: 'signal', t: 0.1, dur: 2.2, dir: { x: 1, y: 0 }, up: 0.4 }], [10, 5, 0, 0, 0, { type: 'flag', t: 0.1, dur: 2.4 }], [90, 60, 0, 0, 2, 0]]);
  });
  const step = (n: number) => b.evaluate((k) => { const m = (window as any).__mc; for (let i = 0; i < k; i++) m.stepSim(0.05); return m.officials.map((o: any) => [Math.round(o.pos2.x), Math.round(o.pos2.y), o.act ? o.act.type : null]); }, n);
  const r = await step(10);
  expect(r).toEqual([[40, 20, 'signal'], [10, 5, 'flag'], [90, 60, null]]);
  // the desk runs the signal's clock and ends it by itself
  expect((await step(60)).map((x: any[]) => x[2])).toEqual([null, null, null]);
  expect(errs).toEqual([]);
});
