import { test, expect } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// A national-team fixture (fx.national) has synthetic squads and no recorded result: it is the default pick when present,
// the match bar says "Synthetic squad" instead of "Recorded", and the Analyst is not routed to a run that does not exist.
// every season club in apps/unified/shared/clubs.json: a national fixture must not show one of them
const SEASON_CLUBS = /Harbor City|Ridgeview|Coloso Ciudad|Navigli United|Thames Rovers|Montaña CF|Guanabara FC|Lombardia Nord/;

test('a national fixture is the default, says Synthetic squad, and is not routed to the Analyst', async ({ page }) => {
  const errs = collectErrors(page);
  await page.route('**/shared/fixtures.json', async (rt) => {
    const res = await rt.fetch(); const list = await res.json();
    const arr = Array.isArray(list) ? list : list.fixtures;
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].id === 'N001') arr.splice(i, 1);   // the data now ships a real N001; the spec uses its own copy
    const n = JSON.parse(JSON.stringify(arr[0])); n.id = 'N001'; n.national = true; n.score = [0, 0]; n.matchday = 99;
    n.home = Object.assign({}, n.home, { club: 'Argentina' }); n.away = Object.assign({}, n.away, { club: 'Brazil' });
    arr.push(n);
    await rt.fulfill({ response: res, json: list });
  });
  await page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());   // no live minute: the bar shows the fixture's own label
  await openShell(page, 'watch');
  await expect(page.locator('#fx')).toHaveValue('N001');
  await expect(page.locator('#home-club')).toHaveText('Argentina');
  await expect(page.locator('#score-l')).toHaveText('Synthetic squad');
  await expect(page.locator('#score-v')).toHaveText('–');
  expect(await page.locator('#fx option[value="N001"]').getAttribute('title')).toMatch(/no recorded result/);
  expect(await page.evaluate(() => { routeAnalyst(); return !!FR.analyst && FR.analyst.route; }), 'no #live.N001 route').not.toBe('N001');
  expect(errs).toEqual([]);
});

// The shipped data: Argentina v Brazil is the default pick and shows no score.
test('the shipped Argentina v Brazil fixture is the default and shows no score', async ({ page }) => {
  await page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());
  await openShell(page, 'watch');
  await expect(page.locator('#fx')).toHaveValue('N001');
  await expect(page.locator('#home-club')).toHaveText('Argentina');
  await expect(page.locator('#score-v')).toHaveText('–');
  await expect(page.locator('#score-l')).toHaveText('Synthetic squad');
});

// The pre-kick-off caption must not name a season club on a national fixture. The wording is set at build time (build.py NEUTRAL), so this guards that text, not names().
test('the Broadcast caption does not name a season club on a national fixture', async ({ page }) => {
  await openShell(page, 'broadcast', '?seed=2026&fx=N001');
  const f = await viewFrame(page, 'broadcast');
  await expect.poll(() => f.evaluate(() => document.getElementById('cap1')?.textContent || ''), { timeout: 120_000 }).toMatch(/Kick-off|Players are out/);
  const caption = await f.locator('#cap1').textContent();
  expect(caption, 'the caption names no season club').not.toMatch(SEASON_CLUBS);
});

// Once the national match runs, the Broadcast scoreboard names the fixture's clubs (the shipped N001 is Argentina v Brazil).
test('the Broadcast scoreboard names the national clubs once the match runs', async ({ page }) => {
  await openShell(page, 'broadcast', '?seed=2026&fx=N001');
  const f = await viewFrame(page, 'broadcast');
  // the kick-off caption, not the pre-match "Kick-off to come."
  await expect.poll(() => f.evaluate(() => document.getElementById('cap1')?.textContent || ''), { timeout: 120_000 }).toMatch(/^Kick-off at/);
  await expect(f.locator('#bug .tm').first()).toHaveText('ARG');
  await expect(f.locator('#bug .tm').nth(1)).toHaveText('BRA');
});

// The desk names the fixture's clubs from its first render (embed/boot-clubs.js), so no season club shows in its visible text after kick-off.
test('no visible desk line names a season club on a national fixture', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'broadcast', '?seed=2026&fx=N001');
  const f = await viewFrame(page, 'broadcast');
  await expect.poll(() => f.evaluate(() => !!document.getElementById('bc-strip')), { timeout: 120_000 }).toBe(true);
  // the kick-off caption, not the pre-match "Kick-off to come."
  await expect.poll(() => f.evaluate(() => document.getElementById('cap1')?.textContent || ''), { timeout: 120_000 }).toMatch(/^Kick-off at/);
  // positive: the fixture's clubs are on the desk, so the scan below is not checking an empty page
  await expect(f.locator('#bug .tm').first()).toHaveText('ARG');
  await page.waitForTimeout(25_000);
  // every visible line of the desk, not one element: the ticker, the commentary and the Next-goal panel
  const season = await f.evaluate((src) => {
    const SEASON = new RegExp(src);
    const out: string[] = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = (n.textContent || '').trim();
      const el = n.parentElement;
      if (!el || !SEASON.test(t)) continue;
      const cs = getComputedStyle(el);
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().width > 0 && !el.closest('[hidden]')) out.push(t.slice(0, 80));
    }
    return out;
  }, SEASON_CLUBS.source);
  expect(season, 'no visible line names a season club on a national fixture').toEqual([]);
  expect(errs).toEqual([]);
});

// Known gap: a shell message that arrives while the desk waits for the club list is buffered and replayed (embed/boot-clubs.js). This spec is
// fixme: the shell can create the Broadcast frame more than once during boot, so a test-side post can land in a document that has already
// finished waiting, and the spec is flaky (2 of 6 passes). Fix it by posting into the final, stable frame.
test.fixme('a shell message posted while the club list loads is shown once the desk is up', async ({ page }) => {
  const errs = collectErrors(page);
  await page.route('**/shared/clubs.json', async (rt) => {
    const frame = rt.request().frame();
    if (!frame.url().includes('/broadcast/')) return rt.continue();
    // once per desk document: this document is waiting on its club list, so post to it now and hold the list until the message lands
    const posted = await frame.evaluate(() => {
      const w = window as any;
      if (w.__bootPosted) return false;
      w.__bootPosted = true;
      w.__bootSeen = 0;
      w.addEventListener('message', (e: MessageEvent) => { if (e.data?.items?.[0]?.text?.startsWith('Boot wait')) w.__bootSeen += 1; });
      w.postMessage({ src: 'matchcast-shell', type: 'feed-lines', items: [{ minute: 1, text: 'Boot wait line: shown after the club list', tone: '' }] }, '*');
      return true;
    });
    if (posted) await frame.waitForFunction(() => ((window as any).__bootSeen || 0) >= 1);
    return rt.continue();
  });
  await openShell(page, 'broadcast', '?seed=2026&fx=N001');
  // the frame's window sees the original copy, then the replay once the module has finished
  const f = await viewFrame(page, 'broadcast');
  await expect.poll(() => f.evaluate(() => (window as any).__bootSeen || 0), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
  expect(errs).toEqual([]);
});
