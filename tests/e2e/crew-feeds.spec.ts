import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// AB#450: the Watch feed picker (flag ?crew=1). All six feeds are live; a feed with no lines yet says it is waiting. Lines come from CREW.state.feeds
// (the Simulated fixture until the orchestration frames land) through the shell's postMessage bus. Wall-clock timing is meaningless under
// software GL, so every wait polls for state, never for a duration. Honesty: fixture lines are labelled Simulated and carry no Verifier tick.
const LABELS = ['Fan', 'Analyst', 'Audio description', 'Catch me up', 'Half-time explainer', 'News ticker'];

async function open(page: any, width = 1280, height = 800, query = '?crew=1') {
  await page.route('**/broadcast/**', (r: any) => r.abort());   // Watch must load here; a second 3D engine is not needed
  await page.setViewportSize({ width, height });
  await openShell(page, 'watch', query);
  await ready('watch')(page);
  return viewFrame(page, 'watch');
}

// what a real (non-simulated) frame would send: a line that carries the Verifier's verdict
const realFrame = (page: any, lang = 'en') => page.evaluate((l: string) => post('watch', { src: 'matchcast-shell', type: 'crew-feeds', lang: l, simulated: false, defs: CREW.FEEDS,
  feeds: { casual: [{ publication_id: 'r1', text: 'A real checked line.', match_time_ms: 41 * 60000, source_event_ids: ['e1'], verdict: 'verified' }, { publication_id: 'r2', text: 'A line with no verdict.', match_time_ms: 42 * 60000, source_event_ids: ['e2'] }], analyst: [] } }), lang);

test('with ?crew=0 nothing is added: no picker, style, body class or iframe parameter', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await open(page, 1280, 800, '?crew=0');
  await f.waitForSelector('#mc-two', { state: 'attached', timeout: 60_000 });
  expect(await f.locator('#mc-feedpick').count()).toBe(0);
  expect(await f.locator('#mc-feedpick-css').count()).toBe(0);
  expect(await f.evaluate(() => document.body.className)).not.toMatch(/mc-feed/);
  expect(await page.evaluate(() => [...document.querySelectorAll('iframe')].map((i) => i.src).join(' '))).not.toContain('crew=1');
  await expect(f.locator('#mc-two')).toBeHidden();   // simplified UI does not show the duplicate two-viewer demo
});

test('feed picker: six labelled choices, no Planned tags, waiting copy, Simulated lines with a minute and no tick, saved choice', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await open(page);
  const group = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(group).toBeVisible({ timeout: 60_000 });
  const radios = group.getByRole('radio');
  expect(await radios.count()).toBe(6);
  for (let i = 0; i < 6; i++) await expect(radios.nth(i)).toContainText(LABELS[i]);
  expect(await group.locator('.fp-tag:visible').count()).toBe(0);
  await expect(radios.nth(0).locator('.fp-tag')).toHaveCount(0);
  await expect(radios.nth(1).locator('.fp-tag')).toHaveCount(0);
  await expect(radios.nth(2).locator('.fp-tag')).toHaveCount(0);
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
  const card = f.locator('#mc-feedlines');
  await expect(card).toContainText('waiting for a moment');
  expect(await f.locator('#mc-trust').count(), 'the Verifier chip stays').toBe(1);
  await expect(radios.nth(3).locator('.fp-tag')).toHaveCount(0);
  await radios.nth(2).click();
  await expect(radios.nth(2)).toHaveAttribute('aria-checked', 'true');
  await expect(card).toContainText('waiting for a moment');
  expect(await card.locator('li').count()).toBe(0);
  await radios.nth(0).click();
  await page.evaluate(() => CREW.play(23));
  const line = card.locator('li').first();
  await expect(line).toContainText('GOAL! Second shot on target', { timeout: 60_000 });
  await expect(line.locator('.fp-min')).toHaveText("23'");
  await expect(card.locator('.fp-sim')).toHaveText('Simulated');
  expect(await card.locator('.fp-tick').count(), 'a fixture line carries no Verifier tick').toBe(0);
  await radios.nth(1).click();
  await expect(card.locator('li').first()).toContainText('xG 0.31', { timeout: 60_000 });
  await f.evaluate(() => location.reload());
  await f.waitForSelector('#mc-feedpick', { state: 'attached', timeout: 120_000 });
  await expect(f.getByRole('radiogroup', { name: 'Feed' }).getByRole('radio').nth(1)).toHaveAttribute('aria-checked', 'true', { timeout: 60_000 });
  expect(errs).toEqual([]);
});

