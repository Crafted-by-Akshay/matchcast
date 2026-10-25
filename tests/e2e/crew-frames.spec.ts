import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';

// AB#498 (PROPOSAL shapes, crew-frames-proposal.md): CREW.ingest maps crew_ledger / crew_spawn / crew_trace into CREW.state.
// Names may change before AB#498 ships; the adapter lives in crew.js only. AG/CM/LV/CREW are lexical globals: bare names in evaluate.
declare const CREW: any;

async function open(page: any, query = '?crew=1', hash = 'agents') {
  await page.route(/\/(watch|broadcast)\/index\.html/, (r: any) => r.abort());
  await openShell(page, hash, query);
}
const ingest = (page: any, frames: any[]) => page.evaluate((fs: any[]) => fs.forEach((f) => CREW.ingest(f)), frames);
const state = (page: any) => page.evaluate(() => JSON.parse(JSON.stringify(CREW.state)));

const spawn = (o: any = {}) => ({ kind: 'crew_spawn', match_id: 'm1', at_ms: 720000, moment_id: 'm-e42', spawn_id: 'm-e42:replay', agent_id: 'replay', role: 'replay',
  parent_id: 'showrunner', status: 'running', started_ms: 720000, ended_ms: null, tokens: 0, why: '', ...o });
const trace = (o: any = {}) => ({ kind: 'crew_trace', match_id: 'm1', at_ms: 720000, line_id: 'L-17', moment_id: 'm-e42', feed: 'analyst', state: 'published',
  text: 'Goal for Northgate FC.', claims: [{ claim_id: 'c-9', metric: 'goals:home', value: 1, source_event_ids: ['e42'], history_row_ids: ['results:3'] }],
  verifier: { verdict: 'verified', reason_code: null, checks: ['numbers'] }, repair_of: null, called: ['analyst', 'verifier'], audit_hash: 'sha256:abc', ...o });
const ledger = (o: any = {}) => ({ kind: 'crew_ledger', match_id: 'm1', at_ms: 720000, moment_id: 'm-e42', called: ['analyst', 'narrator', 'verifier'], skipped: ['stats_desk'], why: 'goal', routed_by: 'rules', ...o });
const claim = (id: string) => ({ claim_id: id, metric: 'm', value: 1, source_event_ids: ['e1'], history_row_ids: [] });

test('frames: crew_ledger makes a moment with minute, why, routed_by, called and skipped; first real frame clears simulated', async ({ page }) => {
  const errs = collectErrors(page);
  await open(page);
  expect((await state(page)).simulated).toBe(true);
  await ingest(page, [ledger()]);
  const s = await state(page);
  expect(s.simulated).toBe(false);
  expect(s.moments).toHaveLength(1);
  expect(s.moments[0]).toMatchObject({ id: 'm-e42', minute: 12, why: 'goal', routed_by: 'rules', called: ['analyst', 'narrator', 'verifier'], skipped: ['stats_desk'] });
  await expect(page.locator('#ct-sim')).toBeHidden();
  await expect(page.locator('#ct-label')).toHaveText("goal, 12'");
  expect(errs).toEqual([]);
});

test('frames: crew_spawn nests under the Showrunner (created if missing) and keeps the raw status', async ({ page }) => {
  await open(page);
  await ingest(page, [spawn({ tokens: 12, why: 'wants the replay' }),
    spawn({ spawn_id: 'm-e42:hist', agent_id: 'history', role: 'history', status: 'no_data', ended_ms: 720500, why: 'no rows' }),
    spawn({ spawn_id: 'm-e42:extra', agent_id: 'x', role: 'extra', status: 'budget_exhausted', ended_ms: 720000 }),
    spawn({ spawn_id: 'm-e42:sub', agent_id: 'sub', role: 'sub', parent_id: 'm-e42:replay' })]);
  const m = (await state(page)).moments[0];
  const by: any = {}; m.agents.forEach((a: any) => (by[a.id] = a));
  expect(m.agents).toHaveLength(5);
  const show = m.agents.find((a: any) => a.role === 'Showrunner');
  expect(show).toBeTruthy();
  expect(by['m-e42:replay']).toMatchObject({ role: 'replay', parent: show.id, status: 'running', tokens: 12, why: 'wants the replay', started: 720000 });
  expect(by['m-e42:hist']).toMatchObject({ status: 'no_data', ended: 720500, parent: show.id });
  expect(by['m-e42:extra'].status).toBe('budget_exhausted');
  expect(by['m-e42:sub'].parent).toBe('m-e42:replay');
  // the same spawn_id updates in place and an empty why does not erase one
  await ingest(page, [spawn({ status: 'done', ended_ms: 721000 })]);
  const m2 = (await state(page)).moments[0];
  expect(m2.agents).toHaveLength(5);
  expect(m2.agents.find((a: any) => a.id === 'm-e42:replay')).toMatchObject({ status: 'done', ended: 721000, why: 'wants the replay' });
});

