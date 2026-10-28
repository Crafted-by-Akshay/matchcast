import { test, expect } from './fixtures';
import { mkdirSync } from 'node:fs';

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

test('Home has a stadium cover, an explicitly simulated demo, and no invented upcoming scores', async ({ page }) => {
  await page.goto('/index.html#home', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
  const image = await page.locator('#hero').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(image).toContain('matchcast-stadium-cover.jpg');
  await expect(page.locator('#hero .kicker')).toContainText('SIMULATED DEMO · NO RESULT YET');
  await expect(page.locator('#hero .btn.play')).toHaveText('Start simulated match');
  await expect(page.locator('.row[aria-label="Upcoming"]')).toContainText('No upcoming fixtures in this synthetic season.');
  await expect(page.locator('.row[aria-label="Simulated demo"] .match-thumb .sc')).toHaveText('VS');
  expect(page.frames().some((frame) => /watch\/index\.html/.test(frame.url()))).toBe(false);
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
  await expect(page.locator('.highlight-thumb')).toHaveAttribute('aria-label', /not a saved video frame/);
  expect(await page.locator('.highlight-thumb').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('matchcast-stadium-cover.jpg');
  await expect(page.locator('#v-highlights button')).toContainText('Replay in 3D');
  expect(page.frames().some((frame) => /watch\/index\.html/.test(frame.url()))).toBe(false);
});

test('Opening a past match shows the saved events and stats without starting either engine', async ({ page }) => {
  await page.goto('/index.html#matches', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
  await page.locator('#v-matches .match-open').first().click();
  await expect(page).toHaveURL(/#match\/M001$/);
  await expect(page.locator('#match-detail h2')).toHaveText('Harbor City v Coloso Ciudad');
  await expect(page.locator('#match-detail .archive-note')).toContainText('not recorded video');
  await expect(page.locator('#match-detail .moment-list li').first()).toBeVisible();
  expect(page.frames().some((frame) => /watch\/index\.html/.test(frame.url()))).toBe(false);
  expect(page.frames().some((frame) => /analyst\/index\.html/.test(frame.url()))).toBe(false);
  await page.locator('#match-detail [data-match-action="back"]').click();
  await expect(page).toHaveURL(/#matches$/);
});

test('My Club remembers a favorite and lists only that club’s past synthetic season matches', async ({ page }) => {
  await page.goto('/index.html#home', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
  await page.locator('#tab-my-club').click();
  await expect(page).toHaveURL(/#my-club$/);
  await expect(page.getByRole('tab', { name: 'Ask Copilot' })).toHaveCount(0);
  await expect(page.locator('#club-ask-open')).toBeVisible();
  await page.locator('#my-club-pick').selectOption({ label: 'Harbor City' });
  await expect(page.locator('#my-club-grid .match-card')).toHaveCount(7);
  await expect(page.locator('#my-club-grid')).toContainText('SIMULATED RESULT');
  expect(page.frames().some((frame) => /watch\/index\.html/.test(frame.url()))).toBe(false);
  await page.reload();
  await expect(page.locator('#my-club-pick')).toHaveValue('HAR');
  await expect(page.locator('#my-club-grid .match-card')).toHaveCount(7);
});

test('My Club Ask uses the chosen club and saved match records without opening Watch', async ({ page }) => {
  await page.route('**/analyst/data/M001.json', (route) => route.fulfill({ json: {
    score: [2, 1], stats: { xg: [1.25, 0.6], shots: [9, 4], passes: [120, 80], poss: [60, 40] },
    events: [{ type: 'goal', minute: 3, player: 'Avery Vale', team: 'HAR' }],
  } }));
  await page.goto('/index.html?historyAsk=1#my-club', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
  await page.locator('#my-club-pick').selectOption('HAR');
  await page.locator('#club-ask-open').click();
  await expect(page.getByRole('complementary', { name: 'Club Copilot' })).toBeVisible();
  await expect(page.locator('#my-club-grid')).toBeVisible();
  await expect(page.locator('#club-ask-title')).toContainText('Harbor City');
  await page.locator('#club-ask-q').fill('How has my club done in its past matches?');
  await page.locator('#club-ask-form').getByRole('button', { name: 'Ask Copilot' }).click();
  await expect(page.locator('#club-ask-answer')).toContainText('7 matches');
  await expect(page.locator('#club-ask-answer a')).toHaveCount(7);
  await page.locator('#club-ask-context').selectOption('M001');
  await page.locator('#club-ask-q').fill('Who scored?');
  await page.locator('#club-ask-form').getByRole('button', { name: 'Ask Copilot' }).click();
  await expect(page.locator('#club-ask-answer')).toContainText('Avery Vale');
  await expect(page.locator('#club-ask-answer')).toContainText("3'");
  await page.locator('#club-ask-q').fill('What was the xG?');
  await page.locator('#club-ask-form').getByRole('button', { name: 'Ask Copilot' }).click();
  await expect(page.locator('#club-ask-answer')).toContainText('1.25');
  await expect(page).toHaveURL(/index\.html#my-club$/);
  await page.locator('#club-ask-answer a').first().click();
  await expect(page).toHaveURL(/#match\/M001$/);
  await page.getByRole('button', { name: 'Back to My Club' }).click();
  await expect(page).toHaveURL(/#my-club$/);
  expect(page.frames().some((frame) => /watch\/index\.html/.test(frame.url()))).toBe(false);
});

test('Matches search, team, matchday and sort filters change the results', async ({ page }) => {
  await page.goto('/index.html#matches', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
  const total = await page.locator('#lib-grid .match-card').count();
  expect(total).toBeGreaterThan(20);

  await page.locator('#lib-q').fill('Harbor City');
  await expect.poll(() => page.locator('#lib-grid .match-card').count()).toBeGreaterThan(0);
  const searchResults = await page.locator('#lib-grid .match-open').allTextContents();
  expect(searchResults.length).toBeLessThan(total);
  expect(searchResults.every((text) => text.includes('Harbor City'))).toBe(true);

  await page.locator('#lib-q').fill('');
  const harbor = await page.locator('#lib-team option').allTextContents();
  const harborIndex = harbor.findIndex((text) => text === 'Harbor City');
  expect(harborIndex).toBeGreaterThan(0);
  await page.locator('#lib-team').selectOption({ label: 'Harbor City' });
  const teamResults = await page.locator('#lib-grid .match-open').allTextContents();
  expect(teamResults.length).toBeGreaterThan(0);
  expect(teamResults.every((text) => text.includes('Harbor City'))).toBe(true);

  await page.locator('#lib-md').selectOption({ label: 'Matchday 1' });
  const combinedResults = await page.locator('#lib-grid .match-open').allTextContents();
  const combinedMatchdays = await page.locator('#lib-grid .mmeta').allTextContents();
  expect(combinedResults.length).toBeGreaterThan(0);
  expect(combinedResults.length).toBeLessThan(teamResults.length);
  expect(combinedResults.every((text) => text.includes('Harbor City'))).toBe(true);
  expect(combinedMatchdays.every((text) => text.startsWith('Matchday 1'))).toBe(true);
  await page.locator('#lib-sort').selectOption('goals');
  const combinedGoals = (await page.locator('#lib-grid .sc').allTextContents())
    .map((score) => score.match(/(\d+)\s*[–-]\s*(\d+)/))
    .filter((match): match is RegExpMatchArray => !!match)
    .map((match) => Number(match[1]) + Number(match[2]));
  expect(combinedGoals).toEqual([...combinedGoals].sort((a, b) => b - a));

  await page.locator('#lib-team').selectOption('');
  await page.locator('#lib-md').selectOption({ label: 'Matchday 1' });
  const dayResults = await page.locator('#lib-grid .mmeta').allTextContents();
  expect(dayResults.length).toBeGreaterThan(0);
  expect(dayResults.every((text) => text.startsWith('Matchday 1'))).toBe(true);

  await page.locator('#lib-md').selectOption('');
  await page.locator('#lib-sort').selectOption('goals');
  const goals = (await page.locator('#lib-grid .sc').allTextContents())
    .map((score) => score.match(/(\d+)\s*[–-]\s*(\d+)/))
    .filter((match): match is RegExpMatchArray => !!match)
    .map((match) => Number(match[1]) + Number(match[2]));
  expect(goals.length).toBeGreaterThan(20);
  expect(goals).toEqual([...goals].sort((a, b) => b - a));
});

test('season scores are explicitly labeled as synthetic results', async ({ page }) => {
  await page.goto('/index.html#matches', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
  const labels = await page.locator('#lib-grid .match-thumb .tag').allTextContents();
  expect(labels).toContain('SIMULATED DEMO');
  expect(labels).toContain('SIMULATED RESULT');
  expect(labels).not.toContain('Recorded');
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
    await page.locator('#more-toggle').click();
    const menu = await page.locator('#more-menu').boundingBox();
    expect(menu).not.toBeNull();
    expect(menu!.x).toBeGreaterThanOrEqual(0);
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
    for (const item of await page.locator('#more-menu button').all()) {
      const bounds = await item.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
  });
}

for (const width of [390, 768, 1440]) {
  test(`My Club Copilot opens beside the club and closes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/index.html#my-club', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
    await page.locator('#my-club-pick').selectOption('HAR');
    await page.locator('#club-ask-open').click();
    const panel = page.getByRole('complementary', { name: 'Club Copilot' });
    await expect(panel).toBeVisible();
    await expect(page.locator('#club-ask-q')).toBeFocused();
    const evidence = process.env.BROWSE_SCREENSHOTS_DIR;
    if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: `${evidence}/my-club-copilot-${width}.png` }); }
    const box = await panel.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.locator('#club-ask-open')).toBeFocused();
    expect(page.frames().some((frame) => /watch\/index\.html/.test(frame.url()))).toBe(false);
  });
}

test('My Club Copilot answers the existing live match in place and declines unavailable archive facts', async ({ page }) => {
  await page.goto('/index.html#my-club', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.locator('#fx option').count()).toBeGreaterThan(20);
  await page.locator('#my-club-pick').selectOption('HAR');
  await page.locator('#club-ask-open').click();
  await expect(page.locator('#club-ask-context option[value="live"]')).toHaveCount(0);
  await page.locator('#club-ask-q').fill('What is our training budget?');
  await page.locator('#club-ask-form').getByRole('button', { name: 'Ask Copilot' }).click();
  await expect(page.locator('#club-ask-answer')).toContainText('can’t confirm that');
  await page.evaluate(() => {
    // Use a controlled existing run; browsing must never instantiate Watch.
    (window as any).eval("AG.reset('club-live-test', {home:'Harbor City',away:'Ridgeview',hk:'HAR',ak:'RID'}); AG.run.events.push({type:'pass',minute:1}); AG.ask = async () => ({text:'Harbor City lead 1–0.'}); MCClubAsk.sync();");
  });
  await page.locator('#club-ask-context').selectOption('live');
  await expect(page.locator('#club-ask-answer')).toBeHidden();
  await page.locator('#club-ask-q').fill('What is the score?');
  await page.locator('#club-ask-form').getByRole('button', { name: 'Ask Copilot' }).click();
  await expect(page.locator('#club-ask-answer')).toContainText('Harbor City lead 1–0.');
  await expect(page.locator('#club-ask-answer')).toContainText('Current live match');
  await expect(page).toHaveURL(/#my-club$/);
  expect(page.frames().some((frame) => /watch\/index\.html/.test(frame.url()))).toBe(false);
});
