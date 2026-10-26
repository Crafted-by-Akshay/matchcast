import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell } from './helpers';

// AB#501 (Analyst live view): the xG shot map. Tap a shot, or a shot in the list (keyboard too), and the team's passes in the
// build-up play back on the pitch, then the shot with its outcome and xG. Every number comes from AG.run's events; the panel says Simulated.
declare const AG: any;
declare const CREW: any;

const block3d = (page: Page) => page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());

// Harbor City (h) builds up with three passes and shoots (goal, xG 0.31); Thames Rovers (a) shoots from far out with no build-up.
async function seedBuildUp(page: Page) {
  await page.evaluate(() => {
    AG.reset('k', { hk: 'h', ak: 'a', home: 'Harbor City', away: 'Thames Rovers' });
    AG.onWatch('k', [
      { minute: 4.0, type: 'pass', team: 'h', player: 'E. Belruda', to: 'D. Okoro', x0: 40, y0: 30, x1: 52, y1: 32 },
      { minute: 4.1, type: 'pass', team: 'h', player: 'D. Okoro', to: 'M. Tane', x0: 52, y0: 32, x1: 70, y1: 36 },
      { minute: 4.2, type: 'pass', team: 'h', player: 'M. Tane', to: 'E. Belruda', x0: 70, y0: 36, x1: 85, y1: 34 },
      { minute: 4.3, type: 'shot', team: 'h', player: 'E. Belruda', x: 92, y: 30, xg: 0.31, fate: 'goal' },
      { minute: 4.3, type: 'goal', team: 'h', player: 'E. Belruda' },
      { minute: 12, type: 'shot', team: 'a', player: 'T. Marsh', x: 30, y: 40, xg: 0.03, fate: 'miss' },
    ], []);
  });
  await expect.poll(() => page.evaluate(() => AG.run.events.filter((e: any) => e.type === 'shot').length), { timeout: 15_000 }).toBe(2);
}

test('tap a shot: the build-up plays back, then the shot is labelled with its outcome and xG', async ({ page }) => {
  const errs = collectErrors(page);
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await expect(page.locator('#al')).toBeVisible();
  await seedBuildUp(page);

  const panel = page.locator('#al [data-panel="shots"]');
  await expect(panel).toContainText('Simulated');
  const list = panel.locator('[data-shots] button');
  await expect(list).toHaveCount(2);
  await expect(list.first()).toHaveAttribute('aria-pressed', 'false');

  // the list is the keyboard route: Enter on the first shot starts the replay
  await list.first().focus();
  await page.keyboard.press('Enter');
  await expect(list.first()).toHaveAttribute('aria-pressed', 'true');
  const status = panel.locator('[data-replay-status]');
  await expect(status).toContainText('Replay');
  await expect(status).toContainText('3 passes in this build-up');
  await expect(panel.locator('svg [data-replay] [data-pass]')).toHaveCount(3);
  await expect(panel.locator('svg [data-replay] [data-ball]')).toHaveCount(1);
  // the outcome label appears once the ball reaches the shot
  await expect(panel.locator('svg [data-replay] text')).toHaveText(/Goal · xG 0\.31/, { timeout: 10_000 });
  await expect(status).toContainText('Goal');
  expect(errs).toEqual([]);
});

test('tap a dot on the pitch: the same replay, and a shot with no build-up says so', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedBuildUp(page);
  const panel = page.locator('#al [data-panel="shots"]');

  await panel.locator('svg circle[data-shot-pick]').nth(1).click({ force: true });   // the far shot, the later one in the log
  await expect(panel.locator('[data-replay-status]')).toContainText('No passes in this build-up');
  await expect(panel.locator('svg [data-replay] [data-pass]')).toHaveCount(0);
  await expect(panel.locator('svg [data-replay] text')).toHaveText(/Missed · xG 0\.03/, { timeout: 10_000 });
});

