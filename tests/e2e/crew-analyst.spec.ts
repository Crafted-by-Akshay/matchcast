import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// CREW-7.8 (AB#501): behind ?crew=1 the Analyst tab is a compact live view built from the shell's own data (AG, CM, LV, CREW);
// the 27-page console moves behind "Full console". With the flag off nothing changes. Watch loses the weather chip and the
// camera presets unless ?demo=1. Shell tests block the 3D frames so they are deterministic.
declare const AG: any;
declare const CREW: any;
declare const FR: any;
declare const M: any;

const block3d = (page: Page) => page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());

// A small seeded match straight into the shell's agents, the way Watch's batches arrive (Harbor City = h, Thames Rovers = a).
async function seedMatch(page: Page) {
  await page.evaluate(() => {
    AG.reset('k', { hk: 'h', ak: 'a', home: 'Harbor City', away: 'Thames Rovers' });
    const sh = (minute: number, team: string, player: string, x: number, y: number, xg: number, fate: string) => ({ minute, type: 'shot', team, player, x, y, xg, fate });
    const pass = (minute: number, team: string, player: string, x0: number, x1: number) => ({ minute, type: 'pass', team, player, to: 'Mate', x0, y0: 30, x1, y1: 34 });
    AG.onWatch('k', [
      pass(2, 'h', 'E. Belruda', 40, 52), pass(2.5, 'h', 'E. Belruda', 52, 60), pass(3, 'a', 'T. Marsh', 50, 44),
      sh(5, 'h', 'E. Belruda', 92, 30, 0.31, 'goal'), { minute: 5, type: 'goal', team: 'h', player: 'E. Belruda' },
      sh(12, 'a', 'T. Marsh', 14, 40, 0.07, 'miss'), sh(20, 'h', 'D. Okoro', 88, 20, 0.22, 'save'),
    ], []);
  });
  await expect.poll(() => page.evaluate(() => AG.run.claims.filter((c: any) => c.verdict === 'verified').length), { timeout: 15_000 }).toBeGreaterThan(1);
  await page.evaluate(() => {
    CREW.ingest({ kind: 'publish', feed: 'analyst', line: { publication_id: 'm-23:p2', text: 'Second shot on target, first goal; xG 0.31.', match_time_ms: 23 * 60000, source_event_ids: ['e1'] } });
  });
}

test('?crew=0: the Analyst tab is the console iframe, no live view', async ({ page }) => {
  const errs = collectErrors(page);
  await block3d(page);
  await openShell(page, 'analyst', '?crew=0');
  await expect(page.locator('#al')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!(FR.analyst && FR.analyst.el))).toBe(true);
  await expect(page.locator('#v-analyst iframe')).toHaveAttribute('title', 'Analyst: enterprise console');
  expect(errs).toEqual([]);
});

