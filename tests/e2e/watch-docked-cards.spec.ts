import { test, expect } from './fixtures';
import { openShell, ready, viewFrame } from './helpers';

// UX review pass 8: the opened Live commentary card used to cover Match Pulse's Key moments text, and the followed-player card sat under the commentary card.
// The commentary card stays clear of Match Pulse on wide screens (above 1100 px), and the followed-player card is never covered by it.
const overlap = (a: any, b: any) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
for (const [name, width, height] of [['desktop', 1440, 900], ['wide laptop', 1280, 720], ['laptop', 1024, 768], ['phone', 390, 844]] as const) {
  test(`Watch on ${name}: the commentary card keeps clear of Match Pulse and the followed-player card`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height });
    await openShell(page, 'watch');
    await ready('watch')(page);
    const f = await viewFrame(page, 'watch');
    await expect.poll(() => f.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
    await f.waitForSelector('#mcf', { state: 'attached', timeout: 60_000 });
    const rects = () => f.evaluate(() => {
      const rect = (id: string) => { const e = document.getElementById(id); if (!e || getComputedStyle(e).display === 'none') return null; const r = e.getBoundingClientRect(); return r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
      return { iw: innerWidth, pulse: rect('pulse'), mcf: rect('mcf'), card: rect('fan-pcard'), third: rect('third') };
    });
    // open the list: on a wide screen the card moves right of the Pulse column; the list never reaches into it
    await f.evaluate(() => (document.getElementById('mcf-tog') as HTMLElement).click());
    // wide screens only: below 1100 px the list is shortened instead of moved, and there is not always room to clear Pulse completely
    if (width > 1100) {
      await expect.poll(async () => { const m = await rects(); return !overlap(m.pulse, m.mcf); }, { timeout: 15_000 }).toBe(true);
      const open = await rects();
      expect(open.mcf!.r, 'inside the view').toBeLessThanOrEqual(open.iw);
    }
    await f.evaluate(() => (document.getElementById('mcf-tog') as HTMLElement).click());
    // follow a player: his card appears and must not be covered by the commentary card
    await f.evaluate(() => (document.getElementById('cpbtn') as HTMLElement).click());
    await f.evaluate(() => (document.querySelector('#cp-tabs button[data-t="talk"]') as HTMLElement).click());
    await f.evaluate(() => (document.querySelectorAll('#tk-roster button:not([disabled])')[1] as HTMLElement).click());
    await f.evaluate(() => (document.getElementById('cp-close') as HTMLElement | null)?.click());
    await expect.poll(async () => { const m = await rects(); return !!m.card && !overlap(m.card, m.mcf) && !overlap(m.card, m.third); }, { timeout: 20_000, message: 'the followed-player card is shown and shares no pixels with the commentary or On-the-ball cards' }).toBe(true);
  });
}
