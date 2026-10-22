import { test, expect } from '@playwright/test';
import { collectErrors, openShell, viewFrame } from './helpers';

// Broadcast draws the same action poses as Watch: Watch's frames carry each player's current action and Broadcast applies it.
const tab = (page: import('@playwright/test').Page, v: string) => page.evaluate((x) => document.getElementById('tab-' + x)!.click(), v);

test('a player action in Watch shows as the same pose in Broadcast', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  const w = await viewFrame(page, 'watch');
  await expect.poll(() => w.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await w.evaluate(() => { const m = (window as any).__mc; m.S.paused = true; m.players[5].act = { type: 'header', t: 0.2, dur: 0.75, h: 0.5 }; m.players[9].act = { type: 'slide', t: 0.3, dur: 1.5, side: 1 }; });
  await tab(page, 'broadcast');
  const b = await viewFrame(page, 'broadcast');
  await expect.poll(() => b.evaluate(() => { const m = (window as any).__mc; return !!m?.S.started && m.players[5].act?.type === 'header'; }), { timeout: 240_000 }).toBe(true);
  expect(await b.evaluate(() => (window as any).__mc.players[9].act?.type)).toBe('slide');
  // Watch's player is idle again: Broadcast drops the pose
  await w.evaluate(() => { const m = (window as any).__mc; m.players[5].act = null; m.players[9].act = null; });
  await expect.poll(() => b.evaluate(() => (window as any).__mc.players[5].act), { timeout: 20_000 }).toBeNull();

  // running path (not paused): the desk advances the action's clock between Watch's 4 Hz frames and lets it expire by itself.
  // Watch's own frames are held back so the test sends the only ones.
  await tab(page, 'broadcast');
  await b.evaluate(() => {
    window.addEventListener('message', (e) => { const d = e.data || {}; if (d.src === 'matchcast-shell' && d.type === 'frame' && !d.synthetic) e.stopImmediatePropagation(); }, true);
    const m = (window as any).__mc; (window as any).__sendFrame = (act: any) => {
      const f = { mclock: m.S.mclock, half: m.S.half, ht: false, over: false, paused: false, speed: 1, mscale: 1, score: m.S.score.slice(), stats: {}, ball: [m.ball.p.x, m.ball.p.y, m.ball.p.z],
        players: m.players.map((p: any, i: number) => [p.pos2.x, p.pos2.y, 0, 0, p.yaw, i === 3 ? act : 0]) };
      window.dispatchEvent(new MessageEvent('message', { data: { src: 'matchcast-shell', type: 'frame', synthetic: true, frame: f } }));
    };
    (window as any).__sendFrame({ type: 'slide', t: 0.1, dur: 600, side: -1 });
  });
  // the render loop is slow here, so step the desk by hand: stepSim is consumerStep in the unified app
  const step = (n: number) => b.evaluate((k) => { const m = (window as any).__mc; for (let i = 0; i < k; i++) m.stepSim(0.05); return m.players[3].act ? { side: m.players[3].act.side, t: m.players[3].act.t } : { none: 1 }; }, n);
  const s1 = await step(2);
  expect(s1).toEqual({ side: -1, t: expect.any(Number) });
  const s2 = await step(4);
  expect(s2!.t, 'the desk runs the action clock').toBeGreaterThan(s1!.t + 0.15);
  // a short action of another type replaces it, then ends by itself
  await b.evaluate(() => (window as any).__sendFrame({ type: 'header', t: 0.1, dur: 0.3, h: 0.5 }));
  expect(await step(2)).toMatchObject({ side: undefined });
  expect(await step(40), 'the pose ends by itself').toMatchObject({ none: 1 });
  expect(errs).toEqual([]);
});
