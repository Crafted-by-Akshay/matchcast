import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// The crew UI is ON by default (judges add no query flag). ?crew=0 or localStorage mc-crew=0 turns it off; an explicit ?crew=1 beats a stored 0.
// The shell forwards crew=1 or crew=0 to the Watch iframe. The Watch first screen stays quiet; a "Crew" button in the header opens the Agents tab at the Crew section.
// Every wait polls for state, never for a duration.
async function open(page: any, query = '', width = 1280, height = 800) {
  await page.route('**/broadcast/**', (r: any) => r.abort());   // Watch must load here; a second 3D engine is not needed
  await page.setViewportSize({ width, height });
  await openShell(page, 'watch', query);
}
const watchSrc = (page: any) => page.evaluate(() => (document.querySelector('#v-watch iframe') as HTMLIFrameElement).src);

test('crew is on by default: the Crew button shows, Watch gets crew=1, the feed picker is there', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await open(page);
  expect(await page.evaluate(() => (window as any).CREW.enabled)).toBe(true);
  await expect(page.getByRole('button', { name: /^Crew/ })).toBeVisible();
  await ready('watch')(page);
  expect(await watchSrc(page)).toMatch(/[?&]crew=1(&|$)/);
  const f = await viewFrame(page, 'watch');
  await expect(f.getByRole('radiogroup', { name: 'Feed' })).toBeVisible({ timeout: 60_000 });
  expect(errs).toEqual([]);
});

test('?crew=0 is the off switch: no Crew button, Watch gets crew=0, no feed picker, no crew panels', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, '?crew=0');
  expect(await page.evaluate(() => (window as any).CREW.enabled)).toBe(false);
  await expect(page.locator('#crew-btn')).toBeHidden();
  await ready('watch')(page);
  expect(await watchSrc(page)).toMatch(/[?&]crew=0(&|$)/);
  const f = await viewFrame(page, 'watch');
  expect(await f.locator('#mc-feedpick').count()).toBe(0);
  expect(await f.locator('#mc-feedpick-css').count()).toBe(0);
  expect(await f.evaluate(() => document.body.className)).not.toMatch(/mc-feed/);
  expect(await page.locator('#crew-tree').count()).toBe(0);
});

test('localStorage mc-crew=0 turns it off; an explicit ?crew=1 beats it', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => { try { localStorage.setItem('mc-crew', '0'); } catch (e) { /* storage blocked */ } });
  await open(page);
  expect(await page.evaluate(() => (window as any).CREW.enabled)).toBe(false);
  await expect(page.locator('#crew-btn')).toBeHidden();
  await ready('watch')(page);
  expect(await watchSrc(page)).toMatch(/[?&]crew=0(&|$)/);
  await page.goto('/index.html?split=1&crew=1#watch', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window as any).CREW);
  expect(await page.evaluate(() => (window as any).CREW.enabled)).toBe(true);
  await expect(page.locator('#crew-btn')).toBeVisible();
});

test('Planned labels: four feeds say Planned, two are live, and a Planned feed says it is not built', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  const group = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(group).toBeVisible({ timeout: 60_000 });
  expect(await group.locator('.fp-tag:visible').count()).toBe(4);
  for (const n of ['Audio description', 'Catch me up', 'Half-time explainer', 'News ticker']) {
    const r = group.getByRole('radio', { name: new RegExp(n) });
    await expect(r.locator('.fp-tag')).toHaveText('Planned');
    await r.click();
    await expect(f.locator('#mc-feedlines')).toContainText('Planned: this feed is not built yet');
  }
  await expect(group.getByRole('radio', { name: /^Casual/ }).locator('.fp-tag')).toHaveCount(0);
  await expect(group.getByRole('radio', { name: /^Analyst/ }).locator('.fp-tag')).toHaveCount(0);
});

