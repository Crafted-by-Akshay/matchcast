import { test, expect } from './fixtures';
import { openShell } from './helpers';

// UX review 2026-10-24, shell items: one utility row on a phone, 32 px chips on a desktop, no stray
// control beside Voice, no clipped subtitle, and a fixture list that says its score is a recorded one.

test('phone header keeps the utilities in one scrolling row under the view switcher', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openShell(page, 'watch');
  const m = await page.evaluate(() => {
    const row = document.querySelector('.status') as HTMLElement;
    const ids = ['tour-btn', 'voice-btn', 'status-btn', 'api-pill'];
    const tops = ids.map((id) => Math.round(document.getElementById(id)!.getBoundingClientRect().top));
    return { tops, stageH: document.getElementById('stage')!.getBoundingClientRect().height, rowBottom: row.getBoundingClientRect().bottom, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(new Set(m.tops).size, 'Tour, Voice, Status and the agents pill share one row').toBe(1);
  expect(m.rowBottom, 'the header leaves most of the first screen to the match').toBeLessThan(230);
  expect(m.stageH, 'the view gets at least 60 percent of an 844 px phone').toBeGreaterThanOrEqual(500);
  expect(m.over).toBeLessThanOrEqual(1);
});

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
  expect(m.subRight, 'the subtitle ends before the view switcher').toBeLessThanOrEqual(m.swLeft);
});

test('the fixture list says its score is recorded, and the score label says so too', async ({ page }) => {
  await openShell(page, 'analyst');
  const labels = await page.$$eval('#fx option', (os) => os.map((o) => o.textContent || '').filter((t) => /\d–\d/.test(t)));
  expect(labels.length).toBeGreaterThan(20);
  for (const t of labels) expect(t).toMatch(/ v .* \(recorded \d+–\d+\)$/);
  await expect(page.locator('#score-l')).toHaveText('Recorded');
  await expect(page.locator('#api-pill')).toHaveCSS('min-height', '32px');
});
