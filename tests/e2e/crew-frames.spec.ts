import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';
import { readFileSync } from 'node:fs';

// AB#498 (crew_ledger / crew_spawn: contract 1.3.0 from PR #379): CREW.ingest maps crew_ledger / crew_spawn (PROPOSAL) and the final onair / feed_drop (contract 1.2.0) into CREW.state.
// Names may change before AB#498 ships; the adapter lives in crew.js only. AG/CM/LV/CREW are lexical globals: bare names in evaluate.
declare const CREW: any;

async function open(page: any, query = '?crew=1', hash = 'agents') {
  await page.route(/\/(watch|broadcast)\/index\.html/, (r: any) => r.abort());
  await openShell(page, hash, query);
}
const ingest = (page: any, frames: any[]) => page.evaluate((fs: any[]) => fs.forEach((f) => CREW.ingest(f)), frames);
const state = (page: any) => page.evaluate(() => JSON.parse(JSON.stringify(CREW.state)));

const stream = (match_id = 'm1') => ({ tenant_id: 'demo', session_id: 's1', match_id });
// contract 1.3.0 (PR #379): no match_id or at_ms on crew_spawn, no match_id on crew_ledger; the stream identity names the match
const spawn = (o: any = {}) => ({ kind: 'crew_spawn', schema_version: '1.3.0', stream: stream(), moment_id: 'm-e42', spawn_id: 'm-e42:replay', agent_id: 'replay', role: 'replay',
  parent_id: 'showrunner', status: 'running', started_ms: 720000, ended_ms: null, tokens: 0, why: '', ...o });
const onair = (o: any = {}) => ({ kind: 'onair', publication_id: 'L-17', feed: 'analyst', lang: 'en', text: 'Goal for Northgate FC.', source_event_ids: ['e42'], claim_ids: ['c-9'],
  match_time_ms: 720000, aired_at: '2026-10-25T10:00:00Z', repair_count: 0, ...o });
const drop = (o: any = {}) => ({ kind: 'feed_drop', publication_id: 'L-1', feed: 'casual', source_event_ids: ['e1'], reason_code: 'number_mismatch', repair_count: 1, audit_id: 'aud-7', match_time_ms: 720000, ...o });
const ledger = (o: any = {}) => ({ kind: 'crew_ledger', schema_version: '1.3.0', stream: stream(), at_ms: 720000, moment_id: 'm-e42', called: ['analyst', 'narrator', 'verifier'], skipped: ['stats_desk'], why: 'goal', routed_by: 'rules', spawn_reason: '', ...o });

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

test('frames: onair airs a verified line in CREW.state.feeds and clears simulated', async ({ page }) => {
  await open(page);
  await ingest(page, [onair()]);
  const s = await state(page);
  expect(s.simulated).toBe(false);
  expect(s.feeds.analyst).toHaveLength(1);
  expect(s.feeds.analyst[0]).toMatchObject({ publication_id: 'L-17', text: 'Goal for Northgate FC.', verdict: 'verified', lang: 'en', repair_count: 0,
    source_event_ids: ['e42'], claim_ids: ['c-9'], match_time_ms: 720000, aired_at: '2026-10-25T10:00:00Z' });
  expect(s.lines.find((l: any) => l.id === 'L-17')).toMatchObject({ verdict: 'verified', feed: 'analyst', state: 'aired' });
  await ingest(page, [onair(), onair({ repair_count: 1 })]);   // a repeat replaces, never duplicates
  const s2 = await state(page);
  expect(s2.feeds.analyst).toHaveLength(1);
  expect(s2.feeds.analyst[0].repair_count).toBe(1);
  expect(s2.lines.filter((l: any) => l.id === 'L-17')).toHaveLength(1);
});

test('frames: onair and feed_drop name no moment: a stray moment_id is ignored, entries go to lines, and lines keep the newest 200', async ({ page }) => {
  await open(page);
  await ingest(page, [onair({ moment_id: 'm-e42', publication_id: 'L-2', feed: 'casual', repair_count: 1 }), drop({ moment_id: 'm-e42' })]);
  const s = await state(page);
  expect(s.moments).toEqual([]);
  expect(s.lines.map((l: any) => [l.id, l.verdict])).toEqual([['L-2', 'verified'], ['L-1', 'dropped']]);
  await page.evaluate(() => { for (let i = 0; i < 230; i++) CREW.ingest({ kind: 'feed_drop', publication_id: 'D' + i, feed: 'casual', reason_code: 'repeat', audit_id: 'a' + i }); });
  const s2 = await state(page);
  expect(s2.lines).toHaveLength(200);
  expect(s2.lines[199].id).toBe('D229');
});

