import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, stepSim, viewFrame } from './helpers';

declare const AG: any;
declare const mins: (m: number) => string;

// First-load budget (EXP first-load, docs/architecture/11-frontend.md "First-load budget").
// Wall-clock is noisy under software GL, so the budget is asserted in things that do not move: simulator steps,
// which views and files are fetched, and what the head blocks on. No waitForTimeout.

test('the shell head does not block first paint on the web font', async ({ page }) => {
  const html = await (await page.request.get('/index.html')).text();
  const head = html.slice(0, html.indexOf('</head>'));
  const fontLinks = head.replace(/<noscript>[\s\S]*?<\/noscript>/g, '').match(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/g) || [];
  expect(fontLinks.length, 'the Inter stylesheet is still requested').toBeGreaterThan(0);
  for (const l of fontLinks) expect(l, 'a stylesheet link without media=print is render-blocking').toMatch(/media="print"/);
  expect(head, 'a noscript fallback keeps the font for no-JS viewers').toMatch(/<noscript>\s*<link[^>]+fonts\.googleapis\.com/);
});

const totals = () => AG.run.claims.filter((x: any) => x.kind === 'xg_total').map((x: any) => ({ id: x.id, minute: x.minute, verdict: x.verdict, source: x.source, reason: x.reason, text: x.text, xg: x.inputs.xg }));

test('the shell clock formats sub-minute match time without float rounding', async ({ page }) => {
  await openShell(page, 'watch', '?split=0');
  const r = await page.evaluate(() => ({ a: mins(0.25), b: mins(0.35), c: mins(0.5), d: mins(0.99), e: mins(1.2), f: mins(0) }));
  expect(r).toEqual({ a: '0:15', b: '0:21', c: '0:30', d: '0:59', e: "1'", f: '0:00' });
});

test('the first checked line: an early total in the Agents tab, the same line is the first card on Watch, honestly labelled', async ({ page }) => {
  test.setTimeout(400_000);
  const errs = collectErrors(page);
  const docs: string[] = [];
  page.on('request', (r) => { if (r.resourceType() === 'document') docs.push(r.url()); });
  await openShell(page, 'watch', '?split=0');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  let steps = 0;
  // 1. the first verified claim (the opening total) comes within 15 simulated seconds
  await expect.poll(async () => { await stepSim(f, 20); steps += 20; return page.evaluate(() => AG.run.claims.some((x: any) => x.verdict === 'verified')); }, { intervals: [1100], timeout: 120_000, message: 'no verified claim' }).toBe(true);
  expect(steps * 0.05, 'simulated seconds at 1x until the first verified claim').toBeLessThanOrEqual(15);
  const first = (await page.evaluate(totals))[0];
  expect(first.minute).toBeLessThanOrEqual(0.5);
  expect(first).toMatchObject({ verdict: 'verified', source: 'rules' });
  expect(first.reason).toMatch(/recount from the event log matches/);
  expect(first.text).toBe(`After ${await page.evaluate((m) => mins(m), first.minute)}: ${first.text.split(': ')[1]}`);   // the clock text and the shell clock agree
  expect(first.text).toMatch(/^After 0:\d\d: .* [\d.]+ xG, .* [\d.]+ xG\.$/);
  // 2. the same opening total is Watch's first checked line (a shot-free sim can go many match minutes without a goal, shot or moment, so a Pulse card must not wait for one)
  const card = f.locator('#mcx-log .mcx-c');
  await expect(card).toHaveCount(1);
  await expect(card.locator('p')).toHaveText(first.text);
  await expect(card.locator('.mcx-t')).toHaveText('✓ Verified in page');
  await expect(card.locator('.mcx-ch.fb')).toHaveText('In-page (Simulated)');
  console.log(`first-load: opening total and first Watch card after ${steps} steps (${steps * 0.05} s)`);
  // the Broadcast desk and the Analyst console stay unloaded: no iframe and no document request for them
  expect(page.frames().filter((fr) => /\/(broadcast|analyst)\/index\.html/.test(fr.url()))).toHaveLength(0);
  expect(docs.filter((u) => /\/(broadcast|analyst)\//.test(u))).toEqual([]);
  expect(errs).toEqual([]);
});

test('later running totals stay off Watch: one total card per run', async ({ page }) => {
  test.setTimeout(500_000);
  await openShell(page, 'watch', '?split=0');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect.poll(async () => { await stepSim(f, 100); return (await page.evaluate(totals)).length; }, { intervals: [1100], timeout: 300_000, message: 'fewer than two totals' }).toBeGreaterThanOrEqual(2);
  const all = await page.evaluate(totals);
  expect(all.every((t: any) => t.verdict === 'verified')).toBe(true);
  await expect.poll(() => f.locator('#mcx-log .mcx-c p').allTextContents().then((a) => a.filter((t) => /^After /.test(t)).length)).toBe(1);
});

test.describe('on a high-density screen', () => {
  test.use({ deviceScaleFactor: 2 });
  test('Watch draws at pixel ratio 1 until the first verified line, then restores the engine ratio', async ({ page }) => {
    test.setTimeout(300_000);
    await openShell(page, 'watch', '?split=0');
    await ready('watch')(page);
    const f = await viewFrame(page, 'watch');
    const ratio = () => f.evaluate(() => { const r = (window as any).__mc.composer.renderer; return { pr: r.getPixelRatio(), canvasW: r.domElement.width, cssW: r.domElement.clientWidth }; });
    const first = await ratio();
    expect(first.pr, 'first paint at ratio 1').toBe(1);
    expect(first.canvasW, 'canvas has one pixel per CSS pixel').toBeLessThanOrEqual(first.cssW + 1);
    // software GL is slow enough for the fps rule (adaptive-resolution.spec.ts) to hold ratio 1 on its own: this test is about the first-line rule, so the fps sampler is stopped and cleared
    await f.evaluate(() => { (window as any).__mcRes.stop(); (window as any).__mcRes.reset(); });
    await expect.poll(async () => {
      await stepSim(f, 20);
      return (await ratio()).pr;
    }, { intervals: [1100], timeout: 120_000, message: 'ratio was never restored after the first verified line' }).toBeGreaterThan(1);
    const after = await ratio();
    expect(after.canvasW, 'canvas is back to the engine ratio').toBeGreaterThanOrEqual(Math.floor(after.cssW * after.pr) - 2);
  });
});
