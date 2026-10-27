import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell } from './helpers';

// AB#501 (Analyst live view), view 8: a player radar. Six measures for one player, each against the best player in the match on that measure.
// Passes, progressive passes, shots, xG and ball wins come from the events; distance comes from the live position samples. The panel says Simulated.
declare const AG: any;
declare const MAPS: any;

const block3d = (page: Page) => page.route(/\/(watch|broadcast)\/index\.html/, (rt) => rt.abort());

// Roster slots: 1 E. Belruda (home), 2 D. Okoro (home), 12 T. Marsh (away); the rest are P<i>. Harbor City (h) attacks 105, Thames Rovers (a) attacks 0.
// Events, as the player who makes them:
//   E. Belruda: pass gain 15 (progressive), pass gain 6 (not), shot xG 0.3, ball win.  -> passes 2, progressive 1, shots 1, xG 0.30, ball wins 1
//   D. Okoro:   pass gain 20 (progressive).                                           -> passes 1, progressive 1, shots 0, xG 0.00, ball wins 0
//   T. Marsh:   shot xG 0.1.                                                          -> shots 1, xG 0.10
// The best on each measure: passes 2, progressive 1, shots 1, xG 0.30, ball wins 1, distance 10 m. So Belruda is full on every measure.
// Belruda moves 1 m a second for 10 seconds, so his distance is 10 m. Everyone else stands still.
// Okoro's shares: passes 1 of 2 = 50%, progressive 100%, shots 0%, xG 0%, ball wins 0%, distance 0 m.
async function seedMatch(page: Page) {
  await page.evaluate(() => {
    AG.reset('k', { hk: 'h', ak: 'a', home: 'Harbor City', away: 'Thames Rovers' });
    const ev = (minute: number, type: string, team: string, player: string, data: any) => ({ minute, type, team, player, ...data });
    const pass = (minute: number, team: string, player: string, x0: number, x1: number) => ev(minute, 'pass', team, player, { x0, y0: 34, x1, y1: 34, to: 'Mate', attack_x: 105 });
    AG.onWatch('k', [
      pass(2, 'h', 'E. Belruda', 40, 55),
      pass(3, 'h', 'E. Belruda', 40, 46),
      ev(5, 'shot', 'h', 'E. Belruda', { x: 90, y: 34, xg: 0.3, fate: 'miss' }),
      ev(6, 'turnover', 'h', 'E. Belruda', { x: 60, y: 34 }),
      pass(7, 'h', 'D. Okoro', 50, 70),
      ev(8, 'shot', 'a', 'T. Marsh', { x: 20, y: 34, xg: 0.1, fate: 'save' }),
    ], []);
    const setup = { h: 'h', a: 'a', seed: 1, st: 0, month: 0, kick: '15:00', half: 45 };
    const roster = { teams: ['h', 'a'], players: Array.from({ length: 22 }, (_, i) => ({ name: i === 1 ? 'E. Belruda' : i === 2 ? 'D. Okoro' : i === 12 ? 'T. Marsh' : 'P' + i, team: i < 11 ? 'h' : 'a' })) };
    const still = Array.from({ length: 22 }, (_, i) => [30 + (i % 5) * 10, 20 + (i % 3) * 15]);
    MAPS.start(setup, roster);
    for (let t = 0; t <= 10; t++) {
      const players = still.map((q, i) => (i === 1 ? [40, 30 + t] : q));
      MAPS.frame(setup, { mclock: t, half: 1, players });
    }
  });
  await expect.poll(() => page.evaluate(() => AG.run.events.length), { timeout: 15_000 }).toBe(6);
}

const row = (page: Page, name: string) => page.locator('#al [data-radar-table] tr', { hasText: name });

test('the radar shows the default player against the best in the match, labelled Simulated', async ({ page }) => {
  const errs = collectErrors(page);
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="radar"]');
  await expect(panel).toContainText('Simulated');
  await expect(page.locator('#al svg[data-map="radar"]')).toHaveCount(1);
  // the busiest player by events is E. Belruda, who is full on every measure
  await expect(panel.locator('[data-radar-player]')).toHaveValue('1');
  await expect(row(page, 'Passes')).toContainText('2');
  await expect(row(page, 'Passes')).toContainText('100%');
  await expect(row(page, 'Distance')).toContainText('10 m');
  await expect(row(page, 'Distance')).toContainText('100%');
  expect(errs).toEqual([]);
});

test('picking another player redraws the radar and its table', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const panel = page.locator('#al [data-panel="radar"]');
  await panel.locator('[data-radar-player]').selectOption('2');
  await expect(row(page, 'Passes')).toContainText('50%');
  await expect(row(page, 'Progressive')).toContainText('100%');
  await expect(row(page, 'Shots')).toContainText('0%');
  await expect(row(page, 'Distance')).toContainText('0 m');
});

test('window.MC.analysis draws a chosen player into a card and cites the events behind the passes, shots and ball wins', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await seedMatch(page);
  const out = await page.evaluate(() => {
    const div = document.createElement('div'); div.id = 'radar-card'; document.body.appendChild(div);
    return (window as any).MC.analysis.render('radar', { player: 'D. Okoro' }, div);
  });
  expect(out.status).toBe('ok');
  // D. Okoro's pass is e5: the fifth of the six events, in order
  expect(out.citations).toEqual(['e5']);
  await expect(page.locator('#radar-card [data-radar-table] tr', { hasText: 'Passes' })).toContainText('50%');
});

test('before the live match, the radar says so', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  const out = await page.evaluate(() => {
    const div = document.createElement('div'); div.id = 'radar-none'; document.body.appendChild(div);
    return (window as any).MC.analysis.render('radar', {}, div);
  });
  expect(out.citations).toEqual([]);
  await expect(page.locator('#radar-none')).toContainText('Needs the live match first.');
});

test('a 10 m gain is progressive here as in view 6, even when float noise lands just under 10', async ({ page }) => {
  await block3d(page);
  await openShell(page, 'analyst', '?crew=1');
  await page.evaluate(() => {
    AG.reset('k', { hk: 'h', ak: 'a', home: 'Harbor City', away: 'Thames Rovers' });
    // 16.4 - 6.4 is 9.999999999999998 in floating point; the view counts it as 10 m
    AG.onWatch('k', [{ minute: 2, type: 'pass', team: 'h', player: 'J. Winger', to: 'Mate', x0: 6.4, y0: 34, x1: 16.4, y1: 34, attack_x: 105 }], []);
    const setup = { h: 'h', a: 'a', seed: 1, st: 0, month: 0, kick: '15:00', half: 45 };
    const roster = { teams: ['h', 'a'], players: Array.from({ length: 22 }, (_, i) => ({ name: i === 1 ? 'J. Winger' : 'P' + i, team: i < 11 ? 'h' : 'a' })) };
    const still = Array.from({ length: 22 }, (_, i) => [30 + (i % 5) * 10, 20 + (i % 3) * 15]);
    MAPS.start(setup, roster);
    for (let t = 0; t <= 2; t++) MAPS.frame(setup, { mclock: t, half: 1, players: still });
  });
  await expect.poll(() => page.evaluate(() => AG.run.events.length), { timeout: 15_000 }).toBe(1);
  await expect(row(page, 'Progressive')).toContainText('1');
  await expect(row(page, 'Progressive')).toContainText('100%');
});
