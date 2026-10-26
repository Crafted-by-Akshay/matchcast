import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, stepSim, viewFrame } from './helpers';

// AB#501, the analysis views' input: Watch sends each match event with `attack_x` (105 or 0), the goal its player's side attacks at that moment,
// so the shell can tell which half a team is pressing in from the events alone. Null when the event has no player.
declare const AG: any;

async function openWatch(page: Page, query = '?seed=2026&speed=4'): Promise<Frame> {
  await openShell(page, 'watch', query);
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && document.getElementById('load')!.hidden)).catch(() => false), { timeout: 240_000, message: 'Watch never finished loading' }).toBe(true);
  return f;
}

test('every Watch event with a player carries the goal its side attacks, and the sides attack opposite goals', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await openWatch(page);
  for (let i = 0; i < 80 && (await page.evaluate(() => AG.run && AG.run.events.some((e: any) => e.type === 'pass' && e.player))) !== true; i++) await stepSim(f, 3000);
  const seen = await page.evaluate(() => AG.run.events.filter((e: any) => e.player).map((e: any) => ({ team: e.team, player: e.player, attack: e.data.attack_x })));
  expect(seen.length, 'the match has events with a player').toBeGreaterThan(0);
  for (const e of seen) expect([105, 0], `${e.player} carries attack_x 105 or 0`).toContain(e.attack);
  // the two sides attack opposite goals in the same minute
  const byMinute = new Map<number, Map<string, number>>();
  for (const e of await page.evaluate(() => AG.run.events.filter((x: any) => x.player).map((x: any) => ({ minute: x.minute, team: x.team, attack: x.data.attack_x })))) {
    const m = byMinute.get(e.minute) || new Map<string, number>();
    m.set(e.team, e.attack);
    byMinute.set(e.minute, m);
  }
  const both = [...byMinute.values()].filter((m) => m.size === 2);
  expect(both.length, 'some minute has events from both sides').toBeGreaterThan(0);
  for (const m of both) expect(new Set(m.values()).size, 'the two sides attack opposite goals').toBe(2);
  expect(errs).toEqual([]);
});