test('quiet first screen: on Watch only the feed picker is added; no crew panel, Demo controls, weather or camera presets', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect(f.getByRole('radiogroup', { name: 'Feed' })).toBeVisible({ timeout: 60_000 });
  expect(await page.locator('#crew-tree').isVisible(), 'the spawn tree lives in the Agents tab').toBe(false);
  expect(await page.locator('#crew-score').isVisible()).toBe(false);
  for (const sel of ['#mc-demo', '#wxchip', '#cams', '#fan-pop']) expect(await f.locator(sel).isVisible(), sel + ' stays off the first screen').toBe(false);
  // the only crew additions on screen: the feed picker, its one line box and a screen-reader-only live region
  const shown = await f.evaluate(() => [...document.querySelectorAll('[id^="mc-feed"],[id^="crew"]')].filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden').map((e) => e.id).sort());
  expect(shown.filter((id) => id !== 'mc-feeds' && id !== 'mc-feedpick' && id !== 'mc-feedlines' && id !== 'mc-feedsr')).toEqual([]);
  expect(await f.locator('#mc-feedpick').isVisible()).toBe(true);
});

test('the Crew button opens the Agents tab at the Crew section, by keyboard, and the spawn tree and scoreboard are there', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  const btn = page.getByRole('button', { name: /^Crew/ });
  await expect(btn).toBeVisible();
  await btn.focus();
  await expect(btn).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#tab-agents')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#crew-tree')).toBeVisible();
  await expect(page.locator('#crew-score')).toBeVisible();
  await expect(page.locator('#ct-h')).toBeFocused();
  expect(await page.evaluate(() => { const r = document.getElementById('ct-h')!.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'the Crew heading is scrolled into view').toBe(true);
});

test('Crew button at 320 px: visible, tappable, no sideways scroll, and it opens the Crew section', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, '', 320, 640);
  const btn = page.getByRole('button', { name: /^Crew/ });
  await expect(btn).toBeVisible();
  const b = await btn.boundingBox();
  expect(b!.x).toBeGreaterThanOrEqual(0);
  expect(b!.x + b!.width).toBeLessThanOrEqual(320);
  expect(b!.height, 'a tap target of at least 44 px').toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await btn.click();
  await expect(page.locator('#tab-agents')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#crew-tree')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll on the Agents tab').toBe(true);
});

test('feed picker on a phone: the default Casual feed keeps the live commentary line; picking Analyst replaces it', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, '', 390, 844);
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  const group = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(group).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => (window as any).CREW.play(23));
  await expect.poll(() => f.evaluate(() => document.body.classList.contains('mc-feedon')), { message: 'default Casual: Watch keeps its own commentary line' }).toBe(false);
  expect(await f.locator('#mc-feedlines').isVisible(), 'no second line on a phone while Casual is picked').toBe(false);
  expect(await f.evaluate(() => { const t = document.getElementById('mcf-top'); return !!t && getComputedStyle(t).display !== 'none'; })).toBe(true);
  await group.getByRole('radio', { name: /^Analyst/ }).click();
  await expect.poll(() => f.evaluate(() => document.body.classList.contains('mc-feedon'))).toBe(true);
  await expect(f.locator('#mc-feedlines')).toBeVisible();
  expect(await f.evaluate(() => getComputedStyle(document.getElementById('mcf-top')!).display)).toBe('none');
});

test('feed picker at 320 px by default: the picker has room beside the chip, and the commentary line is still shown', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page, '', 320, 640);
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect(f.getByRole('radiogroup', { name: 'Feed' })).toBeVisible({ timeout: 60_000 });
  const g = await f.evaluate(() => { const p = document.getElementById('mc-feedpick')!.getBoundingClientRect(); return { pw: p.width, pr: p.right, iw: innerWidth, top: getComputedStyle(document.getElementById('mcf-top')!).display, sw: document.documentElement.scrollWidth }; });
  expect(g.pw, 'the picker is not squeezed to nothing').toBeGreaterThan(100);
  expect(g.pr).toBeLessThanOrEqual(g.iw);
  expect(g.top).not.toBe('none');
  expect(g.sw).toBeLessThanOrEqual(g.iw);
});
