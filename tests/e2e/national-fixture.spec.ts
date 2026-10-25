import { test, expect } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// A national-team fixture (fx.national) has synthetic squads and no recorded result: it is the default pick when present,
// the match bar says "Synthetic squad" instead of "Recorded", and the Analyst is not routed to a run that does not exist.
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

// Before kick-off the Broadcast caption must not name a season club on a national fixture: the fixture's clubs are applied at kick-off.
test('the Broadcast caption does not name a season club on a national fixture', async ({ page }) => {
  await page.route('**/shared/fixtures.json', async (rt) => {
    const res = await rt.fetch(); const list = await res.json();
    const arr = Array.isArray(list) ? list : list.fixtures;
    const n = JSON.parse(JSON.stringify(arr[0])); n.id = 'N001'; n.national = true; n.score = [0, 0]; n.matchday = 99;
    n.home = Object.assign({}, n.home, { club: 'Argentina' }); n.away = Object.assign({}, n.away, { club: 'Brazil' });
    arr.push(n);
    await rt.fulfill({ response: res, json: list });
  });
  await openShell(page, 'broadcast', '?seed=2026&fx=N001');
  const f = await viewFrame(page, 'broadcast');
  await expect.poll(() => f.evaluate(() => !!document.getElementById('cap1')), { timeout: 120_000 }).toBe(true);
  const caption = await f.locator('#cap1').textContent();
  expect(caption, 'the caption names no season club').not.toContain('Harbor City');
});
