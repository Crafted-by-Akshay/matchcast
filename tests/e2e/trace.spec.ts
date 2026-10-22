import { test, expect } from '@playwright/test';
import { collectErrors, openShell } from './helpers';

// EXP-6: the trace panel. The shell is driven the way Watch drives it (a start and a batch of events), as in connection.spec.ts.
declare const AG: any; declare const TP: any;

test('trace panel: four agents in order with durations, tools, and the seeded bad claim repaired', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.evaluate(() => {
    const key = 'k1', names = { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' };
    AG.reset(key, names);
    AG.onWatch(key, [{ minute: 10.1, type: 'goal', team: 'ars', player: 'A One', score: '1-0', data: {} }], []);   // a normal goal
    AG.seedBad(true);
    AG.onWatch(key, [{ minute: 20.2, type: 'goal', team: 'che', player: 'C One', score: '1-1', data: {} }], []);   // the next score claim is stated wrongly
  });
  await expect.poll(() => page.evaluate(() => AG.run.claims.filter((c: any) => c.kind === 'score' && c.verdict === 'verified').length)).toBe(2);

  // a normal line: all four agents in order, durations, the Analyst's tools
  const good = await page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.kind === 'score' && !x.seeded); TP.open(c.id); return { steps: TP.steps(c) }; });
  expect(good.steps.map((s: string) => s.split(':')[0])).toEqual(['producer', 'analyst', 'narrator', 'verifier', 'producer', 'producer']);
  const rows = page.locator('#tp li');
  await expect(rows).toHaveCount(6);
  await expect(page.locator('#tp li[data-agent="analyst"]')).toContainText('event_log.goals');
  for (const t of await rows.locator('span.m').allTextContents()) expect(t).toMatch(/ms/);
  await page.keyboard.press('Escape');
  // the Provenance button opens it too (not only TP.open)
  await page.click('#ag-claims tr[data-id]');
  await page.click('#ag-prov .ag-how');
  await expect(page.locator('#tp')).toBeVisible();
  await page.keyboard.press('Escape');
  // the seed switch clears once the seeded claim has been used
  await expect(page.locator('#ag-bad')).not.toBeChecked();

  // the seeded bad claim: rejection reason and the repair step
  await page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.seeded); TP.open(c.id); });
  await expect(page.locator('#tp li[data-step="repair"]')).toContainText('differed from the event log');
  await expect(page.locator('#tp li[data-step="repair"]')).toContainText('was');
  await expect(page.locator('#tp')).toContainText('repaired once');
  expect(errs).toEqual([]);
});