test('frames: a translated onair row never overwrites the English row, and one that arrives first is kept for it', async ({ page }) => {
  await open(page);
  await ingest(page, [onair(), onair({ lang: 'es', text: 'Gol del Northgate.' }), onair({ lang: 'es-419', text: 'Otra.' })]);
  const s = await state(page);
  expect(s.feeds.analyst).toHaveLength(1);
  expect(s.feeds.analyst[0].text).toBe('Goal for Northgate FC.');
  expect(s.feeds.analyst[0].translations).toMatchObject({ es: 'Gol del Northgate.', 'es-419': 'Otra.' });
  // a translation that arrives before the English row is not the line, but is attached once the English row airs
  await ingest(page, [onair({ publication_id: 'L-30', lang: 'fr', text: 'Un but.' })]);
  expect((await state(page)).feeds.analyst.filter((l: any) => l.publication_id === 'L-30')).toEqual([]);
  await ingest(page, [onair({ publication_id: 'L-30', text: 'A goal.' })]);
  const row = (await state(page)).feeds.analyst.find((l: any) => l.publication_id === 'L-30');
  expect(row.text).toBe('A goal.');
  expect(row.translations).toEqual({ fr: 'Un but.' });
  // only the exact tag 'en' is the English row: 'en-GB' is kept as a translation, not shown as the line
  await ingest(page, [onair({ publication_id: 'L-31', lang: 'en-GB', text: 'A goal, mate.' })]);
  expect((await state(page)).feeds.analyst.filter((l: any) => l.publication_id === 'L-31')).toEqual([]);
});

test('frames: feed_drop records a dropped claim with its reason and audit id, never airs, stores no text', async ({ page }) => {
  await open(page);
  await ingest(page, [drop({ text: 'A wrong line that must not be stored.' }), drop({ publication_id: 'L-5', reason_code: 'repeat', audit_id: 'aud-8' })]);
  const s = await state(page);
  expect(s.simulated).toBe(false);
  expect(Object.values(s.feeds).flat()).toHaveLength(0);
  expect(JSON.stringify(s)).not.toContain('must not be stored');
  expect(s.lines[0]).toMatchObject({ id: 'L-1', verdict: 'dropped', reason: 'number_mismatch', audit_id: 'aud-7' });
  expect(s.lines[0].text).toBeUndefined();
  expect(s.lines.find((l: any) => l.id === 'L-5')).toMatchObject({ verdict: 'dropped', reason: 'repeat', audit_id: 'aud-8' });
  // a drop for a line that already aired does not remove it from the feed
  await ingest(page, [onair({ publication_id: 'L-9' }), drop({ publication_id: 'L-9', feed: 'analyst' })]);
  expect((await state(page)).feeds.analyst.map((l: any) => l.publication_id)).toEqual(['L-9']);
});

test('frames: old fixture kinds still work and do not clear simulated', async ({ page }) => {
  await open(page);
  await ingest(page, [{ kind: 'moment', id: 'a', data: { minute: 3, why: 'goal' } }, { kind: 'publish', feed: 'casual', line: { publication_id: 'p', text: 't', match_time_ms: 1, source_event_ids: [] } }]);
  const s = await state(page);
  expect(s.simulated).toBe(true);
  expect(s.feeds.casual).toHaveLength(1);
});

