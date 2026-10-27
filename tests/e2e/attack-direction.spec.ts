import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, stepSim, viewFrame } from './helpers';

// AB#501, the analysis views' input: Watch sends each match event with `attack_x` (105 or 0), the goal its side attacks at that moment,
// so the shell can tell which half a team is pressing in from the events alone. Null when the event has no player.
// The sides swap ends at half time, so each side's value flips at the half_time event.
declare const AG: any;

async function openWatch(page: Page, query = '?seed=2026&speed=4'): Promise<Frame> {
  await openShell(page, 'watch', query);
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && document.getElementById('load')!.hidden)).catch(() => false), { timeout: 240_000, message: 'Watch never finished loading' }).toBe(true);
  return f;
}

// steps the match, 2.5 simulated minutes at a time (3000 steps of 0.05 s), until the condition holds or the steps run out
async function stepUntil(f: Frame, done: () => Promise<boolean>, max: number) {
  for (let i = 0; i < max && !(await done()); i++) await stepSim(f, 3000);
}

const eventsOf = (page: Page) => page.evaluate(() => AG.run.events.map((e: any) => ({ minute: e.minute, type: e.type, team: e.team, player: e.player, attack: e.data.attack_x })));

test('every Watch event with a player carries the goal its side attacks, and the sides attack opposite goals', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await openWatch(page);
  await stepUntil(f, () => page.evaluate(() => !!AG.run && AG.run.events.some((e: any) => e.type === 'pass' && e.player)), 80);
  const evs = await eventsOf(page);
  const withPlayer = evs.filter((e) => e.player);
  expect(withPlayer.length, 'the match has events with a player').toBeGreaterThan(0);
  for (const e of withPlayer) expect([105, 0], `${e.player} carries attack_x 105 or 0`).toContain(e.attack);
  // the two sides attack opposite goals in the same minute
  const byMinute = new Map<number, Map<string, number>>();
  for (const e of withPlayer) {
    const m = byMinute.get(e.minute) || new Map<string, number>();
    m.set(e.team, e.attack);
    byMinute.set(e.minute, m);
  }
  const both = [...byMinute.values()].filter((m) => m.size === 2);
  expect(both.length, 'some minute has events from both sides').toBeGreaterThan(0);
  for (const m of both) expect(new Set(m.values()).size, 'the two sides attack opposite goals').toBe(2);
  expect(errs).toEqual([]);
});

test('each side swaps its goal at half time, and an event with no player carries null', async ({ page }) => {
  test.setTimeout(600_000);
  const f = await openWatch(page);
  // half time, and then a player's event after it, so both halves have events to compare
  await stepUntil(f, () => page.evaluate(() => {
    const ht = !!AG.run && AG.run.events.find((e: any) => e.type === 'half_time');
    return !!ht && AG.run.events.some((e: any) => e.player && e.minute > ht.minute);
  }), 120);
  const evs = await eventsOf(page);
  const ht = evs.find((e) => e.type === 'half_time');
  expect(ht, 'the match reached half time').toBeTruthy();
  const withPlayer = evs.filter((e) => e.player);
  const before = withPlayer.filter((e) => e.minute < ht!.minute);
  const after = withPlayer.filter((e) => e.minute > ht!.minute);
  expect(before.length, 'events in the first half').toBeGreaterThan(0);
  expect(after.length, 'events in the second half').toBeGreaterThan(0);
  const teams = [...new Set(withPlayer.map((e) => e.team))];
  expect(teams.length, 'two sides').toBe(2);
  for (const t of teams) {
    const first = new Set(before.filter((e) => e.team === t).map((e) => e.attack));
    const second = new Set(after.filter((e) => e.team === t).map((e) => e.attack));
    expect(first.size, `${t} keeps one goal in the first half`).toBe(1);
    expect(second.size, `${t} keeps one goal in the second half`).toBe(1);
    expect([...second][0], `${t} attacks the other goal after half time`).not.toBe([...first][0]);
  }
  const bare = evs.filter((e) => !e.player);
  expect(bare.length, 'the match has events with no player').toBeGreaterThan(0);
  // a no-player event that names a team, so the player check in attackOf is what makes it null (half_time alone names no team)
  expect(bare.some((e) => e.team), 'a no-player event that names a team').toBe(true);
  for (const e of bare) expect(e.attack, `${e.type} with no player carries null`).toBeNull();
});
