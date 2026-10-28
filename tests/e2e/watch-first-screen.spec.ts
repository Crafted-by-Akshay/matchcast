import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// UX review pass 7: the first screen of Watch tells the story, not the tracker's accuracy numbers. The Vision tracker runs from kick-off,
// but its panel stays closed until asked for, and the On-the-ball card no longer hides under the Live commentary card.
// The detection boxes show while Vision is on (the panel's Boxes button hides them); the raw track ids stay in the panel.
for (const [name, width, height] of [['desktop', 1440, 900], ['wide laptop', 1280, 720], ['laptop', 1024, 768], ['phone', 390, 844]] as const) {
  test(`Watch on ${name}: Vision runs with its panel closed and its boxes shown, and the bottom cards do not overlap`, async ({ page }) => {
    test.setTimeout(300_000);
    const errs = collectErrors(page);
    await page.setViewportSize({ width, height });
    await openShell(page, 'watch');
    await ready('watch')(page);
    const f = await viewFrame(page, 'watch');
    await f.waitForFunction(() => !!(window as any).__mc?.vis?.VIS?.on, null, { timeout: 60_000 });
    await f.waitForSelector('#mcf', { state: 'attached', timeout: 60_000 });
    await page.waitForTimeout(2500);   // the card placement runs on a one second timer
    const m = await f.evaluate(() => {
      const rect = (id: string) => { const e = document.getElementById(id); if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
      const iw = innerWidth;
      return { iw, cap: rect('cap'), on: (window as any).__mc.vis.VIS.on, boxes: (window as any).__mc.vis.VIS.boxes, panel: rect('visp'), third: rect('third'), mcf: rect('mcf'), pressed: document.getElementById('visb')!.getAttribute('aria-pressed') };
    });
    expect(m.on, 'the tracker runs').toBe(true);
    expect(m.boxes, 'the detection boxes show while Vision is on').toBe(true);
    expect(m.panel, 'the Vision panel starts closed').toBeNull();
    expect(m.pressed).toBe('false');
    if (m.third && m.mcf) {
      const overlap = m.third.l < m.mcf.r && m.mcf.l < m.third.r && m.third.t < m.mcf.b && m.mcf.t < m.third.b;
      expect(overlap, 'the On-the-ball card and the Live commentary card share no pixels').toBe(false);
    }
    if (name !== 'desktop') expect(m.third, 'the On-the-ball card is hidden at 1100 px and below').toBeNull();
    if (name === 'desktop' && m.third) {
      expect(m.third.r, 'inside the view').toBeLessThanOrEqual(m.iw);
      if (m.cap) expect(m.third.r <= m.cap.l || m.cap.r <= m.third.l || m.third.b <= m.cap.t || m.cap.b <= m.third.t, 'clear of the commentary caption card').toBe(true);
    }
    await f.locator('#visb').click();
    await expect(f.locator('#visp')).toBeVisible();   // the button still opens the panel
    expect(errs).toEqual([]);
  });
}