test('frames: Play Simulated goal goes through onair and crew_* frames, stays Simulated, fills tree, claims and feeds', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Play Simulated goal' }).click();
  await expect(page.locator('#ct-tree')).toHaveAttribute('data-done', 'true', { timeout: 15_000 });
  // the fixture emits onair (the repair airs with repair_count 1); the Showrunner id comes only via crew_spawn, minute only via crew_ledger or crew_spawn
  const s = await state(page);
  expect(s.simulated).toBe(true);
  expect(s.lines.length).toBeGreaterThanOrEqual(2);
  expect(s.lines.some((c: any) => c.verdict === 'verified' && c.repair_count === 1)).toBe(true);
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

test('frames: malformed frames never throw and never half-apply', async ({ page }) => {
  const errs = collectErrors(page);
  await open(page);
  await ingest(page, [null, 7, 'x', {}, { kind: 5 }, { kind: '__proto__' }, { kind: 'constructor' }, { kind: 'toString' },
    { kind: 'crew_ledger' }, { kind: 'crew_ledger', moment_id: '' }, { kind: 'crew_spawn', moment_id: 'm' }, { kind: 'crew_spawn', spawn_id: 's' },
    { kind: 'crew_trace', moment_id: 'm', line_id: 'L', feed: 'analyst', state: 'published', text: 'old', claims: [] },   // the proposal frame no longer exists
    onair({ publication_id: undefined }), onair({ publication_id: '' }), onair({ feed: 'booth:pbp' }), onair({ feed: '__proto__' }), onair({ feed: 'constructor' }), onair({ feed: undefined }),
    onair({ text: 5 }), onair({ text: undefined }), onair({ source_event_ids: [] }), onair({ source_event_ids: 'e1' }), onair({ source_event_ids: [3, null] }), onair({ source_event_ids: undefined }),
    drop({ publication_id: undefined }), drop({ feed: undefined }), drop({ reason_code: undefined }), drop({ reason_code: '' }), drop({ feed: '__proto__' }),
    onair({ publication_id: 'ok-1' }), drop({ publication_id: 'ok-2' })]);
  const s = await state(page);
  expect(s.simulated).toBe(false);   // the one valid frame is a real frame
  expect(s.lines.map((l: any) => l.id)).toEqual(['ok-1', 'ok-2']);   // only the two valid frames landed
  expect(s.feeds.analyst.map((l: any) => l.publication_id)).toEqual(['ok-1']);
  expect(Object.keys(s.feeds).sort()).toEqual(['analyst', 'audio_description', 'casual', 'catch_me_up', 'half_time', 'ticker']);
  expect(errs).toEqual([]);
});

test('frames: a malformed frame as the first frame does not clear simulated or wipe the fixture', async ({ page }) => {
  await open(page);
  await ingest(page, [onair({ source_event_ids: [] }), drop({ reason_code: undefined }), { kind: 'crew_ledger' }]);
  expect((await state(page)).simulated).toBe(true);
  await ingest(page, [ledger()]);
  expect((await state(page)).simulated).toBe(false);
});

test('frames: out of order (onair and spawn before the ledger) and duplicates end in the same state', async ({ page }) => {
  await open(page);
  const frames = [onair(), spawn({ status: 'done', ended_ms: 721000 }), spawn({ spawn_id: 'm-e42:h', role: 'history', status: 'no_data', ended_ms: 720500 }), ledger()];
  await ingest(page, [...frames, ...frames]);
  const s = await state(page);
  expect(s.moments).toHaveLength(1);
  const m = s.moments[0];
  expect(m).toMatchObject({ minute: 12, why: 'goal', routed_by: 'rules', status: 'done' });
  expect(m.agents.map((a: any) => a.id).sort()).toEqual(['m-e42:h', 'm-e42:replay', 'm-e42:show']);
  expect(s.lines).toHaveLength(1);
  expect(s.feeds.analyst).toHaveLength(1);
});

test('frames: a terminal spawn status does not regress on a late running frame, and omitted fields keep earlier values', async ({ page }) => {
  await open(page);
  await ingest(page, [spawn({ tokens: 9, why: 'replay ready' }), spawn({ status: 'done', ended_ms: 721000, tokens: undefined, why: undefined }), spawn({ status: 'running', ended_ms: null, tokens: undefined }),
    spawn({ spawn_id: 'x', status: 'budget_exhausted', ended_ms: 720000 }), spawn({ spawn_id: 'x', status: 'running' }),
    { kind: 'crew_spawn', moment_id: 'm-e42', spawn_id: 'm-e42:replay', status: 'done' }]);
  const m = (await state(page)).moments[0];
  expect(m.agents.find((a: any) => a.id === 'm-e42:replay')).toMatchObject({ status: 'done', ended: 721000, tokens: 9, why: 'replay ready', started: 720000, role: 'replay' });
  expect(m.agents.find((a: any) => a.id === 'x').status).toBe('budget_exhausted');
  // claims: a later frame without a verifier or text keeps the verdict and the text
  await ingest(page, [onair(), onair({ claim_ids: undefined, aired_at: undefined })]);
  expect((await state(page)).feeds.analyst[0]).toMatchObject({ verdict: 'verified', text: 'Goal for Northgate FC.', claim_ids: ['c-9'], aired_at: '2026-10-25T10:00:00Z' });
});

test('frames: moments are keyed by stream plus moment_id; frames without a stream still work', async ({ page }) => {
  await open(page);
  await ingest(page, [ledger({ stream: stream('a'), why: 'goal' }), ledger({ stream: stream('b'), why: 'red card' }), spawn({ stream: stream('b') }), spawn({ stream: undefined, spawn_id: 'n', moment_id: 'solo' }),
    ledger({ stream: { ...stream('a'), session_id: 's2' }, why: 'corner' })]);
  const s = await state(page);
  expect(s.moments.map((m: any) => [m.match_id, m.id, m.why])).toEqual([['a', 'm-e42', 'goal'], ['b', 'm-e42', 'red card'], [undefined, 'solo', ''], ['a', 'm-e42', 'corner']]);
  expect(s.moments[0].agents.map((a: any) => a.id)).toEqual(['m-e42:show']);   // match a has only its ledger's Showrunner
  expect(s.moments[1].agents.map((a: any) => a.id).sort()).toEqual(['m-e42:replay', 'm-e42:show']);
});

test('frames: the minute of a spawn comes from started_ms (the frame has no at_ms)', async ({ page }) => {
  await open(page);
  await ingest(page, [spawn({ started_ms: 300000 })]);
  expect((await state(page)).moments[0].minute).toBe(5);
});

test('frames: a real frame mid-play clears the pending fixture timers; play after real data starts clean', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Play Simulated goal' }).click();
  await ingest(page, [ledger({ moment_id: 'real-1' })]);
  await page.waitForTimeout(5500);   // the fixture runs 4.6 s; nothing of it may land
  let s = await state(page);
  expect(s.simulated).toBe(false);
  expect(s.moments.map((m: any) => m.id)).toEqual(['real-1']);
  expect(s.feeds.casual).toEqual([]);
  expect(s.score).toBeNull();
  await page.evaluate(() => CREW.play(23));
  s = await state(page);
  expect(s.simulated).toBe(true);
  expect(s.moments).toEqual([]);          // play() starts clean: real data is not merged under the Simulated label
  await expect.poll(async () => (await state(page)).moments.map((m: any) => [m.id, m.status]), { timeout: 15_000 }).toEqual([['m-23', 'done']]);
});

