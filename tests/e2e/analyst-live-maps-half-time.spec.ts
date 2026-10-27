import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// The Analyst console's Live maps (77_live.js) keep the first half when the second half starts, as the compact live view does
// (maps.js). Watch's clock goes back to 45:00 at half-time, which must not clear the samples.
async function openLive(page: Page) {
  await openShell(page, 'analyst', '?crew=0');
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  return f;
}

test('analyst live maps page: the second half adds to the first half when the clock goes back to 45:00', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openLive(page);
  await f.evaluate(() => {
    const setup = { h: 'ARG', a: 'BRA', seed: 2026, st: 4, month: 7, kick: '17:00', half: 15 };
    const names = Array.from({ length: 22 }, (_, i) => 'P' + i);
    const roster = { teams: ['ARG', 'BRA'], players: names.map((n, i) => ({ name: n, team: i < 11 ? 'ARG' : 'BRA' })) };
    const post = (m: object) => window.postMessage(Object.assign({ src: 'matchcast-shell' }, m), '*');
    const at = (s: number) => names.map((_, i) => [(i * 4 + s * 0.4) % 105, 10 + (i * 3) % 50, 0, 0, 0, 0]);
    post({ type: 'live-start', setup, roster });
    for (let s = 2600; s < 2880; s++) post({ type: 'live-frame', setup, frame: { mclock: s, half: 1, players: at(s) } });
    for (let s = 2700; s < 2760; s++) post({ type: 'live-frame', setup, frame: { mclock: s, half: 2, players: at(s) } });
    (window as any).go('live-maps');
  });
  // 280 first-half samples and 60 second-half samples; before the fix the second half cleared the first
  await expect.poll(() => f.evaluate('LIVE.frames.length')).toBe(280 + 60);
  await expect(f.locator('#lv-body')).toContainText('Live from Watch');
  await expect(f.locator('#lv-body svg')).toHaveCount(6, { timeout: 30_000 });
  expect(errs).toEqual([]);
});