test('flag on: a live view from the shell data, labelled Simulated, no iframe yet', async ({ page }) => {
  const errs = collectErrors(page);
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  const al = page.locator('#al');
  await expect(al).toBeVisible();
  expect(await page.evaluate(() => !!FR.analyst), 'the 27-page console is not loaded until asked for').toBe(false);
  await seedMatch(page);

  // analyst feed: verified lines with their minute; the crew fixture is labelled Simulated
  const feed = al.locator('[data-panel="feed"]');
  await expect(feed).toContainText("23'");
  await expect(feed).toContainText('Second shot on target, first goal; xG 0.31.');
  const fixtureRow = feed.locator('[data-group="fixture"] li', { hasText: 'Second shot on target' });
  await expect(fixtureRow).toContainText('Simulated, not recounted');
  await expect(fixtureRow).not.toContainText('verified');            // the crew fixture is never ticked as verified
  const verified = feed.locator('[data-group="verified"] li');
  expect(await verified.count()).toBeGreaterThan(0);
  await expect(verified.first()).toContainText('verified');           // recounted AG.run claims are, and sit in their own group

  // shot map: three shots, dots sized by xG, an accessible name with a text summary
  const map = al.locator('svg[data-map="shots"]');
  await expect(map).toHaveAttribute('role', 'img');
  await expect(map).toHaveAttribute('aria-label', /3 shots.*Harbor City 2.*Thames Rovers 1/);
  const dots = map.locator('circle[data-xg]');
  await expect(dots).toHaveCount(3);
  const r = await dots.evaluateAll((els) => els.map((e) => ({ xg: +e.getAttribute('data-xg')!, r: +e.getAttribute('r')! })));
  const big = r.find((d) => d.xg === 0.31)!, small = r.find((d) => d.xg === 0.07)!;
  expect(big.r).toBeGreaterThan(small.r);
  await expect(al.locator('[data-panel="shots"]')).toContainText('Simulated');

  // pass quality, counted from the pass events, completion inferred
  const passes = al.locator('[data-panel="passes"]');
  await expect(passes).toContainText('Harbor City');
  const hrow = passes.locator('tr', { hasText: 'Harbor City' });
  await expect(hrow.locator('td').nth(1)).toHaveText('2');
  await expect(hrow.locator('td').nth(2)).toHaveText('100%');
  await expect(hrow.locator('td').nth(3)).toHaveText('10.8 m');       // (12.65 + 8.94) / 2
  await expect(passes).toContainText('inferred');

  // storyline ledger: lines already said per player and club
  const story = al.locator('[data-panel="story"]');
  await expect(story).toContainText('E. Belruda');
  await expect(story).toContainText('Harbor City');

  // control vs chaos: no honest source until Watch reports its indices, then the gauge shows them
  const ctl = al.locator('[data-panel="control"]');
  await expect(ctl).toContainText('No control or chaos index yet');
  await page.evaluate(() => { M.indices = { t_ms: 600000, control: 62, chaos: 31, tempo: 8, series: [], passes: 12 }; });
  await expect(ctl.locator('[data-gauge="control"]')).toHaveAttribute('aria-label', /Control 62/);
  await expect(ctl.locator('[data-gauge="control"]')).toHaveAttribute('aria-valuenow', '62');
  await expect(ctl.locator('[data-gauge="chaos"]')).toHaveAttribute('aria-valuenow', '31');
  await expect(ctl.locator('[data-gauge="control"] i')).toHaveAttribute('style', /width:62%/);
  await expect(ctl.locator('[data-gauge="chaos"]')).toHaveAttribute('aria-label', /Chaos 31/);
  expect(errs).toEqual([]);
});

test('favourite club sets the highlighted side and is remembered', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const sel = page.locator('#al-fav');
  await expect(sel.locator('option')).toHaveCount(2);
  await sel.selectOption({ label: 'Thames Rovers' });
  await expect(page.locator('#al [data-side="1"][data-fav="1"]').first()).toBeVisible();
  await expect(page.locator('#al [data-side="0"][data-fav="1"]')).toHaveCount(0);
  await sel.selectOption({ label: 'Harbor City' });
  await expect(page.locator('#al [data-side="0"][data-fav="1"]').first()).toBeVisible();
  await sel.selectOption({ label: 'Thames Rovers' });
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#fx option').length > 20);
  await seedMatch(page);
  await expect(page.locator('#al-fav')).toHaveValue('1');
  await expect(page.locator('#al [data-side="1"][data-fav="1"]').first()).toBeVisible();
  // storage blocked: the choice still holds for the visit
  await page.evaluate(() => { Storage.prototype.getItem = () => { throw new Error('blocked'); }; Storage.prototype.setItem = () => { throw new Error('blocked'); }; });
  await page.locator('#al-fav').selectOption({ label: 'Harbor City' });
  await expect(page.locator('#al [data-side="0"][data-fav="1"]').first()).toBeVisible();
});

test('Full console opens the existing iframe with the same routing, and Live view returns', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  // a club fixture routes to its recorded run, exactly as before
  const id = await page.evaluate(() => [...document.querySelectorAll('#fx option')].map((o: any) => o.value).find((v) => !/^N/.test(v)));
  await page.selectOption('#fx', id!);
  await page.getByRole('button', { name: 'Full console' }).click();
  await expect(page.locator('#al')).toBeHidden();
  await expect(page.locator('#v-analyst iframe')).toBeVisible();
  await expect(page.locator('#v-analyst iframe')).toHaveAttribute('title', 'Analyst: enterprise console');
  expect(await page.evaluate(() => FR.analyst.route)).toBe(id);
  expect(await page.evaluate(() => document.getElementById('tab-analyst')!.getAttribute('aria-selected'))).toBe('true');
  await page.getByRole('button', { name: 'Live view' }).click();
  await expect(page.locator('#al')).toBeVisible();
  await expect(page.locator('#v-analyst iframe')).toBeHidden();
});