test('frames: with the flag off, ingest is inert', async ({ page }) => {
  await open(page, '');
  await ingest(page, [ledger(), spawn(), onair(), drop(), { kind: 'moment', id: 'a', data: {} }]);
  const s = await state(page);
  expect(s.moments).toEqual([]);
  expect(s.lines).toEqual([]);
  expect(s.simulated).toBe(true);
  expect(Object.values(s.feeds).flat()).toEqual([]);
});

test('frames: a real onair then play() starts clean and Simulated, then a real onair drops the fixture again', async ({ page }) => {
  await open(page);
  await ingest(page, [onair({ publication_id: 'real-L' })]);
  await page.evaluate(() => CREW.play(23));
  let s = await state(page);
  expect(s.simulated).toBe(true);
  expect(Object.values(s.feeds).flat()).toEqual([]);
  expect(s.lines).toEqual([]);
  await expect.poll(async () => (await state(page)).feeds.casual.length, { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator('#ct-sim')).toBeVisible();   // fixture onair frames never show a tick or clear Simulated
  await ingest(page, [onair({ publication_id: 'real-2' })]);
  s = await state(page);
  expect(s.simulated).toBe(false);
  expect(s.feeds.casual).toEqual([]);
  expect(s.feeds.analyst.map((l: any) => l.publication_id)).toEqual(['real-2']);
});

test('frames: a ledger keeps its spawn_reason', async ({ page }) => {
  await open(page);
  await ingest(page, [ledger({ spawn_reason: 'budget exhausted', called: ['analyst'] }), ledger({ moment_id: 'm-2', spawn_reason: 5 })]);
  const s = await state(page);
  expect(s.moments[0].spawn_reason).toBe('budget exhausted');
  expect(s.moments[1].spawn_reason).toBeUndefined();
  await page.evaluate(() => { location.hash = '#agents'; });
  await expect(page.locator('#ct-spawn-why')).toBeHidden();   // the latest moment (m-2) has no reason
  await ingest(page, [ledger({ moment_id: 'm-3', spawn_reason: 'budget exhausted' })]);
  await expect(page.locator('#ct-spawn-why')).toHaveText('No specialists spawned: budget exhausted');
});

test('frames: the contract fixture crew-ledger.json (1.3.0) is accepted as it is', async ({ page }) => {
  const fx = JSON.parse(readFileSync('packages/contracts/fixtures/crew-ledger.json', 'utf8'));
  await open(page);
  await ingest(page, [fx]);
  const s = await state(page);
  expect(s.simulated).toBe(false);
  expect(s.moments).toHaveLength(1);
  expect(s.moments[0]).toMatchObject({ id: fx.moment_id, match_id: fx.stream.match_id, why: 'goal', routed_by: 'rules', called: fx.called, skipped: fx.skipped, status: 'done' });
  expect(s.moments[0].spawn_reason).toBeUndefined();   // an empty reason (the planner did spawn) shows nothing
});
