import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// Analyst "Live maps": the shell forwards Watch's roster, pitch frames and events to the Analyst page. This feeds a short
// synthetic stretch of the same message shapes and checks that the maps, the pass network and the player picker draw from it.
async function openLive(page: Page) {
  await openShell(page, 'analyst', '?crew=0');
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  return f;
}

test('analyst live maps: the shell messages draw the heatmaps, pass network and player picker', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openLive(page);
  await f.evaluate(() => {
    const setup = { h: 'ARG', a: 'BRA', seed: 2026, st: 4, month: 7, kick: '17:00', half: 15 };
    const names = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10', 'B11'];
    const roster = { teams: ['ARG', 'BRA'], players: names.map((n, i) => ({ name: n, team: i < 11 ? 'ARG' : 'BRA' })) };
    const post = (m: object) => window.postMessage(Object.assign({ src: 'matchcast-shell' }, m), '*');
    post({ type: 'live-start', setup, roster });
    for (let s = 0; s < 120; s++) {
      const players = names.map((_, i) => [(i * 4 + s * 0.3) % 105, 10 + (i * 3) % 50, 0, 0, 0, 0]);
      post({ type: 'live-frame', setup, frame: { mclock: s, half: 1, players } });
    }
    post({ type: 'live-batch', setup, batch: [
      { simT: 1, type: 'pass', minute: 1, team: 'ARG', player: 'A2', to: 'A3' },
      { simT: 2, type: 'pass', minute: 1, team: 'ARG', player: 'A3', to: 'A2' },
      { simT: 3, type: 'pass', minute: 1, team: 'ARG', player: 'A2', to: 'A3' },
      { simT: 4, type: 'pass', minute: 1, team: 'BRA', player: 'B2', to: 'B3' },
    ] });
    (window as any).go('live-maps');
  });
  await expect(f.locator('#lv-body')).toContainText('Live from Watch');
  await expect(f.locator('#lv-body svg')).toHaveCount(6, { timeout: 30_000 });   // two heatmaps, average positions, two networks, player heatmap
  const before = await f.locator('#lv-player h4').textContent();
  await f.locator('#lv-sel').selectOption({ index: 5 });
  await expect(f.locator('#lv-player h4')).not.toHaveText(before ?? '');
  expect(errs).toEqual([]);
});