test('Full console on a national fixture is not routed to a run that does not exist', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await expect(page.locator('#fx')).toHaveValue('N001');
  await expect(page.locator('#v-analyst iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Full console' }).click();
  await expect(page.locator('#v-analyst iframe')).toBeVisible();
  expect(await page.evaluate(() => FR.analyst.route)).not.toBe('N001');
  expect(await page.locator('#v-analyst iframe').getAttribute('src')).not.toContain('#live.');
  await expect(page.locator('#al-back')).toBeFocused();
  // the Live view bar sits above the console, not over it
  const bar = await page.locator('#al-bar').boundingBox(), fr = await page.locator('#v-analyst iframe').boundingBox();
  expect(fr!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height - 1);
  await page.getByRole('button', { name: 'Live view' }).click();
  await expect(page.locator('#al-full')).toBeFocused();
});

test('phone width 320: no sideways scroll, SVGs named', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  await expect(page.locator('#al svg[data-map="shots"]')).toBeVisible();
  const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: innerWidth, al: document.getElementById('al')!.scrollWidth, alc: document.getElementById('al')!.clientWidth }));
  expect(w.doc).toBeLessThanOrEqual(w.win);
  expect(w.al).toBeLessThanOrEqual(w.alc);
  for (const svg of await page.locator('#al svg').all()) expect(await svg.getAttribute('aria-label') || await svg.getAttribute('aria-hidden')).toBeTruthy();
});

test('the live view is the default Analyst tab with no flag, never a spinner, and localStorage mc-crew=0 turns it off', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst');
  await expect(page.locator('#al')).toBeVisible();
  await expect(page.locator('#v-analyst .wait')).toBeHidden();   // no "Opening the Analyst" spinner over the live view
  expect(await page.evaluate(() => !!(FR.analyst && FR.analyst.el)), 'the console iframe is not loaded until Full console is pressed').toBe(false);
  const p2 = await page.context().newPage();
  await block3d(p2);
  await p2.addInitScript(() => localStorage.setItem('mc-crew', '0'));
  await openShell(p2, 'analyst');
  await expect(p2.locator('#al')).toHaveCount(0);
  await expect.poll(() => p2.evaluate(() => !!(FR.analyst && FR.analyst.el))).toBe(true);
});

// Watch (real frame): the weather chip and the camera presets are gone unless ?demo=1
test('crew: Watch shows no weather chip and no camera presets unless ?demo=1', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'watch', '?crew=1');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect(f.locator('#wxchip')).toBeHidden();
  await expect(f.locator('#cams')).toBeHidden();
  await expect(f.locator('#mc-demo')).toBeHidden();             // no Demo controls button to open them either
  await expect(f.locator('#mc-pause')).toBeVisible();
  await page.goto('/index.html?crew=1&demo=1&split=1#watch');
  await ready('watch')(page);
  const g = await viewFrame(page, 'watch');
  await expect(g.locator('#mc-demo')).toBeVisible();
  await expect(g.locator('#cams')).toBeVisible();
});

// flag off: Watch keeps Demo controls and shows the weather chip once they are opened; the camera presets stay off the screen (AB#497, first-screen.spec) unless ?demo=1
test('?crew=0: Watch still has Demo controls and the weather chip, camera presets stay hidden', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'watch', '?crew=0');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect(f.locator('#mc-demo')).toBeVisible();
  await f.locator('#mc-demo').click();
  await expect(f.locator('#wxchip')).toBeVisible();
  await expect(f.locator('#cams')).toHaveCount(1);
  await expect(f.locator('#cams')).toBeHidden();
});

test('real crew lines in the Analyst feed are not labelled Simulated, and a verified one is ticked (AB#498 onair)', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  const feed = page.locator('#al [data-panel="feed"]');
  await expect(feed).toBeVisible();
  await page.evaluate(() => {
    CREW.ingest({ kind: 'onair', publication_id: 'L-1', feed: 'analyst', lang: 'en', text: 'A recounted crew line.', source_event_ids: ['e1'], claim_ids: ['c1'],
      match_time_ms: 23 * 60000, aired_at: '2026-10-25T10:00:00Z', repair_count: 0 });
  });
  const row = feed.locator('[data-group="crew"] li', { hasText: 'A recounted crew line.' });
  await expect(row).toContainText('verified');
  await expect(row).not.toContainText('Simulated');
  await expect(feed.locator('[data-group="fixture"]')).toHaveCount(0);
});