test('reduced motion: the replay jumps to the finished state', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedBuildUp(page);
  const panel = page.locator('#al [data-panel="shots"]');
  await panel.locator('[data-shots] button').first().click();
  await expect(panel.locator('svg [data-replay] text')).toHaveText(/Goal · xG 0\.31/, { timeout: 2_000 });
  await expect(panel.locator('svg [data-replay] [data-pass]').first()).toHaveAttribute('stroke-dashoffset', '0');
});

test('the shot map keeps its counts and summary for screen readers', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedBuildUp(page);
  const map = page.locator('#al svg[data-map="shots"]');
  await expect(map).toHaveAttribute('aria-label', /2 shots.*Harbor City 1.*Thames Rovers 1.*Tap a shot to replay it/);
  expect(await page.evaluate(() => CREW.enabled)).toBe(true);
});

test('keyboard: focus stays on the same shot after Enter, and the status is a live region', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedBuildUp(page);
  const first = page.locator('#al [data-panel="shots"] [data-shots] button').first();
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(first).toBeFocused();
  await expect(page.locator('#al [data-replay-status]')).toHaveAttribute('role', 'status');
});

test('a new batch of events mid-replay carries the replay on, not the final frame', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedBuildUp(page);
  const panel = page.locator('#al [data-panel="shots"]');
  await panel.locator('[data-shots] button').first().click();
  await page.evaluate(() => {
    AG.onWatch('k', [{ minute: 13, type: 'pass', team: 'a', player: 'T. Marsh', to: 'R. Lee', x0: 30, y0: 30, x1: 40, y1: 30 }], []);
  });
  await expect(panel.locator('[data-replay-status]')).toContainText('Replaying');
  await expect(panel.locator('svg [data-replay] [data-pass]')).toHaveCount(3);
  await expect(panel.locator('svg [data-replay] text')).toHaveText(/Goal · xG 0\.31/, { timeout: 10_000 });
  await expect(panel.locator('[data-replay-status]')).toContainText('3 passes in this build-up');
});

test('more than eight build-up passes: the replay draws the last eight and says how many there were', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await page.evaluate(() => {
    AG.reset('k', { hk: 'h', ak: 'a', home: 'Harbor City', away: 'Thames Rovers' });
    const passes = Array.from({ length: 9 }, (_, k) => ({ minute: 4 + k * 0.02, type: 'pass', team: 'h', player: 'E. Belruda', to: 'D. Okoro', x0: 30 + k, y0: 30, x1: 31 + k, y1: 31 }));
    AG.onWatch('k', [...passes, { minute: 4.2, type: 'shot', team: 'h', player: 'E. Belruda', x: 92, y: 30, xg: 0.31, fate: 'goal' }], []);
  });
  await expect.poll(() => page.evaluate(() => AG.run.events.length), { timeout: 15_000 }).toBe(10);
  const panel = page.locator('#al [data-panel="shots"]');
  await panel.locator('[data-shots] button').first().click();
  await expect(panel.locator('[data-replay-status]')).toContainText('Showing the last 8 of 9 passes');
  await expect(panel.locator('svg [data-replay] [data-pass]')).toHaveCount(8);
});

test('window.MC.analysis draws the shot map into a card with citations, and says Planned for kinds not built', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedBuildUp(page);
  const out = await page.evaluate(() => {
    const div = document.createElement('div'); div.id = 'card-test'; document.body.appendChild(div);
    const res = (window as any).MC.analysis.render('shot_map', { team: 'home' }, div);
    const planned = (window as any).MC.analysis.render('momentum', {}, document.createElement('div'));
    return { res, planned, dots: div.querySelectorAll('circle[data-xg]').length };
  });
  expect(out.res.status).toBe('ok');
  expect(out.res.citations).toEqual(['e4']);       // the home shot is the fourth event of the seeded match
  expect(out.planned.status).toBe('planned');
  expect(out.dots).toBe(1);
  await expect(page.locator('#card-test [data-replay-status]')).toHaveAttribute('role', 'status');
});
