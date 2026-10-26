import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, stepSim, viewFrame } from './helpers';

declare const AG: any;

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

test('the first Verifier-checked line is on screen within the first 15 match seconds, and says it is Simulated', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const docs: string[] = [];
  page.on('request', (r) => { if (r.resourceType() === 'document') docs.push(r.url()); });
  await openShell(page, 'watch', '?split=0');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  let steps = 0;
  await expect.poll(async () => {
    await stepSim(f, 20); steps += 20;   // 20 steps of 0.05 s = 1 s at normal speed; Watch batches events once a second
    return page.evaluate(() => { const c = AG.run && AG.run.claims.find((x: any) => x.verdict === 'verified'); return c ? { kind: c.kind, minute: c.minute, text: c.text } : null; });
  }, { intervals: [1100], timeout: 120_000, message: 'no verified claim' }).not.toBeNull();
  const c = await page.evaluate(() => { const x = AG.run.claims.find((y: any) => y.verdict === 'verified'); return { minute: x.minute, text: x.text }; });
  expect(c.minute, 'match minutes (0.25 = 15 match seconds)').toBeLessThanOrEqual(0.5);
  expect(steps * 0.05, 'simulated seconds at 1x until the first verified claim').toBeLessThanOrEqual(15);
  // honest labels: the Agents-tab claim is the in-page rules' (Simulated), recounted from the event log
  const claim = await page.evaluate(() => { const x = AG.run.claims.find((y: any) => y.verdict === 'verified'); return { source: x.source, reason: x.reason, kind: x.kind, route: x.route }; });
  expect(claim).toMatchObject({ source: 'rules', kind: 'xg_total' });
  expect(claim.reason).toMatch(/recount from the event log matches/);
  // and the same line reaches Watch as a Match Pulse card: Verified in page, In-page (Simulated)
  const card = f.locator('#mcx-log .mcx-c').last();
  await expect(card.locator('.mcx-t')).toHaveText('✓ Verified in page');
  await expect(card.locator('.mcx-ch.fb')).toHaveText('In-page (Simulated)');
  await expect(card.locator('p')).toHaveText(c.text);
  expect(c.text).not.toMatch(/^After 0'/);   // a sub-minute total reads as a clock (0:15), not as minute 0
  expect(c.text).toMatch(/^After 0:\d\d: .* [\d.]+ xG, .* [\d.]+ xG\.$/);
  // the Broadcast desk and the Analyst console stay unloaded: no iframe and no document request for them
  expect(page.frames().filter((fr) => /\/(broadcast|analyst)\/index\.html/.test(fr.url()))).toHaveLength(0);
  expect(docs.filter((u) => /\/(broadcast|analyst)\//.test(u))).toEqual([]);
  expect(errs).toEqual([]);
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
    await expect.poll(async () => {
      await stepSim(f, 20);
      return (await ratio()).pr;
    }, { intervals: [1100], timeout: 120_000, message: 'ratio was never restored after the first verified line' }).toBeGreaterThan(1);
    const after = await ratio();
    expect(after.canvasW, 'canvas is back to the engine ratio').toBeGreaterThanOrEqual(Math.floor(after.cssW * after.pr) - 2);
  });
});
