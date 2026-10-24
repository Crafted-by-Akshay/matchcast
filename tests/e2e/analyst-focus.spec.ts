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