test('frames: crew-tree labels no_data and budget_exhausted honestly, never as running', async ({ page }) => {
  await open(page);
  await ingest(page, [spawn({ spawn_id: 'a', role: 'history', status: 'no_data', ended_ms: 1 }), spawn({ spawn_id: 'b', role: 'extra', status: 'budget_exhausted', ended_ms: 720000 }), spawn({ spawn_id: 'c', role: 'replay' })]);
  await expect(page.locator('[data-agent-id="a"]')).toContainText('no data');
  await expect(page.locator('[data-agent-id="a"]')).not.toContainText('running');
  await expect(page.locator('[data-agent-id="b"]')).toContainText('budget exhausted');
  await expect(page.locator('[data-agent-id="b"]')).toHaveAttribute('data-status', 'budget_exhausted');
  await expect(page.locator('[data-agent-id="c"]')).toContainText('running');
  // the moment ends: terminal statuses keep their label, running resolves to done
  await ingest(page, [ledger()]);
  await expect(page.locator('[data-agent-id="a"]')).toHaveAttribute('data-status', 'no_data');
  await expect(page.locator('[data-agent-id="b"]')).toHaveAttribute('data-status', 'budget_exhausted');
  await expect(page.locator('[data-agent-id="c"]')).toHaveAttribute('data-status', 'done');
  await expect(page.locator('#ct-state')).toHaveText('Moment done');
});

test('frames: crew_trace records claims; published derived-feed lines reach CREW.state.feeds with the verdict', async ({ page }) => {
  await open(page);
  await ingest(page, [trace()]);
  const s = await state(page);
  expect(s.moments[0].claims[0]).toMatchObject({ id: 'c-9', text: 'Goal for Northgate FC.', verdict: 'verified', sources: ['e42'], history: ['results:3'], repair_of: null, audit_hash: 'sha256:abc', state: 'published' });
  expect(s.feeds.analyst).toEqual([{ publication_id: 'L-17', text: 'Goal for Northgate FC.', match_time_ms: 720000, source_event_ids: ['e42'], verdict: 'verified' }]);
  await ingest(page, [trace()]);   // a repeat of the same line does not duplicate it
  expect((await state(page)).feeds.analyst).toHaveLength(1);
});

test('frames: dropped lines record the reason with no text; review, booth and unknown feeds are not aired', async ({ page }) => {
  await open(page);
  await ingest(page, [
    trace({ line_id: 'L-1', state: 'dropped', text: undefined, claims: [claim('c-1')], verifier: { verdict: 'rejected', reason_code: 'number_mismatch', checks: [] } }),
    trace({ line_id: 'L-2', state: 'review', feed: 'booth:pbp', text: 'Waiting for the producer.', claims: [claim('c-2')], verifier: { verdict: 'rejected', reason_code: 'unknown_player', checks: [] } }),
    trace({ line_id: 'L-3', state: 'published', feed: 'booth:colour', text: 'Booth line.', claims: [claim('c-3')] }),
    trace({ line_id: 'L-4', state: 'published', feed: 'unknown_feed', text: 'Not a feed.', claims: [claim('c-4')] })]);
  const s = await state(page);
  const cl: any = {}; s.moments[0].claims.forEach((c: any) => (cl[c.id] = c));
  expect(cl['c-1']).toMatchObject({ verdict: 'rejected', reason: 'number_mismatch', state: 'dropped' });
  expect(cl['c-1'].text).toBeFalsy();
  expect(cl['c-2']).toMatchObject({ reason: 'unknown_player', state: 'review' });
  expect(Object.values(s.feeds).flat()).toHaveLength(0);
});

