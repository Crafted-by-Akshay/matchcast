import { test, expect } from './fixtures';

test('Home, Matches, Highlights and My List stay in the shell until a match is opened', async ({ page }) => {
  await page.goto('/index.html#home', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);

  const watchLoaded = () => page.frames().some((frame) => /watch\/index\.html/.test(frame.url()));
  expect(await watchLoaded()).toBe(false);
  await page.locator('#tab-matches').click();
  await expect(page).toHaveURL(/#matches$/);
  expect(await watchLoaded()).toBe(false);

  await page.locator('#more-toggle').click();
  await page.locator('#tab-highlights').click();
  await expect(page).toHaveURL(/#highlights$/);
  await expect(page.locator('#v-highlights')).toContainText('No clips are available yet');
  await expect(page.locator('#v-highlights button')).toHaveCount(0);
  expect(await watchLoaded()).toBe(false);

  await page.locator('#more-toggle').click();
  await page.locator('#tab-my-list').click();
  await expect(page).toHaveURL(/#my-list$/);
  await expect(page.locator('#saved-note')).toContainText('Saved on this device');
  await expect(page.locator('#saved-empty')).toBeVisible();
  expect(await watchLoaded()).toBe(false);
});

test('My List saves and removes matches on this device', async ({ page }) => {
  await page.goto('/index.html#home', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
  await expect(page.locator('#home-rows [data-save-fx]').first()).toBeVisible();
  await page.locator('#home-rows [data-save-fx]').first().click();
  await expect(page.locator('#home-rows [data-save-fx]').first()).toContainText('Remove from My List');

  await page.locator('#more-toggle').click();
  await page.locator('#tab-my-list').click();
  await expect(page.locator('#saved-note')).toContainText('Saved on this device');
  await expect(page.locator('#saved-grid .match-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#saved-grid .match-card')).toHaveCount(1);

  await page.locator('#saved-grid [data-save-fx]').click();
  await expect(page.locator('#saved-empty')).toBeVisible();
  await expect(page.locator('#saved-grid .match-card')).toHaveCount(0);
});

test('Highlights never offers playback for moments without a saved clip', async ({ page }) => {
  await page.goto('/index.html#highlights', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
  await expect(page.locator('#v-highlights')).toContainText('No clips are available yet');
  await expect(page.locator('#v-highlights button')).toHaveCount(0);

  await page.evaluate(() => {
    const hl = (window as any).HL;
    hl.reset({ home: 'Northbridge', away: 'Eastport' }, []);
    hl.side = (team: string) => team === 'h' ? 0 : team === 'a' ? 1 : -1;
    for (let i = 0; i < 12; i++) hl.frame({ mclock: i / 2, frame: { i } });
    hl.add([{ minute: 12, type: 'goal', team: 'h', player: 'A One' }]);
  });
  await page.locator('#more-toggle').click();
  await page.locator('#tab-highlights').click();
  await expect(page.locator('#v-highlights .highlight-card')).toHaveCount(1);
  await expect(page.locator('#v-highlights button')).toContainText('Replay in 3D');
  expect(page.frames().some((frame) => /watch\/index\.html/.test(frame.url()))).toBe(false);
});

test('Opening a match from its card is the action that starts Watch', async ({ page }) => {
  await page.goto('/index.html#matches', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
  await page.locator('#v-matches .match-open').first().click();
  await expect(page).toHaveURL(/#watch$/);
  await expect.poll(() => page.frames().some((frame) => /watch\/index\.html/.test(frame.url()))).toBe(true);
});

for (const width of [390, 768, 1440]) {
  test(`Home and Matches fit the ${width} px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/index.html#home', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
    const home = await page.evaluate(() => {
      const offscreen = [...document.querySelectorAll('.top *, .browse *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && !el.closest('.row-track') && (r.left < -1 || r.right > innerWidth + 1);
      }).map((el) => (el as HTMLElement).id || el.tagName.toLowerCase());
      return { offscreen, overflow: document.documentElement.scrollWidth - innerWidth, heading: document.querySelector('#hero h2')!.getBoundingClientRect().right };
    });
    expect(home.offscreen).toEqual([]);
    expect(home.overflow).toBeLessThanOrEqual(0);
    expect(home.heading).toBeLessThanOrEqual(width);

    await page.locator('#tab-matches').click();
    await expect(page).toHaveURL(/#matches$/);
    const library = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      filters: [...document.querySelectorAll('#lib-q,#lib-team,#lib-md,#lib-sort')].map((el) => {
        const r = el.getBoundingClientRect(); return { left: r.left, right: r.right };
      }),
    }));
    expect(library.overflow).toBeLessThanOrEqual(0);
    for (const box of library.filters) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
    }
  });
}
