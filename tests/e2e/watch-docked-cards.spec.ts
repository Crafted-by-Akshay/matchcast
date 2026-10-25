import { test, expect } from './fixtures';
import { openShell, ready, viewFrame } from './helpers';

// UX review pass 8 and 9: the opened Live commentary card covered Match Pulse's Key moments text and, with the Copilot drawer open, its tabs; the followed-player card sat under the commentary card.
// Watch shares the stage with Broadcast, so its frame is narrower than the window (about 58 percent of it): the layout is keyed on the frame's own width, not the window's.
const overlap = (a: any, b: any) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
for (const [name, width, height] of [['desktop', 1440, 900], ['wide laptop', 1280, 720], ['laptop', 1024, 768], ['phone', 390, 844]] as const) {
  test(`Watch on ${name}: the commentary card keeps clear of Match Pulse, the Copilot drawer and the followed-player card`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width, height });
    await openShell(page, 'watch');
    await ready('watch')(page);
    const f = await viewFrame(page, 'watch');
    await expect.poll(() => f.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
    await f.waitForSelector('#mcf', { state: 'attached', timeout: 60_000 });
    const rects = () => f.evaluate(() => {
      const rect = (id: string) => { const e = document.getElementById(id); if (!e) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return null; const r = e.getBoundingClientRect(); return r.width ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
      return { iw: innerWidth, pulse: rect('pulse'), mcf: rect('mcf'), card: rect('fan-pcard'), third: rect('third'), drawer: rect('copilot'), cap: rect('cap'), cp: rect('cpbtn'), talk: rect('mcx-talk') };
    });
    const iw = (await rects()).iw;
    // open the list: when the frame has room for it the card moves right of the Pulse column; the list never reaches into Pulse
    await f.evaluate(() => (document.getElementById('mcf-tog') as HTMLElement).click());
    if (iw >= 700) {
      await expect.poll(async () => { const m = await rects(); return !overlap(m.pulse, m.mcf); }, { timeout: 15_000, message: 'the opened commentary card shares no pixels with Match Pulse' }).toBe(true);
      const open = await rects();
      expect(open.mcf!.r, 'inside the view').toBeLessThanOrEqual(open.iw);
      expect(overlap(open.mcf, open.cp) || overlap(open.mcf, open.talk), 'the opened commentary card does not cover the Copilot or Talk buttons').toBe(false);
    }
    // the Copilot drawer: the commentary card never sits on top of it or on Pulse (it steps aside while the drawer is open)
    if (iw > 560) {
      await f.evaluate(() => (document.getElementById('cpbtn') as HTMLElement).click());
      await expect.poll(async () => { const m = await rects(); return !!m.drawer && !overlap(m.mcf, m.drawer) && !overlap(m.mcf, m.pulse); }, { timeout: 15_000, message: 'with the Copilot drawer open the commentary card covers neither the drawer nor Pulse' }).toBe(true);
      await f.evaluate(() => (document.getElementById('cp-close') as HTMLElement | null)?.click());
    }
    await f.evaluate(() => (document.getElementById('mcf-tog') as HTMLElement).click());
    // follow a player: his card appears and must not be covered by the commentary card, Pulse or the On-the-ball card
    await f.evaluate(() => (document.getElementById('cpbtn') as HTMLElement).click());
    await f.evaluate(() => (document.querySelector('#cp-tabs button[data-t="talk"]') as HTMLElement).click());
    await f.evaluate(() => (document.querySelectorAll('#tk-roster button:not([disabled])')[1] as HTMLElement).click());
    await f.evaluate(() => (document.getElementById('cp-close') as HTMLElement | null)?.click());
    await expect.poll(async () => { const m = await rects(); return !!m.card && !overlap(m.card, m.mcf) && !overlap(m.card, m.third) && (iw <= 560 || !overlap(m.card, m.pulse)) && !overlap(m.card, m.cap); }, { timeout: 20_000, message: 'the followed-player card is shown and shares no pixels with the commentary card, Pulse, the caption card or the On-the-ball card' }).toBe(true);
  });
}