test('frames: a repair claim keeps repair_of and its line airs', async ({ page }) => {
  await open(page);
  await ingest(page, [trace({ line_id: 'L-2', feed: 'casual', repair_of: 'L-1', claims: [claim('c-2')] })]);
  const s = await state(page);
  expect(s.moments[0].claims[0].repair_of).toBe('L-1');
  expect(s.feeds.casual).toHaveLength(1);
});

test('frames: old fixture kinds still work and do not clear simulated', async ({ page }) => {
  await open(page);
  await ingest(page, [{ kind: 'moment', id: 'a', data: { minute: 3, why: 'goal' } }, { kind: 'publish', feed: 'casual', line: { publication_id: 'p', text: 't', match_time_ms: 1, source_event_ids: [] } }]);
  const s = await state(page);
  expect(s.simulated).toBe(true);
  expect(s.feeds.casual).toHaveLength(1);
});

test('frames: Play Simulated goal goes through crew_* frames, stays Simulated, fills tree, claims and feeds', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Play Simulated goal' }).click();
  await expect(page.locator('#ct-tree')).toHaveAttribute('data-done', 'true', { timeout: 15_000 });
  // the audit_hash and reason fields exist only on the crew_trace path, the Showrunner id only via crew_spawn, minute only via crew_ledger or crew_spawn
  const s = await state(page);
  expect(s.simulated).toBe(true);
  expect(s.moments[0].claims.length).toBeGreaterThanOrEqual(2);
  expect(s.moments[0].claims.some((c: any) => c.reason === 'number_mismatch' && c.state === 'dropped' && /^sim:/.test(c.audit_hash))).toBe(true);
  expect(s.moments[0]).toMatchObject({ minute: 23, called: ['analyst', 'narrator', 'verifier'], status: 'done' });
  expect(s.moments[0].agents.find((a: any) => a.role === 'Replay')).toMatchObject({ parent: 'm-23:show', status: 'done' });
  expect(s.feeds.casual[0].text).toContain('Second shot on target');
  expect(s.feeds.analyst[0].text).toContain('xG 0.31');
  await expect(page.locator('#ct-sim')).toBeVisible();
  await expect(page.locator('#crew-tree [data-agent-id]')).toHaveCount(6);
});

test('frames: a real frame after the fixture drops the fixture data (no Simulated lines under a real label)', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Play Simulated goal' }).click();
  await expect(page.locator('#ct-tree')).toHaveAttribute('data-done', 'true', { timeout: 15_000 });
  await ingest(page, [ledger({ moment_id: 'real-1' })]);
  const s = await state(page);
  expect(s.simulated).toBe(false);
  expect(s.moments.map((m: any) => m.id)).toEqual(['real-1']);
  expect(s.feeds.casual).toEqual([]);
  expect(s.score).toBeNull();
});

test('agents tab: flag off, the empty #crew-score mount adds no grid gap', async ({ page }) => {
  await open(page, '');
  const r = await page.evaluate(() => {
    const sc = document.getElementById('crew-score')!;
    const o = document.getElementById('ag-orch')!, a = document.getElementById('aq')!;
    return { scDisplay: getComputedStyle(sc).display, scH: sc.getBoundingClientRect().height, gap: Math.round(a.getBoundingClientRect().top - o.getBoundingClientRect().bottom) };
  });
  expect(r.scDisplay).toBe('none');
  expect(r.scH).toBe(0);
  expect(r.gap).toBe(14);   // one grid gap between the panels either side of the empty mount
});

test('agents tab: flag on, #crew-score still shows its panel', async ({ page }) => {
  await open(page);
  await expect(page.locator('#crew-score')).not.toBeEmpty();
  await expect(page.locator('#crew-score')).toBeVisible();
});
