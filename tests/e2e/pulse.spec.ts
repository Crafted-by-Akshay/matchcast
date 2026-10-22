import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// Ported from apps/unified/tests/watch.cjs (EXP-3 Match Pulse, EXP-4 watch modes).
// Cards are posted to Watch the way the shell does; only the DOM is checked.
declare const post: (view: string, msg: unknown) => void; // top-level function of the shell

const goal = (id: string, extra: object = {}) => ({ id, minute: 12.4, kind: 'score', text: "Goal for Thames Rovers (A One) at 12'. Thames Rovers 1–0 Coloso Ciudad.", plain: 'Goal for Thames Rovers!', verdict: 'verified', source: 'model', player: null, chips: ['Score 1–0', "12'"], evidence: [{ minute: 12.4, type: 'goal', player: 'A One', team: 'thr', xg: null }], ...extra });

async function openWatch(page: Page): Promise<Frame> {
  await openShell(page, 'watch');
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && (window as any).__mcxCards && document.getElementById('load')!.hidden)).catch(() => false), { timeout: 240_000, message: 'Watch never finished loading' }).toBe(true);
  return f;
}
const send = (page: Page, card: object) => page.evaluate((c) => post('watch', { src: 'matchcast-shell', type: 'pulse', card: c }), card);
async function pick(f: Frame, mode: string) {
  if (await f.evaluate(() => (document.getElementById('fan-pop') as HTMLElement).hidden)) await f.click('#fan-chip');
  await f.click(`.fm-b[data-m="${mode}"]`);
}

test('Match Pulse cards and watch modes', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  let f = await openWatch(page);
  const card = () => f.evaluate(() => { const c = document.querySelector('#mcx-live .mcx-c')!; return { text: c.querySelector('p')!.textContent, tick: c.querySelector('.mcx-t')!.textContent, chips: c.querySelectorAll('.mcx-ch:not(.fb)').length, fb: !!c.querySelector('.mcx-ch.fb'), wait: !!c.querySelector('.mcx-t.wait') }; });

  await pick(f, 'analyst');
  await send(page, goal('c1'));
  await expect(f.locator('#mcx-live .mcx-c .mcx-t')).toContainText(/Verified/, { timeout: 1000 });
  const analyst = await card();
  expect(analyst.chips, 'Analyst shows at least two metric chips').toBeGreaterThanOrEqual(2);
  expect(analyst.fb, 'a model claim has no Rules fallback chip').toBe(false);

  await send(page, goal('c2', { source: 'rules', verdict: 'pending' }));
  await expect(f.locator('#mcx-live .mcx-c .mcx-ch.fb')).toBeVisible();
  expect((await card()).wait, 'an unverified card shows the amber dot').toBe(true);
  await f.evaluate(() => (document.querySelector('#mcx-live .mcx-c [data-why]') as HTMLElement).click());
  await expect(f.locator('#mcx-live .mcx-w:not([hidden])')).toContainText(/goal/);

  for (let i = 0; i < 12; i++) await send(page, goal('k' + i));
  await expect(f.locator('#mcx-log .mcx-c')).toHaveCount(10);
  await f.evaluate(() => document.querySelectorAll('#mcx-live .mcx-c').forEach((el) => el.classList.add('out')));

  await pick(f, 'casual');
  await send(page, goal('c3'));
  await expect.poll(async () => (await card()).text).not.toBe(analyst.text);
  expect((await card()).chips, 'Casual shows no metric chips').toBe(0);

  await pick(f, 'player');
  const who = await f.evaluate(() => (window as any).__mc.players.map((q: any) => q.name).find((n: string) => document.getElementById('fan-pcard')!.textContent!.includes(n)) ?? null);
  expect(who, 'Player focus names a player in the mode card').not.toBeNull();
  await send(page, goal('c4', { player: who }));
  await expect.poll(async () => (await card()).text, { message: 'Player focus leads with the player' }).toMatch(new RegExp('^' + who + ':'));

  await pick(f, 'club');
  expect(await f.evaluate(() => JSON.parse(localStorage.getItem('mcx-mode')!).mode)).toBe('club');
  f = await openWatch(page);
  await expect(f.locator('#fan-chip')).toContainText(/My club/);
  if (await f.evaluate(() => (document.getElementById('fan-pop') as HTMLElement).hidden)) await f.click('#fan-chip');
  expect(await f.evaluate(() => [...document.querySelectorAll<HTMLElement>('.fm-l')].every((l) => ['en', 'es', 'hi'].includes(l.dataset.l!) !== !!l.querySelector('.fm-planned'))), 'languages beyond English, Spanish and Hindi are labelled Planned').toBe(true);
  expect(errs).toEqual([]);
});
