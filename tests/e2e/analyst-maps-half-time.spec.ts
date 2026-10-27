import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';

// The live maps keep the first half when the second half starts. Watch's match clock goes back to 45:00 at half-time
// (setup.js: S.mclock = 45 * 60), so the maps must order samples by half first, not by the clock alone. A kick-off
// that restarts the same half still starts the maps again.
const SETUP = { h: 'ARG', a: 'BRA', seed: 2026, st: 4, month: 7, kick: '17:00', half: 15 };
const NAMES = Array.from({ length: 22 }, (_, i) => 'P' + i);
const ROSTER = { teams: ['ARG', 'BRA'], players: NAMES.map((n, i) => ({ name: n, team: i < 11 ? 'ARG' : 'BRA' })) };

test('analyst maps: the second half adds to the first half when the clock goes back to 45:00', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  const samples = await page.evaluate(({ setup, roster, names }) => {
    const M = (window as any).MAPS;
    const at = (s: number) => names.map((_: string, i: number) => [(i * 4 + s * 0.4) % 105, 10 + (i * 3) % 50, 0, 0, 0, 0]);
    M.start(setup, roster);
    for (let s = 2600; s < 2880; s++) M.frame(setup, { mclock: s, half: 1, players: at(s) });   // first half, with added time to 47:20
    for (let s = 2700; s < 2800; s++) M.frame(setup, { mclock: s, half: 2, players: at(s) });   // second half: the clock is back at 45:00
    return { samples: M.samples, t: M.match().frames.slice(279, 282).map((f: { t: number }) => f.t) };
  }, { setup: SETUP, roster: ROSTER, names: NAMES });
  expect(samples.samples).toBe(280 + 100);
  // one timeline for the minute views: the second half starts where the first ended (2879 s), then runs on
  expect(samples.t).toEqual([2879, 2879, 2880]);
  expect(errs).toEqual([]);
});

test('analyst maps: a kick-off that restarts the same half starts the maps again', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  const samples = await page.evaluate(({ setup, roster, names }) => {
    const M = (window as any).MAPS;
    const at = (s: number) => names.map((_: string, i: number) => [(i * 4 + s * 0.4) % 105, 10 + (i * 3) % 50, 0, 0, 0, 0]);
    M.start(setup, roster);
    for (let s = 0; s < 50; s++) M.frame(setup, { mclock: s, half: 1, players: at(s) });
    for (let s = 0; s < 10; s++) M.frame(setup, { mclock: s, half: 1, players: at(s) });   // back to 0:00 in the first half
    return M.samples;
  }, { setup: SETUP, roster: ROSTER, names: NAMES });
  expect(samples).toBe(10);
  expect(errs).toEqual([]);
});