test('feed picker: a tick only on a line with a verified verdict from a real frame, and only new lines are announced', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await open(page);
  await expect(f.getByRole('radiogroup', { name: 'Feed' })).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => post('watch', { src: 'matchcast-shell', type: 'crew-feeds', lang: 'en', simulated: false, defs: CREW.FEEDS, feeds: { casual: [], analyst: [] } }));   // the first message records what is there
  await expect(f.locator('#mc-feedlines')).toContainText('waiting for a moment');
  await realFrame(page);
  const lis = f.locator('#mc-feedlines li');
  await expect(lis).toHaveCount(2, { timeout: 30_000 });
  await expect(f.locator('#mc-feedlines .fp-sim')).toHaveCount(0);
  // newest first: r2 has no verdict (no tick), r1 is verified
  expect(await lis.nth(0).locator('.fp-tick').count()).toBe(0);
  await expect(lis.nth(1).locator('.fp-tick')).toHaveAttribute('aria-label', 'Verified');
  await expect(f.locator('#mc-feedsr')).toHaveText('A real checked line.. A line with no verdict.');
  await f.evaluate(() => { document.getElementById('mc-feedsr')!.textContent = ''; });
  await realFrame(page);   // the same lines again: nothing new to announce
  await page.evaluate(() => post('watch', { src: 'matchcast-shell', type: 'lang', lang: 'es' }));   // a later message, so the repeat has been handled
  await expect(f.locator('#mc-feedlines .fp-note')).toBeVisible({ timeout: 30_000 });
  expect(await f.locator('#mc-feedsr').textContent()).toBe('');
});

test('feed picker: arrow, Home and End keys move the choice and keep focus on it', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await open(page);
  const group = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(group).toBeVisible({ timeout: 60_000 });
  const radios = group.getByRole('radio');
  await radios.nth(0).focus();
  await f.page().keyboard.press('ArrowRight');
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(radios.nth(1)).toBeFocused();
  // all six feeds are live, so End lands on the last one (News ticker)
  await f.page().keyboard.press('End');
  await expect(radios.nth(1)).toHaveAttribute('aria-checked', 'true');
  await expect(radios.nth(1)).toBeFocused();
  await f.page().keyboard.press('ArrowRight');   // wraps
  await expect(radios.nth(0)).toBeFocused();
  await f.page().keyboard.press('ArrowLeft');
  await expect(radios.nth(1)).toBeFocused();
  await f.page().keyboard.press('Home');
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(radios.nth(0)).toBeFocused();
  // new data arriving does not drop focus
  await page.evaluate(() => CREW.play(23));
  await expect(f.locator('#mc-feedlines li').first()).toBeVisible({ timeout: 60_000 });
  await expect(radios.nth(0)).toBeFocused();
});

test('the duplicate two-viewer panel stays hidden in the simplified commentary layout', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await open(page);
  const group = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(group).toBeVisible({ timeout: 60_000 });
  await expect(f.locator('#mc-two')).toBeHidden();
  await page.evaluate(() => CREW.play(23));
  await expect(f.locator('#mc-feedlines li').first()).toBeVisible({ timeout: 60_000 });
  expect(await disp(), 'a live feed with lines replaces the panel').toBe('none');
  await group.getByRole('radio', { name: /Audio description/ }).click();
  expect(await disp(), 'a live feed with no lines yet leaves the panel').not.toBe('none');
  await group.getByRole('radio', { name: /Fan/ }).click();
  expect(await disp()).toBe('none');
  await page.evaluate(() => CREW.reset());
  await expect(f.locator('#mc-feedlines')).toContainText('waiting for a moment');
  expect(await disp(), 'back to no lines: the panel returns').not.toBe('none');
});

test('feed picker: the pick goes to the shell, and a language with no translated line says English is shown', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await open(page);
  await expect(f.getByRole('radiogroup', { name: 'Feed' })).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => { (window as any).__picks = []; window.addEventListener('message', (e) => { if (e.data && e.data.type === 'crew-feed-pick') (window as any).__picks.push([e.data.key, e.data.lang]); }); });
  await f.getByRole('radio', { name: /Analyst/ }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__picks)).toContainEqual(['analyst', 'en']);
  await page.evaluate(() => post('watch', { src: 'matchcast-shell', type: 'lang', lang: 'es' }));
  await expect(f.locator('#mc-feedlines')).toContainText('Showing English: no translated line yet', { timeout: 30_000 });
  await page.evaluate(() => post('watch', { src: 'matchcast-shell', type: 'lang', lang: 'en' }));
  await expect(f.locator('#mc-feedlines')).not.toContainText('Showing English');
});

