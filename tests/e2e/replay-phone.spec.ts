import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// UX review pass 5: at 390 px the replay controls wrapped badly ("Instant replay" on two lines, "Slow- / mo"). The heading now has its own row,
// the clip buttons and the Slow-mo switch share one row with no label breaking, every control is a 44 px target, and "Back to live" stays hidden until a replay plays.
for (const width of [390, 320]) {
  test(`Broadcast at ${width} px: the replay controls sit on two rows, keep their labels whole and are 44 px tall`, async ({ page }) => {
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
      const head = bar.querySelector('span')!, clips = [...bar.querySelectorAll('button[data-sec]')], slow = bar.querySelector('label')!;
      const lines = (el: Element) => { const r = document.createRange(); r.selectNodeContents([...el.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim()) ?? el); return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size; };
      const live = document.getElementById('mc-replay-live')!;
      return {
        barW: rect(bar).width, barScroll: bar.scrollWidth,
        headBottom: rect(head).bottom, rowTops: [...clips, slow].map((el) => Math.round(rect(el).top)),
        heights: [...clips, slow].map((el) => rect(el).height),
        lines: [head, ...clips, slow].map((el) => lines(el)),
        liveShown: getComputedStyle(live).display !== 'none' && !live.hidden,
      };
    });
    expect(m.barScroll, 'the bar does not scroll sideways').toBeLessThanOrEqual(m.barW + 1);
    if (width >= 390) expect(new Set(m.rowTops).size, 'the three clip buttons and Slow-mo share one row').toBe(1);   // a 320 px phone may wrap the row, never a label
    expect(m.headBottom, 'the heading sits above the controls').toBeLessThanOrEqual(m.rowTops[0] + 1);
    for (const h of m.heights) expect(h, 'a 44 px target').toBeGreaterThanOrEqual(43);
    expect(m.lines.every((n) => n === 1), 'no label breaks across lines').toBe(true);
    expect(m.liveShown, 'Back to live stays hidden until a replay plays').toBe(false);
    expect(errs).toEqual([]);
  });
}
