import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';

// CREW-6.1 (AB#439): the live spawn tree, behind ?crew=1. Data is CREW.state only.
declare const CREW: any;

async function open(page: any, query = '?crew=1') {
  await page.route(/\/(watch|broadcast)\/index\.html/, (r: any) => r.abort());
  await openShell(page, 'agents', query);
}

test('crew tree: absent without the flag', async ({ page }) => {
  await open(page, '?crew=0');
  await expect(page.locator('#crew-tree')).toHaveCount(0);
  // the empty mount must not add a grid gap to the Agents tab
  const m = await page.evaluate(() => { const e = document.getElementById('crew-mount')!; return { display: getComputedStyle(e).display, h: e.getBoundingClientRect().height }; });
  expect(m.display).toBe('none');
  expect(m.h).toBe(0);
  const top = await page.evaluate(() => { const ag = document.querySelector('#v-agents .ag')!; return document.querySelector('#v-agents .ag-head')!.getBoundingClientRect().top - ag.getBoundingClientRect().top - parseFloat(getComputedStyle(ag).paddingTop); });
  expect(Math.round(top)).toBe(0);
});

test('crew tree: Showrunner fans out, labelled goal 23\' and routed by rules, then fades when done', async ({ page }) => {
  const errs = collectErrors(page);
  await open(page);
  const sec = page.locator('#crew-tree');
  await expect(sec).toBeVisible();
  await expect(sec.getByRole('heading', { name: 'Crew' })).toBeVisible();
  await expect(sec.locator('#ct-sim')).toBeHidden();   // nothing to label yet: the badge belongs to fixture data only
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
    CREW.ingest({ kind: 'spawn', moment: 'a', agent: { id: 'a:show', role: 'Showrunner', parent: null } });
    CREW.ingest({ kind: 'spawn', moment: 'a', agent: { id: 'a:an', role: 'Analyst', parent: 'a:show' } });
    CREW.ingest({ kind: 'moment', id: 'b', data: { minute: 55, why: 'red card', routed_by: 'model', status: 'open' } });
    CREW.ingest({ kind: 'spawn', moment: 'b', agent: { id: 'b:show', role: 'Showrunner', parent: null } });
  });
  await expect(page.locator('#ct-label')).toHaveText("red card, 55'");
  await expect(page.locator('#ct-routed')).toContainText('routed by model');
  await expect(page.locator('#crew-tree [data-agent-id]')).toHaveCount(1);
  await expect(page.locator('#crew-tree [data-agent-id="a:show"]')).toHaveCount(0);
  await expect(page.locator('#crew-tree [data-agent-id="a:an"]')).toHaveCount(0);
});

const ingest = (page: any, frames: any[]) => page.evaluate((fs: any[]) => fs.forEach((f) => CREW.ingest(f)), frames);
const sp = (moment: string, id: string, role: string, parent: string | null, status?: string) => ({ kind: 'spawn', moment, agent: status ? { id, role, parent, status } : { id, role, parent } });

test('crew tree: simulated badge is hidden once the data is not simulated', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { CREW.state.simulated = false; CREW.ingest({ kind: 'moment', id: 'x', data: { minute: 1, why: 'goal' } }); });
  await expect(page.locator('#ct-sim')).toBeHidden();
  await page.evaluate(() => { CREW.state.simulated = true; CREW.ingest({ kind: 'moment', id: 'x', data: {} }); });
  await expect(page.locator('#ct-sim')).toBeVisible();
});

test('crew tree: done state is visible text, announced, and marks running agents done', async ({ page }) => {
  await open(page);
  await ingest(page, [{ kind: 'moment', id: 'd', data: { minute: 5, why: 'goal', status: 'open' } }, sp('d', 'd:s', 'Showrunner', null), sp('d', 'd:a', 'Analyst', 'd:s')]);
  await expect(page.locator('#ct-state')).toHaveText('');
  await ingest(page, [{ kind: 'moment', id: 'd', data: { status: 'done' } }]);
  await expect(page.locator('#ct-state')).toHaveText('Moment done');
  await expect(page.locator('#ct-announce')).toContainText('Moment done');
  await expect(page.locator('#crew-tree [data-agent-id][data-status="done"]')).toHaveCount(2);
});

