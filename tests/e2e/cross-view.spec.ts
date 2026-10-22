import { test, expect } from './fixtures';
import { collectErrors, openShell, stepSim, viewFrame } from './helpers';

declare const AG: any;

// EXP-2: Watch is the only engine. Broadcast follows its frames and events; the Analyst pill shows its score, minute and last five events.
const tab = (page: import('@playwright/test').Page, v: string) => page.evaluate((x) => document.getElementById('tab-' + x)!.click(), v);
const state = (f: import('@playwright/test').Frame) => f.evaluate(() => { const m = (window as any).__mc; return { paused: m.S.paused, score: m.S.score.slice(), mclock: m.S.mclock, last: m.ENV.events.slice(-5).map((e: any) => e.type) }; });

test('Broadcast and the Analyst follow Watch (same score, minute, events; pause carries over)', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  const w = await viewFrame(page, 'watch');
  await expect.poll(() => w.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await stepSim(w, 2000);   // a couple of match minutes, so there are events and a clock to compare
  await expect.poll(() => page.evaluate(() => AG.run?.events.length > 0), { timeout: 30_000 }).toBe(true);
  await w.evaluate(() => { (window as any).__mc.S.paused = true; });
  await page.waitForTimeout(1500);
  const ws = await state(w);

  await tab(page, 'broadcast');
  const b = await viewFrame(page, 'broadcast');
  await expect.poll(() => b.evaluate(() => { const m = (window as any).__mc; return !!(m?.S.started && m.S.paused); }), { timeout: 240_000, message: 'Broadcast should open paused' }).toBe(true);
  await page.waitForTimeout(2000);
  const bs = await state(b);
  expect(bs.paused).toBe(true);
  expect(Math.abs(bs.mclock - ws.mclock), 'Broadcast shows the same minute').toBeLessThan(1);
  expect(bs.score, 'Broadcast shows the same score').toEqual(ws.score);
  expect(bs.last.length, "Broadcast replayed Watch's events").toBeGreaterThan(0);
  await expect(b.locator('#mc-wait')).toBeHidden();

  await tab(page, 'analyst');
  const a = await viewFrame(page, 'analyst');
  await expect.poll(() => a.evaluate(() => !!document.getElementById('mc-live')), { timeout: 60_000 }).toBe(true);
  await page.waitForTimeout(1500);
  const pill = await a.evaluate(() => { const el = document.getElementById('mc-live')!; return { text: el.textContent!, last: JSON.parse(el.dataset.last || '[]') }; });
  expect(pill.text).toContain(ws.score.join('–'));
  expect(pill.last.length).toBeGreaterThan(0);
  expect(pill.last.length).toBeLessThanOrEqual(5);

  // Watch resumes: Broadcast follows
  await tab(page, 'watch'); await page.waitForTimeout(500);
  await w.evaluate(() => { (window as any).__mc.S.paused = false; });
  await stepSim(w, 400);
  await tab(page, 'broadcast');
  await expect.poll(async () => { const x = await state(b), y = await state(w); return !x.paused && x.mclock >= ws.mclock && Math.abs(x.mclock - y.mclock) < 5 && JSON.stringify(x.score) === JSON.stringify(y.score); }, { timeout: 60_000 }).toBe(true);
  expect(errs).toEqual([]);
});
