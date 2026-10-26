import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// UX review 2026-10-24, Analyst findings 12, 13, 15 and 16: a source label on the recap, a live pill that stays off the page content,
// a stacked indices table on a phone, and a named Copilot button on a phone.
declare const post: (v: string, m: object) => void; declare const M: any;
async function openPage(page: Page, route: string) {
  await openShell(page, 'analyst', '?crew=0');
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await f.evaluate((r) => (window as any).go(r), route);
  return f;
}
const feed = (page: Page) => page.evaluate(() => post('analyst', { src: 'matchcast-shell', type: 'feed', on: true, fixture: M.fixture, score: [1, 0], minute: 12, over: false, last: [], stats: null }));

test('the recap line under the scoreboard says it is a simulated template recap', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'match');
  await expect(f.locator('.mc-src').first()).toHaveText('Template recap · simulated');
  expect(errs).toEqual([]);
});

test('the live pill sits bottom right, shows on the match page and hides on the Live match page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const f = await openPage(page, 'match');
  await feed(page);
  await expect(f.locator('#mc-live')).toBeVisible();
  const b = await f.locator('#mc-live').boundingBox();
  expect(b!.x + b!.width, 'right aligned, clear of the nav').toBeGreaterThan(1440 - 30);
  await f.locator('#copbtn').click();
  await expect(f.locator('#mc-live'), 'hidden while the Copilot drawer is open').toBeHidden({ timeout: 3000 });
  await f.locator('#cop-x').click();
  await expect(f.locator('#mc-live')).toBeVisible({ timeout: 3000 });
  await f.evaluate(() => (window as any).go('live'));
  await expect(f.locator('#mc-live')).toBeHidden();
});

test('on a phone the pill is hidden, the Copilot button has its name and the indices table stacks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await openPage(page, 'match');
  await feed(page);
  await expect(f.locator('#mc-live')).toBeHidden();
  await expect(f.locator('#copbtn span')).toBeVisible();
  await expect(f.locator('#copbtn')).toHaveAccessibleName('Ask Copilot');
  await f.evaluate(() => { (window as any).MC_INDICES = { control: 61, chaos: 22, tempo: 7.5, passes: 40, series: [{ control: 50, chaos: 20, tempo: 6 }, { control: 61, chaos: 22, tempo: 7.5 }] }; (window as any).idxRefresh(); });
  const m = await f.evaluate(() => { const row = document.querySelector('#idx-panel tr')!; const th = row.querySelector('th')!.getBoundingClientRect(), svg = row.querySelector('svg')!.getBoundingClientRect(); return { thH: th.height, svgW: svg.width, hint: row.querySelectorAll('td')[2].getBoundingClientRect().width }; });
  expect(m.hint, 'the explanation spans the row instead of a narrow column').toBeGreaterThan(250);
  expect(m.thH).toBeLessThan(40);
  expect(m.svgW, 'the sparkline keeps its own width and stays inside the row').toBeLessThanOrEqual(200);
  expect(await f.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

// UX review pass 7: at 0' the Live match page says it is waiting for kick-off; Watch's own "vision on" line is not listed as a match event.
test("Live match at 0' says it is waiting for kick-off and does not list the vision bookkeeping line", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const f = await openPage(page, 'live');
  await page.evaluate(() => post('analyst', { src: 'matchcast-shell', type: 'feed', on: true, fixture: M.fixture, score: [0, 0], minute: 0, over: false, last: [{ minute: 0, type: 'vision_on' }], stats: null }));
  await expect(f.locator('#live-wait')).toContainText('Waiting for kick-off');
  await expect(f.locator('#pg')).toContainText('Waiting for kick-off. Events appear here');
  await expect(f.locator('#pg')).not.toContainText('vision on');
  await page.evaluate(() => post('analyst', { src: 'matchcast-shell', type: 'feed', on: true, fixture: M.fixture, score: [1, 0], minute: 12, over: false, last: [{ minute: 11, type: 'goal', player: 'Z. Chacourt' }], stats: null }));
  await expect(f.locator('#live-wait')).toHaveCount(0);
  await expect(f.locator('#pg')).toContainText('goal · Z. Chacourt');
});
