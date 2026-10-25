import { test, expect } from './fixtures';

// UX review pass 9: at 1280 px the view switcher covered the MatchCast wordmark. The wordmark keeps its width and the four tabs fit beside it.
for (const width of [1280, 1440]) {
  test(`shell header at ${width} px: the wordmark is whole and the four tabs fit`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/index.html#analyst', { waitUntil: 'domcontentloaded' });
    const m = await page.evaluate(() => {
      const r = (s: string) => { const e = document.querySelector(s) as HTMLElement; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, sw: e.scrollWidth, cw: e.clientWidth }; };
      const tabs = [...document.querySelectorAll('.switch button')].map((b) => { const x = b.getBoundingClientRect(); return { l: x.left, r: x.right }; });
      return { brand: r('.top .brand'), word: r('.top .brand b'), sw: r('.switch'), tabs, az: (document.querySelector('.status .pill.warn') as HTMLElement).innerText.trim() };
    });
    expect(m.brand.r, 'the switcher starts after the wordmark').toBeLessThanOrEqual(m.sw.l + 1);
    expect(m.word.sw, 'the wordmark is not clipped').toBeLessThanOrEqual(m.word.cw + 1);
    expect(m.sw.sw, 'the four tabs fit without scrolling').toBeLessThanOrEqual(m.sw.cw + 1);
    expect(m.tabs.length).toBe(4);
    expect(m.az, 'the Azure pill keeps its spaces').toBe('Azure parts simulated');
  });
}