for (const [name, w, h] of [['phone', 390, 844], ['small phone', 320, 640]] as const) {
  test(`feed picker on a ${name}: no sideways scroll, the card does not grow, feed text and the English note are visible and clear of Talk and Copilot`, async ({ page }) => {
    test.setTimeout(300_000);
    const f = await open(page, w, h);
    await expect(f.getByRole('radiogroup', { name: 'Feed' })).toBeVisible({ timeout: 60_000 });
    await f.getByRole('radio', { name: /^Analyst/ }).click();   // on a phone the one-line replacement only follows a feed the viewer picks; Casual keeps the commentary line (crew-default.spec)
    await page.evaluate(() => CREW.play(23));
    await expect(f.locator('#mc-feedlines li').first()).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => post('watch', { src: 'matchcast-shell', type: 'lang', lang: 'es' }));
    await expect(f.locator('#mc-feedlines .fp-note')).toBeVisible({ timeout: 30_000 });
    await expect(f.locator('#mc-trust')).toBeHidden();
    await expect(f.locator('#mcf-sound')).toBeHidden();
    const geom = () => f.evaluate(() => {
      const r = (sel: string) => { const e = document.querySelector(sel); if (!e || getComputedStyle(e).display === 'none') return null; const b = e.getBoundingClientRect(); return b.width ? { l: b.left, t: b.top, r: b.right, b: b.bottom } : null; };
      return { mcf: r('#mcf'), pick: r('#mc-feedpick'), lines: r('#mc-feedlines li'), note: r('#mc-feedlines .fp-note'), cp: r('#cpbtn'), sw: document.documentElement.scrollWidth, iw: innerWidth };
    });
    // the Talk and Copilot controls are placed by a one second timer: poll until they are drawn
    await expect.poll(async () => { const g = await geom(); return !!(g.cp && g.mcf && g.lines && g.note); }, { timeout: 30_000 }).toBe(true);
    const g = await geom();
    const hit = (a: any, b: any) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    expect(g.pick!.l).toBeGreaterThanOrEqual(0);
    expect(g.pick!.r).toBeLessThanOrEqual(g.iw);
    expect(g.sw, 'Watch does not scroll sideways').toBeLessThanOrEqual(g.iw);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the shell does not scroll sideways').toBe(true);
    // The caption and the two audience choices stay compact at phone width; Talk lives inside Copilot instead of floating beside the card.
    expect(g.mcf!.b - g.mcf!.t, 'the commentary card is no taller than before').toBeLessThanOrEqual(99);
    expect(hit(g.lines!, g.cp!), 'feed text clear of Copilot').toBe(false);
    expect(g.note!.r, 'the English note stays inside the card').toBeLessThanOrEqual(g.mcf!.r);
  });
}

test('feed picker: a saved choice is restored, and the arrow keys step from it', async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => { try { localStorage.setItem('mc-feedpick', 'ticker'); } catch (e) { /* storage blocked */ } });
  const f = await open(page);
  const group = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(group).toBeVisible({ timeout: 60_000 });
  const radios = group.getByRole('radio');
  await expect(radios.nth(5)).toHaveAttribute('aria-checked', 'true');
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'false');
  await radios.nth(5).focus();
  await expect(radios.nth(5)).toBeFocused();
  await f.page().keyboard.press('ArrowLeft');
  await expect(radios.nth(4)).toHaveAttribute('aria-checked', 'true');
  await expect(radios.nth(4)).toBeFocused();
});

test('feed picker: when the shell drops the live feed in use, the picker falls back to a live feed and tells the shell', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await open(page);
  const group = f.getByRole('radiogroup', { name: 'Feed' });
  await expect(group).toBeVisible({ timeout: 60_000 });
  const radios = group.getByRole('radio');
  await radios.nth(3).click();   // Catch me up, live until the shell says otherwise
  await expect(radios.nth(3)).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => post('watch', { src: 'matchcast-shell', type: 'crew-feeds', lang: 'en', simulated: true, feeds: {}, defs: [
    { key: 'casual', label: 'Casual', live: true }, { key: 'analyst', label: 'Analyst', live: true },
    { key: 'audio_description', label: 'Audio description', live: false }, { key: 'catch_me_up', label: 'Catch me up', live: false },
  ] }));
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true');
  await expect(radios.nth(3)).toHaveAttribute('aria-checked', 'false');
});
