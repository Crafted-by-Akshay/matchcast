import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// Crew processing remains on by default, but its simulated dashboard is hidden from the main menu. ?crew=0 or localStorage mc-crew=0 disables it; explicit ?crew=1 beats a stored 0.
// The shell forwards crew=1 or crew=0 to Watch. The Watch first screen stays focused on the match and commentary.
// Every wait polls for state, never for a duration.
async function open(page: any, query = '', width = 1280, height = 800) {
  await page.route('**/broadcast/**', (r: any) => r.abort());   // Watch must load here; a second 3D engine is not needed
  await page.setViewportSize({ width, height });
  await openShell(page, 'watch', query);
}
const watchSrc = (page: any) => page.evaluate(() => (document.querySelector('#v-watch iframe') as HTMLIFrameElement).src);

test('crew processing stays on by default while the unhelpful dashboard is hidden', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  await open(page);
  expect(await page.evaluate(() => (window as any).CREW.enabled)).toBe(true);
  await page.locator('#more-toggle').click();
  await expect(page.locator('#tab-agents,#crew-btn')).toHaveCount(0);
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
  await page.locator('#more-toggle').click();
  await expect(page.locator('#tab-agents,#crew-btn')).toHaveCount(0);
});

test('no Planned labels: all six feeds are live, and a feed with no lines yet says it is waiting', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  const group = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(group).toBeVisible({ timeout: 60_000 });
  expect(await group.locator('.fp-tag:visible').count()).toBe(0);
  for (const n of ['Audio description', 'Half-time explainer', 'News ticker']) {
    await group.getByRole('radio', { name: new RegExp(n) }).click();
    await expect(f.locator('#mc-feedlines')).toContainText('waiting for a moment');
  }
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
  await expect(f.locator('#mc-weather-note')).toContainText('SIMULATED WEATHER');
  // the only crew additions on screen: the feed picker, its one line box and a screen-reader-only live region
  const shown = await f.evaluate(() => [...document.querySelectorAll('[id^="mc-feed"],[id^="crew"]')].filter((e) => (e as HTMLElement).getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== 'hidden').map((e) => e.id).sort());
  expect(shown.filter((id) => id !== 'mc-feeds' && id !== 'mc-feedpick' && id !== 'mc-feedlines' && id !== 'mc-feedsr')).toEqual([]);
  expect(await f.locator('#mc-feedpick').isVisible()).toBe(true);
});

test('the hidden agent dashboard does not reappear on a small screen', async ({ page }) => {
  await open(page, '', 320, 640);
  await page.locator('#more-toggle').click();
  await expect(page.locator('#tab-agents,#crew-btn')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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

test('Simulated shows only while fixture lines are on screen; an empty default feed says only "waiting for a moment"', async ({ page }) => {
  test.setTimeout(300_000);
  await open(page);
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect(f.getByRole('radiogroup', { name: 'Feed' })).toBeVisible({ timeout: 60_000 });
  await expect(f.locator('#mc-feedlines')).toContainText('waiting for a moment');
  await expect(f.locator('#mc-feedlines .fp-sim')).toHaveCount(0);
  await page.evaluate(() => (window as any).CREW.play(23));
  await expect(f.locator('#mc-feedlines li').first()).toBeVisible({ timeout: 60_000 });
  await expect(f.locator('#mc-feedlines .fp-sim')).toHaveText('Simulated');
});

// A real cross-origin parent cannot be built here (Chromium blocks a route-fulfilled parent from framing the local server), so the frames' access to parent.location is made to throw,
// which is exactly what a cross-origin parent does. The page's own query (crew=0 as the shell forwards it) must still win.
const throwingParent = () => {
  if (window === window.top) return;
  Object.defineProperty(window, 'parent', { get: () => new Proxy({}, { get: (_t, k) => { if (k === 'location') throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError'); const v = (window.top as any)[k as string]; return typeof v === 'function' ? v.bind(window.top) : v; } }) });
};

test('a parent whose location cannot be read does not hide ?crew=0 on the Watch page, and with no flag it stays on', async ({ page, browser }) => {
  test.setTimeout(420_000);
  await page.addInitScript(throwingParent);
  await open(page, '?crew=0');
  await ready('watch')(page);
  const a = await viewFrame(page, 'watch');
  await a.waitForSelector('#mcf', { state: 'attached', timeout: 240_000 });
  expect(await a.evaluate(() => { try { return String((window.parent as any).location.search); } catch (e) { return 'threw'; } }), 'the simulated parent really throws').toBe('threw');
  expect(await a.locator('#mc-feedpick').count(), '?crew=0 on the page wins').toBe(0);
  expect(await a.locator('#mc-feedpick-css').count()).toBe(0);
  const p2 = await browser.newPage();
  await p2.addInitScript(throwingParent);
  await p2.route('**/broadcast/**', (r: any) => r.abort());
  await openShell(p2, 'watch', '');
  await ready('watch')(p2);
  const b = await viewFrame(p2, 'watch');
  await b.waitForSelector('#mc-feedpick', { state: 'attached', timeout: 240_000 });
  await p2.close();
});

test('header at 320 px: Tour, Voice and Status do not grow the header, and Copilot stays on screen', async ({ page, browser }) => {
  test.setTimeout(420_000);
  const off = await browser.newPage({ viewport: { width: 320, height: 640 } });
  await off.route('**/broadcast/**', (r: any) => r.abort());
  await openShell(off, 'watch', '?crew=0');
  const hOff = await off.evaluate(() => document.querySelector('header.top')!.getBoundingClientRect().height);
  await off.close();
  await open(page, '', 320, 640);
  const hOn = await page.evaluate(() => document.querySelector('header.top')!.getBoundingClientRect().height);
  expect(hOn, 'hiding the unnecessary Crew pill keeps the header compact').toBeLessThanOrEqual(hOff + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!document.getElementById('cpbtn')), { timeout: 60_000 }).toBe(true);
  await expect(f.locator('#mcx-talk')).toBeHidden();
  const fb = await (await f.frameElement()).boundingBox();
  const r = await f.locator('#cpbtn').boundingBox();
  expect(fb!.y + r!.y + r!.height, 'the single Copilot entry stays on screen').toBeLessThanOrEqual(640);
  expect(r!.x + r!.width).toBeLessThanOrEqual(320);
});
