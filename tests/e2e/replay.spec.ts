import { test, expect } from './fixtures';
import { collectErrors, openShell, stepSim, viewFrame } from './helpers';

// Broadcast instant replay: the desk buffers Watch's frames and plays the last seconds back, then returns to live.
const tab = (page: import('@playwright/test').Page, v: string) => page.evaluate((x) => document.getElementById('tab-' + x)!.click(), v);

test('instant replay plays earlier frames, shows a REPLAY tag, then returns to live', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  const w = await viewFrame(page, 'watch');
  await expect.poll(() => w.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await w.evaluate(() => { (window as any).__mc.S.paused = true; });   // only the test moves the match, so the frames are predictable
  await tab(page, 'broadcast');
  const b = await viewFrame(page, 'broadcast');
  await expect.poll(() => b.evaluate(() => !!(window as any).MCReplay && !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  // step until the buffer holds frames and the ball has moved at least 1 m since the first one (under load the buffer samples wall-clock time, so a fixed number of steps can leave the ball where it started)
  const ballAt = () => w.evaluate(() => { const m = (window as any).__mc; return [m.ball.p.x, m.ball.p.y]; });
  const start = await ballAt();
  for (let i = 0; i < 40; i++) {
    await stepSim(w, 150); await page.waitForTimeout(350);
    const now = await ballAt();
    if (i >= 7 && Math.hypot(now[0] - start[0], now[1] - start[1]) > 1 && (await b.evaluate(() => (window as any).MCReplay.buffered)) > 2) break;
  }
  await expect.poll(() => b.evaluate(() => (window as any).MCReplay.buffered), { timeout: 20_000 }).toBeGreaterThan(2);
  const live = await b.evaluate(() => (window as any).__mc.S.mclock);
  const liveState = await b.evaluate(() => { const m = (window as any).__mc; return { ball: [m.ball.p.x, m.ball.p.y], score: m.S.score.slice() }; });
  await expect(b.locator('#mc-replay-tag')).toBeHidden();

  // the buffer is only a few seconds long here, so drive the whole first replay from inside the page before it ends by itself
  const r = await b.evaluate(async () => {
    const q = (id: string) => document.getElementById(id)!;
    (document.querySelector('#mc-replay button[data-sec="10"]') as HTMLElement).click();
    await new Promise((x) => setTimeout(x, 120));
    const m = (window as any).__mc;
    const out = { tag: !q('mc-replay-tag').hidden, playing: (window as any).MCReplay.playing, ball: [m.ball.p.x, m.ball.p.y], clock: m.S.mclock, score: m.S.score.slice() };
    q('mc-replay-live').click();
    return { ...out, tagAfter: !q('mc-replay-tag').hidden, playingAfter: (window as any).MCReplay.playing };
  });
  expect(r.tag).toBe(true);
  expect(r.playing).toBe(true);
  expect(Math.hypot(r.ball[0] - liveState.ball[0], r.ball[1] - liveState.ball[1]), 'replay shows the ball where it was').toBeGreaterThan(0.3);
  expect(r.clock, 'clock stays live').toBeGreaterThan(live - 2);
  expect(r.score, 'score stays live').toEqual(liveState.score);
  expect(r.tagAfter).toBe(false);
  expect(r.playingAfter).toBe(false);
  await expect.poll(() => b.evaluate(() => (window as any).__mc.S.mclock), { timeout: 10_000 }).toBeGreaterThan(live - 2);

  // too little buffered: start refuses; a second start restarts
  expect(await b.evaluate(() => { (window as any).MCReplay.stop(); return (window as any).MCReplay.start(10, 1) && (window as any).MCReplay.start(10, 1); })).toBe(true);
  await b.evaluate(() => (window as any).MCReplay.stop());

  // slow-mo label, and a replay ends by itself
  await b.locator('#mc-replay-slow').check();
  await b.locator('#mc-replay button[data-sec="10"]').click();
  await expect(b.locator('#mc-replay-tag')).toContainText('SLOW-MO');
  await expect(b.locator('#mc-replay-tag')).toBeHidden({ timeout: 30_000 });
  expect(errs).toEqual([]);
});
