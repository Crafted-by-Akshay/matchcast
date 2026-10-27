import { test, expect } from './fixtures';

// Browse keeps its three primary routes visible and groups secondary pages, tools and utilities in More.
for (const width of [1280, 1440]) {
  test(`shell header at ${width} px: primary routes fit beside the wordmark and tools stay reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/index.html#analyst', { waitUntil: 'domcontentloaded' });
    const m = await page.evaluate(() => {
      const r = (s: string) => { const e = document.querySelector(s) as HTMLElement; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, sw: e.scrollWidth, cw: e.clientWidth }; };
      const primary = [...document.querySelectorAll('.switch > [data-view]')].map((b) => b.textContent?.trim());
      const tools = [...document.querySelectorAll('#more-menu [data-view]')].map((b) => b.textContent?.trim());
      const utilities = [...document.querySelectorAll('#more-menu #crew-btn,#more-menu #tour-btn,#more-menu #status-btn')].map((b) => b.textContent?.trim());
      return { brand: r('.top .brand'), word: r('.top .brand b'), sw: r('.switch'), primary, tools, utilities };
    });
    expect(m.brand.r, 'the switcher starts after the wordmark').toBeLessThanOrEqual(m.sw.l + 1);
    expect(m.word.sw, 'the wordmark is not clipped').toBeLessThanOrEqual(m.word.cw + 1);
    expect(m.sw.sw, 'navigation fits without horizontal scrolling').toBeLessThanOrEqual(m.sw.cw + 1);
    expect(m.primary).toEqual(['Home', 'Matches', 'Watch']);
    expect(m.tools).toEqual(['Highlights', 'My List', 'My Club', 'Analyze', 'Production Studio', 'Agents']);
    expect(m.utilities).toEqual(['Crew', 'Tour', 'Status & service details']);
    await page.locator('#more-toggle').click();
    await expect(page.locator('#more-menu')).toBeVisible();
    await page.locator('#tab-analyst').click();
    await expect(page).toHaveURL(/#analyst$/);
    await expect(page.locator('#more-toggle')).toHaveAttribute('aria-label', 'More, current page: Analyze');
  });
}
