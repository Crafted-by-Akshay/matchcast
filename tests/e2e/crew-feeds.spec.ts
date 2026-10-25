import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// AB#450: the Watch feed picker (flag ?crew=1). Casual and Analyst are live; the other four are Planned. Lines come from CREW.state.feeds
// (the Simulated fixture until the orchestration frames land) through the shell's postMessage bus. Wall-clock timing is meaningless under
// software GL, so every wait polls for the state, never for a duration.
const LABELS = ['Casual', 'Analyst', 'Audio description', 'Catch me up', 'Half-time explainer', 'News ticker'];

async function open(page: any, width = 1280, height = 800, query = '?crew=1') {
  await page.route('**/broadcast/**', (r: any) => r.abort());   // Watch must load here; a second 3D engine is not needed
  await page.setViewportSize({ width, height });
  await openShell(page, 'watch', query);
  await ready('watch')(page);
  return viewFrame(page, 'watch');
}

test('without ?crew=1 the Watch first screen has no feed picker', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await open(page, 1280, 800, '');
  await f.waitForSelector('#mcf', { state: 'attached', timeout: 60_000 });
  await page.waitForTimeout(1500);
  expect(await f.locator('#mc-feedpick').count()).toBe(0);
});

test('feed picker: six labelled choices, Planned tags, planned copy, waiting copy, verified lines with minute and tick, saved choice', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await open(page);
  const group = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(group).toBeVisible({ timeout: 60_000 });
  const radios = group.getByRole('radio');
  expect(await radios.count()).toBe(6);
  for (let i = 0; i < 6; i++) await expect(radios.nth(i)).toContainText(LABELS[i]);
  // only the four unbuilt feeds carry a visible Planned tag
  expect(await group.locator('.fp-tag:visible').count()).toBe(4);
  await expect(radios.nth(0).locator('.fp-tag')).toHaveCount(0);
  await expect(radios.nth(1).locator('.fp-tag')).toHaveCount(0);
  await expect(radios.nth(2).locator('.fp-tag')).toHaveText('Planned');
  // Casual is the default and has no lines yet
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
  const card = f.locator('#mc-feedlines');
  await expect(card).toContainText('waiting for a moment');
  expect(await f.locator('#mc-trust').count(), 'the Verifier chip stays').toBe(1);
  // a planned feed says so
  await radios.nth(3).click();
  await expect(radios.nth(3)).toHaveAttribute('aria-checked', 'true');
  await expect(card).toContainText('Planned: this feed is not built yet');
  expect(await card.locator('li').count()).toBe(0);
  // the Simulated fixture publishes one casual and one analyst line at minute 23
  await radios.nth(0).click();
  await page.evaluate(() => CREW.play(23));
  const line = card.locator('li').first();
  await expect(line).toContainText('GOAL! Second shot on target', { timeout: 60_000 });
  await expect(line.locator('.fp-min')).toHaveText("23'");
  await expect(line.locator('.fp-tick')).toHaveAttribute('aria-label', 'Verified');
  await expect(card).not.toContainText('waiting for a moment');
  await radios.nth(1).click();
  await expect(card.locator('li').first()).toContainText('xG 0.31', { timeout: 60_000 });
  // the choice is saved and restored after a reload
  await f.evaluate(() => location.reload());
  await f.waitForSelector('#mc-feedpick', { state: 'attached', timeout: 120_000 });
  await expect(f.getByRole('radiogroup', { name: 'Feed' }).getByRole('radio').nth(1)).toHaveAttribute('aria-checked', 'true', { timeout: 60_000 });
  expect(errs).toEqual([]);
});

test('feed picker: the pick goes to the shell, and a language with no translated line says English is shown', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await open(page);
  await expect(f.getByRole('radiogroup', { name: 'Feed' })).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => { (window as any).__picks = []; window.addEventListener('message', (e) => { if (e.data && e.data.type === 'crew-feed-pick') (window as any).__picks.push(e.data.key); }); });
  await f.getByRole('radio', { name: /Analyst/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__picks)).toContain('analyst');
  await page.evaluate(() => post('watch', { src: 'matchcast-shell', type: 'lang', lang: 'es' }));
  await expect(f.locator('#mc-feedlines')).toContainText('Showing English: no translated line yet', { timeout: 30_000 });
  await page.evaluate(() => post('watch', { src: 'matchcast-shell', type: 'lang', lang: 'en' }));
  await expect(f.locator('#mc-feedlines')).not.toContainText('Showing English');
});

for (const [name, w, h] of [['phone', 390, 844], ['small phone', 320, 640]] as const) {
  test(`feed picker on a ${name}: no sideways scroll, clear of Talk and the commentary card`, async ({ page }) => {
    test.setTimeout(300_000);
    const f = await open(page, w, h);
    await expect(f.getByRole('radiogroup', { name: 'Feed' })).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => CREW.play(23));
    await expect(f.locator('#mc-feedlines li').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2500);   // card placement runs on a one second timer
    const g = await f.evaluate(() => {
      const r = (sel: string) => { const e = document.querySelector(sel); if (!e || getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
      return { mcf: r('#mcf'), pick: r('#mc-feedpick'), lines: r('#mc-feedlines'), talk: r('#mcx-talk'), cp: r('#cpbtn'), sw: document.documentElement.scrollWidth, iw: innerWidth };
    });
    const hit = (a: any, b: any) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    expect(g.pick, 'the picker is drawn').not.toBeNull();
    expect(g.pick!.l).toBeGreaterThanOrEqual(0);
    expect(g.pick!.r).toBeLessThanOrEqual(g.iw);
    expect(g.sw, 'Watch does not scroll sideways').toBeLessThanOrEqual(g.iw);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the shell does not scroll sideways').toBe(true);
    // The commentary card already reaches the Talk row on a phone before this feature (its header sits beside it, measured 98 px tall at 390 px).
    // The picker lives in that header row and the one-line feed text replaces the commentary line, so the card must not grow, and the feed text must stay clear of Talk and Copilot.
    expect(g.mcf!.b - g.mcf!.t, 'the commentary card is no taller than before').toBeLessThanOrEqual(99);
    if (g.talk) { expect(hit(g.lines, g.talk), 'feed text clear of Talk').toBe(false); expect(g.mcf!.t, 'the card does not rise above the Talk control').toBeGreaterThanOrEqual(g.talk.t); }
    if (g.cp) expect(hit(g.lines, g.cp), 'feed text clear of Copilot').toBe(false);
  });
}
