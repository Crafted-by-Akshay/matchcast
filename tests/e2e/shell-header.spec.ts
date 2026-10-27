import { test, expect } from './fixtures';

// Browse keeps its three primary routes visible and groups production tools in a compact menu.
for (const width of [1280, 1440]) {
  test(`shell header at ${width} px: primary routes fit beside the wordmark and tools stay reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/index.html#analyst', { waitUntil: 'domcontentloaded' });
    const m = await page.evaluate(() => {
      const r = (s: string) => { const e = document.querySelector(s) as HTMLElement; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, sw: e.scrollWidth, cw: e.clientWidth }; };
      const primary = [...document.querySelectorAll('.switch > [data-view]')].map((b) => b.textContent?.trim());
      const tools = [...document.querySelectorAll('#tools-menu [data-view]')].map((b) => b.textContent?.trim());
      return { brand: r('.top .brand'), word: r('.top .brand b'), sw: r('.switch'), primary, tools };
    });
    expect(m.brand.r, 'the switcher starts after the wordmark').toBeLessThanOrEqual(m.sw.l + 1);
    expect(m.word.sw, 'the wordmark is not clipped').toBeLessThanOrEqual(m.word.cw + 1);
    expect(m.sw.sw, 'navigation fits without horizontal scrolling').toBeLessThanOrEqual(m.sw.cw + 1);
    expect(m.primary).toEqual(['Home', 'Matches', 'Watch']);
    expect(m.tools).toEqual(['Analyze', 'Production Studio', 'Agents']);
    await page.locator('#tools-toggle').click();
    await expect(page.locator('#tools-menu')).toBeVisible();
    await page.locator('#tab-analyst').click();
    await expect(page).toHaveURL(/#analyst$/);
    await expect(page.locator('#tools-toggle')).toHaveAttribute('aria-label', 'Tools, current page: Analyze');
  });
}
