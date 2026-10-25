import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';

// EXP-6 follow-up: the Agents tab shows how the agents work, live. Its status comes from the api (not hard-coded text),
// each line is listed once in the Live flow, and every claim shows its handoffs (agent, step, model or rules, timing).
declare const AG: any; declare const LV: any;
// the PR checks run the local build with no api; a live URL has an api, so these checks do not apply there
test.skip(!!process.env.E2E_BASE_URL, 'PR checks only: a live deployment has an agent api');

const names = { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' };

test('the Agents tab states the agent mode honestly when no api is configured', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  // the Foundry chip comes from /v1/status (paintFoundry); with no api it says so, and the cards name the rules run
  await expect(page.locator('#ag-foundry')).toHaveText('Foundry: not connected');
  await expect(page.locator('#ag-cards .ag-card').first()).toContainText('Rules · simulated');
  expect(errs).toEqual([]);
});

test('the Live flow lists the rules pipeline for a goal, and each handoff shows in the orchestration view', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.evaluate((n) => {
    AG.reset('orch-1', n);
    AG.onWatch('orch-1', [{ minute: 10.1, type: 'goal', team: 'thr', player: 'A One', score: '1-0', data: {} }], []);
  }, names);
  const lane = page.locator('#ag-lanes > li').first();
  await expect(lane).toBeVisible();
  for (const agent of ['producer', 'analyst', 'narrator', 'verifier']) {
    await expect(lane.locator('[data-agent="' + agent + '"]').first()).toBeVisible();
  }
  // the four handoffs come in order, each with its mode and its timing
  const order = await lane.locator('[data-agent]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.agent));
  expect(order.indexOf('analyst')).toBeLessThan(order.indexOf('narrator'));
  expect(order.indexOf('narrator')).toBeLessThan(order.indexOf('verifier'));
  await expect(lane.locator('[data-agent="analyst"]').first()).toContainText('rules');
  // a goal makes a score claim and, at the first five-minute mark, an xG total: both are shown and verified
  await expect(page.locator('#ag-orch-n')).toContainText(' verified · 0 held');
  expect(errs).toEqual([]);
});

test('a line from the api is written once in the Live flow, however many times the stream repeats it', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate((n) => {
    AG.reset('orch-2', n);
    AG.ingest({ claim_id: 'api-1', metric: 'goals', value: 1, units: 'goals', approval_status: 'approved' }, 'live');
    for (let i = 0; i < 6; i++) AG.ingest({ publication_id: 'pub-1', claim_ids: ['api-1'], text: 'Goal for Thames Rovers (A One) at 10\'. Thames Rovers 1–0 Coloso Ciudad.' }, 'live');
  }, names);
  const said = await page.evaluate(() => AG.run.feed.filter((f: any) => f.text.includes('Goal for Thames Rovers')).length);
  expect(said).toBe(1);
  await expect(page.locator('#ag-feed li', { hasText: 'Goal for Thames Rovers' })).toHaveCount(1);
});

test('an api claim shows the server handoffs, marked model, in the orchestration view', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate((n) => {
    AG.reset('orch-3', n);
    AG.ingest({ claim_id: 'api-2', metric: 'goals', value: 1, units: 'goals', approval_status: 'approved' }, 'live');
    AG.ingest({ publication_id: 'pub-2', claim_ids: ['api-2'], text: 'Goal for Thames Rovers.' }, 'live');
  }, names);
  const lane = page.locator('#ag-lanes > li').first();
  await expect(lane.locator('[data-agent="analyst"]').first()).toContainText('model');
  await expect(lane.locator('[data-agent="producer"]').first()).toContainText('publication');
  await expect(page.locator('#ag-prov')).toContainText('Model · live agent api');
});

test('the Agents tab fits a 390 px phone without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openShell(page, 'agents');
  await page.evaluate((n) => {
    AG.reset('orch-4', n);
    AG.onWatch('orch-4', [{ minute: 10.1, type: 'goal', team: 'thr', player: 'A One', score: '1-0', data: {} }], []);
  }, names);
  await expect(page.locator('#ag-lanes > li').first()).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(wide).toBeLessThanOrEqual(0);
});

test('the orchestration view says what Vision has sent, and that nothing reaches Azure without an api', async ({ page }) => {
  await openShell(page, 'agents');
  await expect(page.locator('#ag-vision')).toContainText('No api is configured');
  await expect(page.locator('#ag-vision')).toContainText('Vision runs in the browser');
  expect(await page.evaluate(() => LV.vision)).toEqual({ passes: 0, reads: 0, readsFailed: 0 });
});

test('a rejected line reaches its evidence claim before any publication exists', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate((n) => {
    AG.reset('orch-5', n);
    AG.ingest({ claim_id: 'api-3', metric: 'goals', value: 2, units: 'goals' }, 'live');
    AG.ingest({ line_id: 'L3', claim_ids: ['api-3'], status: 'drafted' }, 'live');
    AG.ingest({ line_id: 'L3', claim_ids: ['api-3'], status: 'rejected' }, 'live');
  }, names);
  const claim = await page.evaluate(() => AG.run.claims.find((c: any) => c.id === 'api-3'));
  expect(claim.verdict).toBe('abstained');
  const lane = page.locator('#ag-lanes > li').first();
  await expect(lane.locator('[data-agent="verifier"][data-step="rejected"]')).toBeVisible();
  await expect(page.locator('#ag-orch-n')).toContainText('1 held');
});
