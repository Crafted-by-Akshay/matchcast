import { test, expect } from '@playwright/test';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// EXP-7 and EXP-11: approval queue in the Agents tab, lower-third and teleprompter in Broadcast.
declare const AG: any, MCC: any;

const seed = (page) => page.evaluate(() => {
  AG.reset('k1', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' });
  AG.onWatch('k1', [{ minute: 10.1, type: 'goal', team: 'ars', player: 'A One', score: '1-0', data: {} }], []);
});

test('approval queue: approve, wrong-number edit rejected, kill never airs, audit has the name', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.selectOption('#aq-mode', 'producer');
  await seed(page);
  const item = page.locator('#aq-list li[data-id]');
  await expect.poll(() => item.count()).toBe(1);
  // a queued line is in no view
  expect(await page.evaluate(() => (AG.run.claims.find((c: any) => c.kind === 'score') || {}).approval)).toBe('pending');
  // an edit with a number that is not in the verified line is rejected
  const bad = await page.evaluate(() => AG.edit(AG.run.claims[0].id, 'Sam', 'Goal for Arsenal, 5–0 at 10\'.'));
  expect(bad.ok).toBe(false);
  expect(bad.reason).toContain('not aired');
  // approve
  await item.locator('button[data-act="approve"]').click();
  await expect(page.locator('#aq-list li[data-id]')).toHaveCount(0);
  const acts = await page.evaluate(() => MCC.records().map((r: any) => r.action + ':' + ((r.detail || {}).by || '')));
  expect(acts.some((a: string) => a.startsWith('line_approved:Sam Producer'))).toBe(true);
  // a second line, killed
  await page.evaluate(() => AG.onWatch('k1', [{ minute: 20.2, type: 'goal', team: 'che', player: 'C One', score: '1-1', data: {} }], []));
  await expect.poll(() => item.count()).toBe(1);
  await item.locator('button[data-act="kill"]').click();
  const st = await page.evaluate(() => AG.run.claims.map((c: any) => c.approval));
  expect(st).toContain('killed');
  expect(errs).toEqual([]);
});

test('lower-third waits for approval in producer mode and airs at once in demo mode', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.click('#tab-broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await page.click('#tab-agents');
  await page.selectOption('#aq-mode', 'producer');
  await seed(page);
  await expect.poll(() => page.locator('#aq-list li[data-id]').count()).toBe(1);
  expect(await bc.evaluate(() => !(document.getElementById('mc-l3') as HTMLElement).hidden)).toBe(false);
  await page.click('#aq-list button[data-act="approve"]');
  await expect.poll(() => bc.evaluate(() => !(document.getElementById('mc-l3') as HTMLElement).hidden), { timeout: 1000 }).toBe(true);
  await expect(bc.locator('#mc-tele li')).toHaveCount(1);
  // demo mode
  await page.selectOption('#aq-mode', 'demo');
  await page.evaluate(() => AG.onWatch('k1', [{ minute: 30.3, type: 'goal', team: 'ars', player: 'A Two', score: '2-1', data: {} }], []));
  await expect(bc.locator('#mc-tele li')).toHaveCount(2, { timeout: 1000 });
  expect(errs).toEqual([]);
});

test('wild moment: a red card alerts in Broadcast within 3 s with a verified line', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.click('#tab-broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await page.click('#tab-agents');
  await page.evaluate(() => {
    AG.reset('k1', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' });
    AG.onWatch('k1', [], [{ id: 'm1', minute: 55, type: 'red_card', title: 'Red card for C One', why: 'Chelsea down to ten men at 55\'.' }]);
  });
  await expect(bc.locator('#mc-l3')).toContainText('ALERT · Red card · verified', { timeout: 3000 });
  expect(errs).toEqual([]);
});
