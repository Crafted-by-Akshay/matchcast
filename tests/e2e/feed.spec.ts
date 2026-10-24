import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, stepSim, viewFrame } from './helpers';

// Experience lane, continuous commentary feed (apps/unified/feed.js, embed/feed.js): a seeded Watch match keeps a line on screen,
// Broadcast draws the same feed, Ask counts from the event log, and a talk order always gets a reply in the chat.
declare const post: (view: string, msg: unknown) => void; // top-level function of the shell
declare const AG: any;

async function openWatch(page: Page, query = '?seed=2026&speed=4'): Promise<Frame> {
  await openShell(page, 'watch', query);
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && document.getElementById('load')!.hidden)).catch(() => false), { timeout: 240_000, message: 'Watch never finished loading' }).toBe(true);
  return f;
}

test('Watch keeps a commentary line on screen while the match runs', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await openWatch(page);
  // the match clock runs on the sim's own steps, so the test drives it the way the other Watch specs do
  for (let i = 0; i < 60 && (await f.evaluate(() => (window as any).MCFeed.shown)) < 4; i++) await stepSim(f, 3000);
  expect(await f.evaluate(() => (window as any).MCFeed.shown), 'the feed showed at least four lines').toBeGreaterThanOrEqual(4);
  const top = await f.evaluate(() => (window as any).MCFeed.top);
  expect(top.length, 'the newest line is shown beside the match').toBeGreaterThan(10);
  await f.click('#mcf-tog');
  const rows = await f.locator('#mcf-list li').allTextContents();
  expect(rows.some((t) => /Rules/.test(t)), 'each line says it was written by the rules, checked in page').toBe(true);
  expect(rows.some((t) => /Producer › Analyst › Narrator › Verifier/.test(t)), 'each line names the agents that made it').toBe(true);
  expect(rows.some((t) => /^\d+'/.test(t)), 'each line has a match minute').toBe(true);
  expect(errs, 'no page errors').toEqual([]);
});

test('Ask counts from the event log and says so', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await openWatch(page);
  for (let i = 0; i < 60 && (await page.evaluate(() => AG.run && AG.run.events.some((e: any) => e.type === 'pass' && e.player))) !== true; i++) await stepSim(f, 3000);
  // a shell-side check of the rules answerer on the run the Watch match is writing
  const answer = await page.evaluate(() => {
    const ev = AG.run.events.find((e: any) => e.type === 'pass' && e.player);
    return ev ? AG.ask('how many passes has ' + ev.player + ' made?') : null;
  });
  expect(answer, 'a pass has been logged').not.toBeNull();
  expect(answer.verdict).toBe('verified');
  expect(answer.text).toMatch(/has \d+ pass(es)? by \d+'/);
  expect(answer.citations.length).toBeGreaterThan(0);
  // "scored" is a goal count, and a word that only contains a count word ("goalkeeper") is not one
  const player = await page.evaluate(() => AG.run.events.find((e: any) => e.type === 'pass' && e.player).player);
  const scored = await page.evaluate((n) => AG.ask('how many goals has ' + n + ' scored?'), player);
  expect(scored.text).toMatch(/has \d+ goals? by \d+'/);
  const keeper = await page.evaluate(() => AG.ask('who is the goalkeeper for ' + AG.run.names.home + '?'));
  expect(keeper.verdict).toBe('abstained');
});

test('Broadcast draws the same feed', async ({ page }) => {
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await expect.poll(() => f.evaluate(() => !!document.getElementById('mcf')), { timeout: 240_000 }).toBe(true);
  await page.evaluate(() => post('broadcast', { src: 'matchcast-shell', type: 'feed-lines', items: [
    { id: 'l1', minute: 3, text: 'Shot for Thames Rovers. xG 0.12.', kind: 'shot', tone: '', source: 'rules', label: 'Rules · recounted', chain: ['Producer', 'Analyst', 'Narrator', 'Verifier'] },
    { id: 'l2', minute: 4, text: 'GOAL! A header from the corner.', kind: 'goal', tone: 'big', source: 'live', label: 'Live agents · verified', chain: ['Producer', 'Analyst', 'Narrator', 'Verifier', 'Live agents'] },
  ] }));
  await expect(f.locator('#mcf-top')).toContainText('GOAL! A header from the corner.');
  await f.click('#mcf-tog');
  await expect(f.locator('#mcf-list li')).toHaveCount(2);
  await expect(f.locator('#mcf-list li.big')).toContainText('Live agents');
});

test('a talk order always gets a reply in the chat, checked or not', async ({ page }) => {
  test.setTimeout(300_000);
  const f = await openWatch(page);
  const name = await f.evaluate(() => (window as any).__mc.players[0].name);
  await f.evaluate((p) => (window as any).mcTalkApi({ name: p }, 'press higher'), name);
  // no agent api in this test: the reply is the honest one, not silence
  await expect.poll(() => f.evaluate(() => document.documentElement.textContent!.includes('No checked answer yet')), { timeout: 20_000 }).toBe(true);
});
