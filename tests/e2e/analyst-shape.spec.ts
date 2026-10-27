import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell } from './helpers';

// AB#501 (Analyst live view), view 7: the defensive line, team shape and compactness over time, from the live position samples (maps.js).
// Positions are simulated, not events, and the panel says Simulated.
declare const AG: any;
declare const MAPS: any;

const block3d = (page: Page) => page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());

// Every sample is the same, so every minute says the same. Keepers sit on their own line; the ten outfield players of each side stand on two rows,
// 14 m and 54 m across, so the width is 40 m and each is 20 m from the centre of its side. Harbor City (home) attacks 105 in the first half and its
// outfield is at x 40, so its line is 40 m from its own goal. Thames Rovers (away) attacks 0 and its outfield is at x 65, so its line is 105 - 65 = 40 m.
// Expected for every minute: line 40 m, width 40 m, compactness 20 m, for both sides.
async function seedPositions(page: Page, seconds: number) {
  await page.evaluate((n: number) => {
    const setup = { h: 'h', a: 'a', seed: 1, st: 0, month: 0, kick: '15:00', half: 45 };
    const roster = { teams: ['h', 'a'], players: Array.from({ length: 22 }, (_, i) => ({ name: 'P' + i, team: i < 11 ? 'h' : 'a' })) };
    const players = Array.from({ length: 22 }, (_, i) => {
      if (i === 0) return [2, 34];
      if (i === 11) return [103, 34];
      const y = i % 2 ? 14 : 54;
      return i < 11 ? [40, y] : [65, y];
    });
    MAPS.start(setup, roster);
    for (let t = 0; t <= n; t++) MAPS.frame(setup, { mclock: t, half: 1, players });
  }, seconds);
}
async function seedMatch(page: Page) {
  await page.evaluate(() => {
    AG.reset('k', { hk: 'h', ak: 'a', home: 'Harbor City', away: 'Thames Rovers' });
    AG.onWatch('k', [], []);
  });
}

test('the defensive line, width and compactness are counted per minute, labelled Simulated', async ({ page }) => {
  const errs = collectErrors(page);
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  await seedPositions(page, 240);
  const panel = page.locator('#al [data-panel="shape"]');
  await expect(panel).toContainText('Simulated');
  await expect(panel.locator('[data-shape-status]')).toContainText("5': Harbor City line 40 m, width 40 m, compactness 20 m; Thames Rovers line 40 m, width 40 m, compactness 20 m.");
  // the pitch: all 22 players and both lines at the playhead minute
  await expect(page.locator('#al svg[data-map="shape"] g[data-dots] circle')).toHaveCount(22);
  await expect(page.locator('#al svg[data-map="shape"] line.sh-line')).toHaveCount(2);
  expect(errs).toEqual([]);
});

test('the scrubber moves the minute, and the pitch and charts follow it', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  await seedPositions(page, 240);
  const panel = page.locator('#al [data-panel="shape"]');
  await expect(panel.locator('[data-shape-scrub]')).toHaveAttribute('max', '4');
  await panel.locator('[data-shape-scrub]').evaluate((el: HTMLInputElement) => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(panel.locator('[data-shape-status]')).toContainText("3': Harbor City line 40 m");
  await expect(page.locator('#al svg[data-map="shape"]')).toHaveAttribute('aria-label', /at 3'/);
  await expect(panel.locator('[data-charts] [data-playhead]')).toHaveCount(2);
});

test('Play walks the minutes from the start, and ends on the latest minute', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  await seedPositions(page, 240);
  const panel = page.locator('#al [data-panel="shape"]');
  await panel.locator('[data-shape-play]').click();
  await expect(panel.locator('[data-shape-status]')).toContainText("1':");
  await expect(panel.locator('[data-shape-status]')).toContainText("5':", { timeout: 15_000 });
});

test('reduced motion: Play goes straight to the latest minute', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  await seedPositions(page, 240);
  const panel = page.locator('#al [data-panel="shape"]');
  await panel.locator('[data-shape-scrub]').evaluate((el: HTMLInputElement) => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await panel.locator('[data-shape-play]').click();
  await expect(panel.locator('[data-shape-status]')).toContainText("5':", { timeout: 1_000 });
});

test('window.MC.analysis draws the shape into a card, with no citations, and says so before a match has positions', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const out = await page.evaluate(() => {
    const div = document.createElement('div'); div.id = 'shape-card'; document.body.appendChild(div);
    return (window as any).MC.analysis.render('shape', {}, div);
  });
  expect(out.status).toBe('empty');   // no positions yet
  expect(out.citations).toEqual([]);
  await expect(page.locator('#shape-card [data-panel="shape"]')).toContainText('Start the match in Watch');
  await seedPositions(page, 60);
  const out2 = await page.evaluate(() => {
    const div = document.createElement('div'); div.id = 'shape-card2'; document.body.appendChild(div);
    return (window as any).MC.analysis.render('shape', {}, div);
  });
  expect(out2.status).toBe('ok');   // positions are there, and the card cites no events
  expect(out2.citations).toEqual([]);
  await expect(page.locator('#shape-card2 [data-shape-status]')).toContainText("2':");
});
