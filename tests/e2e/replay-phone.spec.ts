import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// UX review pass 5: at 390 px the replay controls wrapped badly ("Instant replay" on two lines, "Slow- / mo"). The bar is now one row (the clip buttons and the Slow-mo switch; the group keeps its "Instant replay" name) with no label breaking, every control is a 44 px target, the bar is short enough to clear the lower-third in the phone stage,
// and "Back to live" stays hidden until a replay plays.
for (const width of [390, 320]) {
  test(`Broadcast at ${width} px: the replay controls sit on one row, keep their labels whole and are 44 px tall`, async ({ page }) => {
    test.setTimeout(300_000);
    const errs = collectErrors(page);
    await page.setViewportSize({ width, height: 844 });
    await openShell(page, 'broadcast');
    await ready('broadcast')(page);
    const b = await viewFrame(page, 'broadcast');
    await b.waitForSelector('#mc-replay', { state: 'attached', timeout: 120_000 });
    const m = await b.evaluate(() => {
      const bar = document.getElementById('mc-replay')!;
      const rect = (el: Element) => el.getBoundingClientRect();
      const clips = [...bar.querySelectorAll('button[data-sec]')], slow = bar.querySelector('label')!;
      const lines = (el: Element) => { const r = document.createRange(); r.selectNodeContents([...el.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim()) ?? el); return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size; };
      const live = document.getElementById('mc-replay-live')!;
      return {
        barW: rect(bar).width, barScroll: bar.scrollWidth,
        rowTops: [...clips, slow].map((el) => Math.round(rect(el).top)),
        heights: [...clips, slow].map((el) => rect(el).height),
        lines: [...clips, slow].map((el) => lines(el)),
        barH: rect(bar).height, groupName: bar.getAttribute('aria-label'),
        liveShown: getComputedStyle(live).display !== 'none' && !live.hidden,
      };
    });
    expect(m.barScroll, 'the bar does not scroll sideways').toBeLessThanOrEqual(m.barW + 1);
    expect(m.groupName, 'the group is still named for screen readers').toBe('Instant replay');
    if (width >= 390) {   // a 320 px phone may wrap the row, never a label
      expect(Math.max(...m.rowTops) - Math.min(...m.rowTops), 'the clip buttons and Slow-mo share one row').toBeLessThanOrEqual(2);
      expect(m.barH, 'short enough to clear the lower-third in the phone stage').toBeLessThanOrEqual(64);
    }
    for (const h of m.heights) expect(h, 'a 44 px target').toBeGreaterThanOrEqual(43);
    expect(m.lines.every((n) => n === 1), 'no label breaks across lines').toBe(true);
    expect(m.liveShown, 'Back to live stays hidden until a replay plays').toBe(false);
    if (width >= 390) {   // a replay in progress: Back to live takes the clips' place and the bar stays one row, clear of the lower-third
      const p = await b.evaluate(() => {
        const bar = document.getElementById('mc-replay')!, live = document.getElementById('mc-replay-live')!, l3 = document.getElementById('mc-l3')!;
        bar.classList.add('rp-on'); live.hidden = false; l3.hidden = false; l3.textContent = "23' Goal for Thames Rovers (A One). Thames Rovers 1–0 Coloso Ciudad at 23 minutes.";
        const r = bar.getBoundingClientRect(), t = l3.getBoundingClientRect();
        return { barH: r.height, barBottom: r.bottom, l3Top: t.top, clipsShown: [...bar.querySelectorAll('button[data-sec],label')].some((e) => getComputedStyle(e).display !== 'none'), liveShown: getComputedStyle(live).display !== 'none' };
      });
      expect(p.liveShown, 'Back to live shows during a replay').toBe(true);
      expect(p.clipsShown, 'the clips give way to it').toBe(false);
      expect(p.barH, 'still one row').toBeLessThanOrEqual(64);
      expect(p.barBottom, 'clear of the lower-third').toBeLessThanOrEqual(p.l3Top);
    }
    expect(errs).toEqual([]);
  });
}
