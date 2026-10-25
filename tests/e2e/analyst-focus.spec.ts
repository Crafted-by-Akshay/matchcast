import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// Focused Analyst mode: five entries for the judge path (This match), the rest under More. Pages that are not in the nav keep their code and open by route.
async function openPage(page: Page, route = 'live') {
  await openShell(page, 'analyst');
  const f = await viewFrame(page, 'analyst');
  await f.waitForFunction(() => typeof D !== 'undefined' && D.matches.length > 0, null, { timeout: 120_000 });
  await f.evaluate((r) => (window as any).go(r), route);
  return f;
}

test('analyst focus: five entries under This match, the rest under More', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page);
  // the nav ends with a Data footer (league and store status), which is not a page group
  expect((await f.locator('#nav .ng').allTextContents()).slice(0, 2)).toEqual(['This match', 'More']);
  const ids = await f.locator('#nav .ni').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.p));
  expect(ids.slice(0, 5)).toEqual(['live', 'match', 'ask', 'trace', 'library']);
  expect(ids).not.toContain('ds-query');
  expect(ids).not.toContain('api');
  expect(errs).toEqual([]);
});

test('analyst focus: hidden pages keep their code and open by route', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'ds-query');
  await expect(f.locator('h1')).toHaveText('Query workbench');
  expect(errs).toEqual([]);
});

test('analyst focus: the match centre has five tabs', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'match');
  expect(await f.locator('.tabs [role=tab]').allTextContents()).toEqual(['Overview', 'Shots', 'Patterns', 'Players', 'Verifier']);
  expect(errs).toEqual([]);
});

test('analyst focus: the live page explains its stats in plain words', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'live');
  await expect(f.locator('#live-stats')).toContainText('Expected goals (xG)');
  await expect(f.locator('#live-stats')).toContainText('PPDA');
  await expect(f.locator('#live-source')).toContainText('Simulated');
  await expect(f.locator('#live-recorded'), 'with the feed off the page says it is a recorded match, not live').toContainText('Recorded match · not live');
  expect(errs).toEqual([]);
});

test('analyst focus: a question from Analyst is answered by the shell and marked', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'ask');
  await f.locator('#ask-q').fill('What was the score?');
  await f.locator('#ask-go').click();
  await expect(f.locator('#ask-out')).toHaveAttribute('data-state', 'answered', { timeout: 20_000 });
  await expect(f.locator('#ask-out')).not.toBeEmpty();
  expect(errs).toEqual([]);
});

test('analyst focus: How was this made lists each agent insight with its Verifier verdict', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'trace');
  await expect(f.locator('h1')).toHaveText('How was this made?');
  await expect(f.locator('#trace-list')).toBeVisible();
  expect(errs).toEqual([]);
});

test('analyst focus: with the live feed on, a stat Watch has not sent shows a dash, never a season figure', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'live');
  await f.evaluate((fx) => {
    (window as any).MC_FEED = { on: true, fixture: fx, score: [1, 0], minute: 12, over: false, last: [], stats: null };
    (window as any).mcLiveRefresh();
  }, await f.evaluate(() => D.matches[0].id));
  await expect(f.locator('#live-source')).toContainText('Live from Watch');
  await expect(f.locator('#live-recorded'), 'no recorded-match label while Watch feeds the page').toHaveCount(0);
  expect(await f.locator('#live-stats dt b').allTextContents()).toEqual(['– – –', '– – –', '– – –', '– – –', '–']);
  // full time: PPDA is still the recorded run's figure, so it stays a dash while the feed is on
  await f.evaluate(() => { (window as any).MC_FEED.over = true; (window as any).mcLiveRefresh(); });
  expect(await f.locator('#live-stats dt b').last().textContent()).toBe('–');
  expect(errs).toEqual([]);
});

test('analyst focus: a live feed for a custom setup shows only the live score and events', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'live');
  await f.evaluate(() => {
    (window as any).MC_FEED = { on: true, score: [2, 1], minute: 30, over: false, last: [], stats: null };
    (window as any).mcLiveRefresh();
  });
  await expect(f.locator('h1')).toHaveText('Live match');
  await expect(f.locator('#live-stats')).toHaveCount(0);
  await expect(f.locator('#pg')).toContainText('2–1');
  await expect(f.locator('#pg')).toContainText('Last five events');
  await expect(f.locator('#pg')).not.toContainText('Expected goals');
  await expect(f.locator('#live-source')).toContainText('Live from Watch');
  expect(errs).toEqual([]);
});

test('analyst focus: a partial stats object shows the stats Watch sent and dashes for the rest', async ({ page }) => {
  const errs = collectErrors(page);
  const f = await openPage(page, 'live');
  await f.evaluate((fx) => {
    (window as any).MC_FEED = { on: true, fixture: fx, score: [1, 0], minute: 12, over: false, last: [], stats: { xg: [1.2, 0.4] } };
    (window as any).mcLiveRefresh();
  }, await f.evaluate(() => D.matches[0].id));
  expect(await f.locator('#live-stats dt b').allTextContents()).toEqual(['1.20 – 0.40', '– – –', '– – –', '– – –', '–']);
  expect(errs).toEqual([]);
});