test('crew tree: failed and unknown statuses are labelled honestly', async ({ page }) => {
  await open(page);
  await ingest(page, [{ kind: 'moment', id: 'f', data: { minute: 9, why: 'goal', status: 'open' } }, sp('f', 'f:s', 'Showrunner', null), sp('f', 'f:h', 'History', 'f:s', 'failed'), sp('f', 'f:q', 'Replay', 'f:s', 'queued'), sp('f', 'f:z', 'Narrator', 'f:s', 'weird')]);
  await expect(page.locator('[data-agent-id="f:h"]')).toHaveAttribute('data-status', 'failed');
  await expect(page.locator('[data-agent-id="f:h"]')).toContainText('failed');
  await expect(page.locator('[data-agent-id="f:q"]')).toContainText('queued');
  await expect(page.locator('[data-agent-id="f:z"]')).toContainText('status: weird');
  await expect(page.locator('[data-agent-id="f:z"]')).not.toContainText('running');
  await expect(page.locator('#ct-announce')).toContainText('History failed');
});

test('crew tree: a child before its parent, a cycle and a self-parent do not break the tree', async ({ page }) => {
  const errs = collectErrors(page);
  await open(page);
  await ingest(page, [{ kind: 'moment', id: 'o', data: { minute: 3, why: 'goal', status: 'open' } },
    sp('o', 'o:kid', 'Analyst', 'o:s'), sp('o', 'o:a', 'Cyc A', 'o:b'), sp('o', 'o:b', 'Cyc B', 'o:a'), sp('o', 'o:me', 'Self', 'o:me')]);
  await expect(page.locator('#crew-tree [data-agent-id]')).toHaveCount(4);
  await ingest(page, [sp('o', 'o:s', 'Showrunner', null)]);
  await expect(page.locator('#crew-tree [data-agent-id]')).toHaveCount(5);
  expect(await page.locator('#crew-tree li:has(> .ct-node[data-agent-id="o:s"]) > ul > li > .ct-node').evaluateAll((e) => e.map((x) => x.getAttribute('data-agent-id')))).toEqual(['o:kid']);
  // cycle members and the self-parent hang at the top level
  expect(await page.locator('#ct-root > li > .ct-node').evaluateAll((e) => e.map((x) => x.getAttribute('data-agent-id')).sort())).toEqual(['o:a', 'o:b', 'o:me', 'o:s']);
  // no empty child lists
  expect(await page.locator('#crew-tree ul:empty').count()).toBe(0);
  expect(errs).toEqual([]);
});

test('crew tree: reset clears the tree and a replay of the same moment fans out again; double Play stays one tree', async ({ page }) => {
  await open(page);
  await ingest(page, [{ kind: 'moment', id: 'm-23', data: { minute: 23, why: 'goal', status: 'open' } }, sp('m-23', 'm-23:s', 'Showrunner', null), sp('m-23', 'm-23:a', 'Analyst', 'm-23:s')]);
  await expect(page.locator('#crew-tree [data-agent-id]')).toHaveCount(2);
  await page.evaluate(() => CREW.reset());
  await expect(page.locator('#crew-tree [data-agent-id]')).toHaveCount(0);
  await expect(page.locator('#ct-label')).toHaveText('');
  await expect(page.locator('#ct-empty')).toBeVisible();
  await ingest(page, [{ kind: 'moment', id: 'm-23', data: { minute: 23, why: 'goal', status: 'open' } }, sp('m-23', 'm-23:s', 'Showrunner', null), sp('m-23', 'm-23:a', 'Analyst', 'm-23:s')]);
  await expect(page.locator('#crew-tree [data-agent-id]')).toHaveCount(2);
  await expect(page.locator('#crew-tree [data-agent-id][data-status="running"]')).toHaveCount(2);
  const play = page.getByRole('button', { name: 'Play Simulated goal' });
  await play.click();
  await play.click();
  await expect(page.locator('#crew-tree [data-agent-id]')).toHaveCount(6, { timeout: 15_000 });
  await expect(page.locator('#ct-tree')).toHaveAttribute('data-done', 'true', { timeout: 15_000 });
  await expect(page.locator('#crew-tree [data-agent-id]')).toHaveCount(6);
});

test('crew tree: many agents collapse behind "+N more"; long roles do not scroll sideways at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page);
  const fr: any[] = [{ kind: 'moment', id: 'big', data: { minute: 88, why: 'goal', status: 'open' } }, sp('big', 'big:s', 'Showrunner', null)];
  for (let i = 0; i < 20; i++) fr.push(sp('big', 'big:' + i, 'Subagent-with-an-extremely-long-role-name-number-' + i + '-Supercalifragilistic', 'big:s'));
  await ingest(page, fr);
  await expect(page.locator('#crew-tree [data-agent-id]:visible')).toHaveCount(12);
  const more = page.locator('#ct-more');
  await expect(more).toHaveText('+9 more');
  const over = () => page.evaluate(() => { const e = document.getElementById('v-agents')!; return e.scrollWidth - e.clientWidth; });
  expect(await over()).toBeLessThanOrEqual(0);
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#crew-tree [data-agent-id]:visible')).toHaveCount(21);
  expect(await over()).toBeLessThanOrEqual(0);
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
