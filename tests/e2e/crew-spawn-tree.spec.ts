import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';

// CREW-6.1 (AB#439): the live spawn tree, behind ?crew=1. Data is CREW.state only.
declare const CREW: any;

async function open(page: any, query = '?crew=1') {
  await page.route(/\/(watch|broadcast)\/index\.html/, (r: any) => r.abort());
  await openShell(page, 'agents', query);
}

test('crew tree: absent without the flag', async ({ page }) => {
  await open(page, '');
  await expect(page.locator('#crew-tree')).toHaveCount(0);
});

test('crew tree: Showrunner fans out, labelled goal 23\' and routed by rules, then fades when done', async ({ page }) => {
  const errs = collectErrors(page);
  await open(page);
  const sec = page.locator('#crew-tree');
  await expect(sec).toBeVisible();
  await expect(sec.getByRole('heading', { name: 'Crew' })).toBeVisible();
  await expect(sec).toContainText('Simulated');
  await expect(sec).toContainText('No moment yet');
  await page.evaluate(() => {
    CREW.ingest({ kind: 'moment', id: 'm-23', data: { minute: 23, why: 'goal', routed_by: 'rules', status: 'open' } });
    CREW.ingest({ kind: 'spawn', moment: 'm-23', agent: { id: 'm-23:show', role: 'Showrunner', parent: null } });
  });
  await expect(sec.locator('#ct-label')).toHaveText("goal, 23'");
  await expect(sec.locator('#ct-routed')).toContainText('routed by rules');
  await expect(sec.locator('[data-agent-id="m-23:show"]')).toHaveAttribute('data-status', 'running');
  await expect(sec.locator('[data-agent-id]')).toHaveCount(1);
  await expect(sec.locator('[aria-live="polite"]')).toHaveCount(1);
  await page.evaluate(() => {
    CREW.ingest({ kind: 'spawn', moment: 'm-23', agent: { id: 'm-23:an', role: 'Analyst', parent: 'm-23:show' } });
    CREW.ingest({ kind: 'spawn', moment: 'm-23', agent: { id: 'm-23:st', role: 'Stats Researcher', parent: 'm-23:show' } });
  });
  await expect(sec.locator('[data-agent-id]')).toHaveCount(3);
  await expect(sec.locator('[data-agent-id="m-23:an"]')).toHaveAttribute('data-parent', 'm-23:show');
  await expect(sec.locator('#ct-announce')).toContainText('Stats Researcher');
  await page.evaluate(() => CREW.ingest({ kind: 'spawn', moment: 'm-23', agent: { id: 'm-23:an', status: 'done' } }));
  await expect(sec.locator('[data-agent-id="m-23:an"]')).toHaveAttribute('data-status', 'done');
  await page.evaluate(() => CREW.ingest({ kind: 'moment', id: 'm-23', data: { status: 'done' } }));
  await expect(sec.locator('#ct-tree')).toHaveAttribute('data-done', 'true');
  expect(errs).toEqual([]);
});

test('crew tree: the latest moment replaces the previous one; model routing is labelled', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    CREW.ingest({ kind: 'moment', id: 'a', data: { minute: 10, why: 'goal', routed_by: 'rules', status: 'done' } });
    CREW.ingest({ kind: 'moment', id: 'b', data: { minute: 55, why: 'red card', routed_by: 'model', status: 'open' } });
    CREW.ingest({ kind: 'spawn', moment: 'b', agent: { id: 'b:show', role: 'Showrunner', parent: null } });
  });
  await expect(page.locator('#ct-label')).toHaveText("red card, 55'");
  await expect(page.locator('#ct-routed')).toContainText('routed by model');
  await expect(page.locator('#crew-tree [data-agent-id]')).toHaveCount(1);
});

test('crew tree: Play Simulated goal fills the tree; 320 px does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  await page.getByRole('button', { name: 'Play Simulated goal' }).click();
  await expect(page.locator('#crew-tree [data-agent-id]')).toHaveCount(6, { timeout: 15_000 });
  await expect(page.locator('#ct-tree')).toHaveAttribute('data-done', 'true', { timeout: 15_000 });
  const over = await page.evaluate(() => { const e = document.getElementById('v-agents')!; return [e.scrollWidth - e.clientWidth, document.documentElement.scrollWidth - document.documentElement.clientWidth]; });
  expect(over[0]).toBeLessThanOrEqual(0);
  expect(over[1]).toBeLessThanOrEqual(0);
});

test('crew tree: reduced motion turns the bloom off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.evaluate(() => CREW.ingest({ kind: 'spawn', moment: 'r', agent: { id: 'r:show', role: 'Showrunner', parent: null } }));
  const name = await page.locator('#crew-tree [data-agent-id]').first().evaluate((e) => getComputedStyle(e).animationName);
  expect(name).toBe('none');
});
