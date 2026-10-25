import { test, expect } from './fixtures';
import { openShell } from './helpers';
declare const AG: any;

// UX review 2026-10-24, shell items: one utility row on a phone, 32 px chips on a desktop, no stray
// control beside Voice, no clipped subtitle, and a fixture list that says its score is a recorded one.

// Judge re-test: on a phone nothing in the header runs past the right edge (it used to be one sideways-scrolling row). The utilities wrap:
// language and Status share the wordmark's row, Tour, Voice and the agents pill sit under the view switcher.
for (const width of [390, 320]) {
  test(`phone header at ${width} px wraps its utilities inside the screen, under 44 px targets`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openShell(page, 'watch');
    const m = await page.evaluate(() => {
      const ids = ['tour-btn', 'voice-btn', 'status-btn', 'api-pill', 'lang-sel'];
      const boxes = ids.map((id) => { const r = document.getElementById(id)!.getBoundingClientRect(); return { id, l: r.left, r: r.right, h: r.height }; });
      const past = [...document.querySelectorAll('.top *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map((e) => e.id || (e as HTMLElement).className || e.tagName);
      return { boxes, past, stageH: document.getElementById('stage')!.getBoundingClientRect().height, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(m.past, 'nothing in the header runs past the screen edges').toEqual([]);
    for (const b of m.boxes) { expect(b.l, b.id).toBeGreaterThanOrEqual(0); expect(b.r, b.id).toBeLessThanOrEqual(width); }
    for (const b of m.boxes.filter((x) => x.id !== 'api-pill' && x.id !== 'lang-sel')) expect(b.h, b.id + ' tap target').toBeGreaterThanOrEqual(44);
    expect(m.over).toBeLessThanOrEqual(0);
    if (width === 390) expect(m.stageH, 'the view still gets about half of an 844 px phone').toBeGreaterThanOrEqual(420);
  });
}

test('desktop chips are at least 32 px tall and the live-region pill is not drawn', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openShell(page, 'watch');
  const m = await page.evaluate(() => {
    const small = [...document.querySelectorAll('.status .pill')].filter((e) => {
      const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 0 && b.height < 32;
    }).map((e) => e.id || e.textContent);
    const vs = document.getElementById('voice-src')!.getBoundingClientRect();
    const sw = document.querySelector('.switch')!.getBoundingClientRect();
    const sub = document.querySelector('.brand small') as HTMLElement;
    const subRight = getComputedStyle(sub).display === 'none' ? 0 : sub.getBoundingClientRect().right;
    return { small, vsW: vs.width, subRight, swLeft: sw.left };
  });
  expect(m.small).toEqual([]);
  expect(m.vsW, '#voice-src stays out of sight when it has no text').toBeLessThanOrEqual(2);
  expect(m.subRight, 'the subtitle is either hidden or ends before the view switcher').toBeLessThanOrEqual(m.swLeft);
});

test('the fixture list says its score is recorded, and the score label says so too', async ({ page }) => {
  await openShell(page, 'analyst');
  const labels = await page.$$eval('#fx option', (os) => os.map((o) => o.title || '').filter((t) => /\d–\d/.test(t)));   // the score moved from the label to the title (quiet first screen)
  expect(labels.length).toBeGreaterThan(20);
  for (const t of labels) expect(t).toMatch(/^Recorded result \d+–\d+/);
  await expect(page.locator('#score-l')).toHaveText('Recorded');
});

test('a season load error is still visible on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/shared/fixtures.json*', (r) => r.abort());
  await page.goto('/index.html#watch', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#meta')).toContainText('Could not load the season fixtures');
  await expect(page.locator('#meta')).toBeVisible();
});

// Judge re-test (live sha-ee90607): 17 elements of the Agents pane ran past the right edge at 390 px (the claims table was 600+ px wide).
// With some claims in the ledger, nothing in the pane may reach past the screen, and the page does not scroll sideways.
for (const width of [390, 320]) {
  test(`Agents tab at ${width} px: no element runs past the right edge, with claims in the ledger`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openShell(page, 'agents');
    await page.waitForFunction(() => typeof AG !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
    await page.evaluate(() => {
      const names = { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' };
      AG.reset('k1', names);
      AG.onWatch('k1', [{ minute: 12.3, type: 'shot', team: 'thr', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'open play', data: {} }, { minute: 12.4, type: 'goal', team: 'thr', player: 'A One', score: '1-0' }], []);
    });
    await expect.poll(() => page.locator('#ag-claims tr[data-id]').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    const m = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const past = [...document.getElementById('v-agents')!.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 0.5 || r.left < -0.5); }).map((e) => (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + String((e as HTMLElement).className).slice(0, 24)));
      return { past, over: document.documentElement.scrollWidth - vw };
    });
    expect(m.past, 'elements past the screen edges').toEqual([]);
    expect(m.over).toBeLessThanOrEqual(0);
  });
}
