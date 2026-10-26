import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell } from './helpers';

// AB#501 (Analyst live view), view 6: progressive passes on the pitch. A pass is progressive when it moves the ball 10 m or more toward the
// opponent's goal, in the direction its side attacks (attack_x). Carries are not in the event log, so they are not drawn. The panel says Simulated.
declare const AG: any;

const block3d = (page: Page) => page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());

// Harbor City (h) attacks the goal at 105, Thames Rovers (a) attacks at 0. Event ids are e1 to e6 in order.
// e1 h at 2: x 40 to 55, gain 15, progressive.       e2 h at 3: x 40 to 46, gain 6, not.
// e3 a at 4: x 60 to 40, gain 20 toward 0, progressive. e4 a at 6: x 50 to 52, gain -2, not.
// e5 h at 8: x 70 to 80, gain exactly 10, progressive.  e6 h at 9: attack_x null, so it is left out of every count.
// At minute 9: Harbor City 2 progressive of 3 passes (e1, e2, e5), Thames Rovers 1 progressive of 2 (e3, e4).
async function seedMatch(page: Page) {
  await page.evaluate(() => {
    AG.reset('k', { hk: 'h', ak: 'a', home: 'Harbor City', away: 'Thames Rovers' });
    const pass = (minute: number, team: string, attack: number | null, x0: number, x1: number) => ({
      minute, type: 'pass', team, player: team === 'h' ? 'E. Belruda' : 'T. Marsh', to: 'Mate', x0, y0: 34, x1, y1: 34, attack_x: attack,
    });
    AG.onWatch('k', [
      pass(2, 'h', 105, 40, 55), pass(3, 'h', 105, 40, 46), pass(4, 'a', 0, 60, 40),
      pass(6, 'a', 0, 50, 52), pass(8, 'h', 105, 70, 80), pass(9, 'h', null, 50, 90),
    ], []);
  });
  await expect.poll(() => page.evaluate(() => AG.run.events.length), { timeout: 15_000 }).toBe(6);
}

test('progressive passes are drawn at the latest minute, counted per side, and labelled Simulated', async ({ page }) => {
  const errs = collectErrors(page);
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="progressive"]');
  await expect(panel).toContainText('Simulated');
  await expect(page.locator('#al svg[data-map="progressive"]')).toHaveAttribute('role', 'img');
  const status = panel.locator('[data-progressive-status]');
  await expect(status).toContainText("Up to 9'");
  await expect(status).toContainText('Harbor City 2 progressive of 3 passes');
  await expect(status).toContainText('Thames Rovers 1 progressive of 2 passes');
  // three arrows: e1, e3 and e5
  await expect(page.locator('#al svg[data-map="progressive"] line.pg-arrow')).toHaveCount(3);
  expect(errs).toEqual([]);
});

test('the scrubber moves the minute, and only the progressive passes up to it are drawn', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="progressive"]');
  await expect(panel.locator('[data-progressive-scrub]')).toHaveAttribute('max', '9');
  await panel.locator('[data-progressive-scrub]').evaluate((el: HTMLInputElement) => { el.value = '3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  // up to minute 3: Harbor City has e1 (progressive) and e2 (not), and Thames Rovers has no pass yet
  await expect(panel.locator('[data-progressive-status]')).toContainText("Up to 3'");
  await expect(panel.locator('[data-progressive-status]')).toContainText('Harbor City 1 progressive of 2 passes');
  await expect(panel.locator('[data-progressive-status]')).toContainText('Thames Rovers 0 progressive of 0 passes');
  await expect(page.locator('#al svg[data-map="progressive"] line.pg-arrow')).toHaveCount(1);
  // the chart's accessible name follows the minute too
  await expect(page.locator('#al svg[data-map="progressive"]')).toHaveAttribute('aria-label', /Up to 3'/);
});

test('Play walks the minutes from the start, and ends on the latest minute', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="progressive"]');
  await panel.locator('[data-progressive-play]').click();
  // Play starts at minute 0, and the latest minute arrives once PLAY_MS (9 s) has run
  await expect(panel.locator('[data-progressive-status]')).toContainText("Up to 0'");
  await expect(panel.locator('[data-progressive-status]')).toContainText("Up to 9'", { timeout: 15_000 });
});

test('reduced motion: Play goes straight to the latest minute', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="progressive"]');
  await panel.locator('[data-progressive-scrub]').evaluate((el: HTMLInputElement) => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await panel.locator('[data-progressive-play]').click();
  await expect(panel.locator('[data-progressive-status]')).toContainText("Up to 9'", { timeout: 1_000 });
});

test('window.MC.analysis draws progressive passes into a card and cites the ones drawn', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const out = await page.evaluate(() => {
    const div = document.createElement('div'); div.id = 'prog-card'; document.body.appendChild(div);
    return (window as any).MC.analysis.render('progressive', {}, div);
  });
  expect(out.status).toBe('ok');
  expect(out.citations).toEqual(['e1', 'e3', 'e5']);
  await expect(page.locator('#prog-card [data-progressive-status]')).toContainText("Up to 9'");
  await expect(page.locator('#prog-card svg[data-map="progressive"]')).toHaveCount(1);
});
