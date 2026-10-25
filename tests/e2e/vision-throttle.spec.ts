import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// The Vision tracker captures pixels on a timer. When a capture costs real time (a slow machine), the capture period stretches so captures use a bounded share of the frame budget, and it eases back when they get cheap.
test('vision: the capture period stretches when captures are slow, and eases back when they are cheap', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  const r = await f.evaluate(() => {
    const w = window as any, V = w.__mc.vis.VIS;
    V.period = 0.2; V.cost.cap = V.cost.cls = V.cost.det = 0; V.cost.n = 0;
    w.mcVisThrottle();                                   // first look: remembers the counters
    V.cost.cap = 400; V.cost.n = 1;                      // one capture job that cost 400 ms
    const slow = w.mcVisThrottle();
    V.cost.cap = 800; V.cost.n = 2;
    const slower = w.mcVisThrottle();
    for (let i = 3; i < 12; i++) { V.cost.cap = 800 + (i - 2); V.cost.n = i; w.mcVisThrottle(); }   // then 1 ms captures
    const back = V.period;
    return { slow, slower, back };
  });
  expect(r.slow).toBeGreaterThan(0.5);
  expect(r.slower).toBeGreaterThan(r.slow);
  expect(r.slower).toBeLessThanOrEqual(3);
  expect(r.back).toBeLessThan(r.slower);
  expect(r.back).toBeGreaterThanOrEqual(0.2);
  expect(errs).toEqual([]);
});
