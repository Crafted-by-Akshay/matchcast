import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell } from './helpers';

// AB#501 (Analyst live view), view 4: momentum and pressure over the match. Each side's shot xG and ball wins in the rolling five minutes,
// counted from AG.run's events at every whole minute. A scrubber moves a playhead through the match; the panel says Simulated.
declare const AG: any;

const block3d = (page: Page) => page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());

// Harbor City (h) shoots at 5 and 38 and wins the ball at 9 and 39; Thames Rovers (a) shoots at 8 and passes at 40.
async function seedMatch(page: Page) {
  await page.evaluate(() => {
    AG.reset('k', { hk: 'h', ak: 'a', home: 'Harbor City', away: 'Thames Rovers' });
    AG.onWatch('k', [
      { minute: 5, type: 'shot', team: 'h', player: 'E. Belruda', x: 90, y: 30, xg: 0.3, fate: 'miss' },
      { minute: 8, type: 'shot', team: 'a', player: 'T. Marsh', x: 20, y: 40, xg: 0.1, fate: 'save' },
      { minute: 9, type: 'turnover', team: 'h', player: 'D. Okoro', x: 40, y: 30 },
      { minute: 38, type: 'shot', team: 'h', player: 'E. Belruda', x: 92, y: 32, xg: 0.5, fate: 'goal' },
      { minute: 39, type: 'turnover', team: 'h', player: 'M. Tane', x: 60, y: 30 },
      { minute: 40, type: 'pass', team: 'a', player: 'T. Marsh', to: 'R. Lee', x0: 30, y0: 30, x1: 40, y1: 30 },
    ], []);
  });
  await expect.poll(() => page.evaluate(() => AG.run.events.length), { timeout: 15_000 }).toBe(6);
}

test('momentum and pressure: counted per minute over the rolling five minutes, labelled Simulated, playhead at the latest minute', async ({ page }) => {
  const errs = collectErrors(page);
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="momentum"]');
  await expect(panel).toContainText('Simulated');
  await expect(page.locator('#al svg[data-map="momentum"]')).toHaveAttribute('role', 'img');
  // the latest minute is 40: window (35, 40] holds Harbor City's 0.50 xG shot and its ball win at 39
  const status = panel.locator('[data-momentum-status]');
  await expect(status).toContainText("At 40'");
  await expect(status).toContainText('Harbor City 0.50 xG, Thames Rovers 0.00 xG');
  await expect(status).toContainText('Ball wins 1 to 0');
  expect(errs).toEqual([]);
});

test('the scrubber moves the playhead, and the status follows the minute it is on', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="momentum"]');
  const scrub = panel.locator('[data-momentum-scrub]');
  await expect(scrub).toHaveAttribute('max', '40');
  await page.evaluate(() => {
    const el = document.querySelector('#al [data-momentum-scrub]') as HTMLInputElement;
    el.value = '10';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // window (5, 10]: Thames Rovers' shot at 8 (0.10 xG), Harbor City's ball win at 9
  await expect(panel.locator('[data-momentum-status]')).toContainText("At 10'");
  await expect(panel.locator('[data-momentum-status]')).toContainText('Harbor City 0.00 xG, Thames Rovers 0.10 xG');
  await expect(panel.locator('[data-momentum-status]')).toContainText('Ball wins 1 to 0');
  await expect(panel.locator('svg[data-map="momentum"] [data-playhead]')).toHaveCount(1);
});

test('reduced motion: play goes straight to the end of the match', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="momentum"]');
  await panel.locator('[data-momentum-play]').click();
  await expect(panel.locator('[data-momentum-status]')).toContainText("At 40'");
});

test('window.MC.analysis draws momentum into a card and cites the shots and ball wins in the final window', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const out = await page.evaluate(() => {
    const div = document.createElement('div'); div.id = 'mo-card'; document.body.appendChild(div);
    return (window as any).MC.analysis.render('momentum', {}, div);
  });
  expect(out.status).toBe('ok');
  expect(out.citations).toEqual(['e4', 'e5']);
  await expect(page.locator('#mo-card [data-momentum-status]')).toContainText("At 40'");
  await expect(page.locator('#mo-card svg[data-map="momentum"]')).toHaveCount(1);
});
