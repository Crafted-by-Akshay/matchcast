import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell } from './helpers';

// AB#501 (Analyst live view), view 5: PPDA per club over time. Passes allowed per defensive action in the pressing zone, the 60% of the pitch
// nearest the opponent's goal, counted in five-minute blocks from the events. Defensive actions here are ball wins (turnover events): the events
// carry no tackle or interception positions. The panel says Simulated. A lower PPDA means more pressing.
declare const AG: any;

const block3d = (page: Page) => page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());

// Harbor City (h) attacks the goal at 105 and Thames Rovers (a) attacks at 0, so h presses from x 42 up and a presses from x 63 down.
// Minutes 0 to 5: a passes at x 50 and x 55 (in h's zone) and at x 20 (not in it); h wins the ball at x 60 (in its zone); a wins it at x 30 (in a's zone);
// h passes at x 30 (in a's zone). So h's PPDA is 2 passes over 1 ball win = 2.00, and a's is 1 pass over 1 ball win = 1.00.
// Minutes 5 to 10: a passes at x 70 (in h's zone), and h wins the ball at x 80 (in its zone), so h's PPDA is 1.00, and a has no ball win (no PPDA).
async function seedMatch(page: Page) {
  await page.evaluate(() => {
    AG.reset('k', { hk: 'h', ak: 'a', home: 'Harbor City', away: 'Thames Rovers' });
    const pass = (minute: number, team: string, attack: number, x0: number) => ({ minute, type: 'pass', team, player: team === 'h' ? 'E. Belruda' : 'T. Marsh', to: 'Mate', x0, y0: 30, x1: x0 + 5, y1: 30, attack_x: attack });
    const win = (minute: number, team: string, attack: number, x: number) => ({ minute, type: 'turnover', team, player: team === 'h' ? 'D. Okoro' : 'R. Lee', x, y: 30, attack_x: attack });
    AG.onWatch('k', [
      pass(2, 'a', 0, 50), pass(2.5, 'a', 0, 55), pass(3, 'a', 0, 20),
      win(3.5, 'h', 105, 60), win(4, 'a', 0, 30), pass(4.5, 'h', 105, 30),
      pass(6, 'a', 0, 70), win(7, 'h', 105, 80),
    ], []);
  });
  await expect.poll(() => page.evaluate(() => AG.run.events.length), { timeout: 15_000 }).toBe(8);
}

test('PPDA per club per five minutes, counted in the pressing zone, labelled Simulated', async ({ page }) => {
  const errs = collectErrors(page);
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="ppda"]');
  await expect(panel).toContainText('Simulated');
  await expect(page.locator('#al svg[data-map="ppda"]')).toHaveAttribute('role', 'img');
  // the playhead is on the latest block, minutes 5 to 10: Harbor City 1.00 (passes 1, ball wins 1), Thames Rovers has no ball win in its zone
  const status = panel.locator('[data-ppda-status]');
  await expect(status).toContainText("5–10'");
  await expect(status).toContainText('Harbor City 1.00 (1 passes allowed, 1 ball wins in its zone)');
  await expect(status).toContainText('Thames Rovers –');
  expect(errs).toEqual([]);
});

test('the scrubber moves to the first block, where both clubs have a PPDA', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="ppda"]');
  // two blocks (0 to 5 and 5 to 10), so the scrubber runs 0 to 1; the first block is 0
  await expect(panel.locator('[data-ppda-scrub]')).toHaveAttribute('max', '1');
  await page.evaluate(() => {
    const el = document.querySelector('#al [data-ppda-scrub]') as HTMLInputElement;
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(panel.locator('[data-ppda-status]')).toContainText("0–5'");
  await expect(panel.locator('[data-ppda-status]')).toContainText('Harbor City 2.00 (2 passes allowed, 1 ball wins in its zone)');
  await expect(panel.locator('[data-ppda-status]')).toContainText('Thames Rovers 1.00');
  // the chart's accessible name follows the block too, not only the status line
  await expect(page.locator('#al svg[data-map="ppda"]')).toHaveAttribute('aria-label', /0–5'/);
});

test('Play with reduced motion jumps to the latest block', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="ppda"]');
  await panel.locator('[data-ppda-scrub]').evaluate((el: HTMLInputElement) => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(panel.locator('[data-ppda-status]')).toContainText("0–5'");
  await panel.locator('[data-ppda-play]').click();
  // the reduced path jumps at once; the normal path reaches the latest block after about 4.5 s, so a 1 s wait tells them apart
  await expect(panel.locator('[data-ppda-status]')).toContainText("5–10'", { timeout: 1_000 });
});

test('Play walks through the blocks over the match, first block then latest', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="ppda"]');
  await panel.locator('[data-ppda-play]').click();
  // the first block shows as soon as Play starts; the latest block follows after about 4.5 s (half of PLAY_MS, 9 s, with two blocks)
  await expect(panel.locator('[data-ppda-status]')).toContainText("0–5'");
  await expect(panel.locator('[data-ppda-status]')).toContainText("5–10'", { timeout: 15_000 });
});

test('window.MC.analysis draws PPDA into a card and cites the passes and ball wins of the block', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const out = await page.evaluate(() => {
    const div = document.createElement('div'); div.id = 'ppda-card'; document.body.appendChild(div);
    return (window as any).MC.analysis.render('ppda', {}, div);
  });
  expect(out.status).toBe('ok');
  // the latest block (minutes 5 to 10): a's pass at 6 (e7) and h's ball win at 7 (e8)
  expect(out.citations).toEqual(['e7', 'e8']);
  await expect(page.locator('#ppda-card [data-ppda-status]')).toContainText("5–10'");
});
