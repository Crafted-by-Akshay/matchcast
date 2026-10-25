import { test, expect } from './fixtures';
import { openShell, ready, viewFrame } from './helpers';

// UX review pass 11: in the split next to Watch, the Broadcast pane's fixed Live commentary card covered its camera chips and the stats strip.
// In a pane narrower than 700 px the card sits in the page flow under the live view and its camera chips, so it shares no pixels with the chips or the stats.
for (const [name, width, height] of [['desktop', 1440, 900], ['wide laptop', 1280, 720], ['phone', 390, 844]] as const) {
  test(`Broadcast on ${name}: the Live commentary card does not cover the camera chips or the stats strip`, async ({ page }) => {
    test.setTimeout(420_000);
    await page.setViewportSize({ width, height });
    await openShell(page, 'broadcast');
    await ready('broadcast')(page);
    const f = await viewFrame(page, 'broadcast');
    await f.waitForSelector('#mcf', { state: 'attached', timeout: 60_000 });
    const measure = () => f.evaluate(() => {
      const r = (sel: string) => { const e = document.querySelector(sel) as HTMLElement | null; if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
      return { iw: innerWidth, mcf: r('#mcf'), cams: r('#bc-cams'), mini: r('#bc-mini'), view: r('#bc-view') };
    });
    // the card is moved into the flow on a one-second tick, so give it a moment
    await expect.poll(async () => { const x = await measure(); return !!x.mcf && !!x.cams && x.mcf.t >= x.cams.b - 1; }, { timeout: 15_000, message: 'the card sits under the camera chips' }).toBe(true);
    const m = await measure();
    expect(m.iw, 'a pane narrower than 700 px').toBeLessThan(700);
    const hit = (a: any, b: any) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    expect(m.mcf, 'the commentary card is drawn').not.toBeNull();
    expect(hit(m.mcf, m.cams), 'the card covers the camera chips').toBe(false);
    expect(hit(m.mcf, m.mini), 'the card covers the stats strip').toBe(false);
    expect(m.mcf!.b, 'the card is reachable by scrolling the pane').toBeGreaterThan(0);
  });
}
