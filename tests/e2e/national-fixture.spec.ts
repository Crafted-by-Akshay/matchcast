import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';

// A national-team fixture (fx.national) has synthetic squads and no recorded result: it is the default pick when present,
// the match bar says "Synthetic squad" instead of "Recorded", and the Analyst is not routed to a run that does not exist.
test('a national fixture is the default, says Synthetic squad, and is not routed to the Analyst', async ({ page }) => {
  const errs = collectErrors(page);
  await page.route('**/shared/fixtures.json', async (rt) => {
    const res = await rt.fetch(); const list = await res.json();
    const arr = Array.isArray(list) ? list : list.fixtures;
    const n = JSON.parse(JSON.stringify(arr[0])); n.id = 'N001'; n.national = true; n.score = [0, 0]; n.matchday = 99;
    n.home = Object.assign({}, n.home, { club: 'Argentina' }); n.away = Object.assign({}, n.away, { club: 'Brazil' });
    arr.push(n);
    await rt.fulfill({ response: res, json: list });
  });
  await page.route('**/watch/index.html**', (rt) => rt.abort());   // no live minute: the bar shows the fixture's own label
  await openShell(page, 'watch');
  await expect(page.locator('#fx')).toHaveValue('N001');
  await expect(page.locator('#home-club')).toHaveText('Argentina');
  await expect(page.locator('#score-l')).toHaveText('Synthetic squad');
  await expect(page.locator('#score-v')).toHaveText('–');
  expect(await page.locator('#fx option[value="N001"]').getAttribute('title')).toMatch(/no recorded result/);
  expect(await page.evaluate(() => { routeAnalyst(); return !!FR.analyst && FR.analyst.route; }), 'no #live.N001 route').not.toBe('N001');
  expect(errs).toEqual([]);
});
