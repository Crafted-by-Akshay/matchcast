import { test, expect } from './fixtures';
import { createServer } from 'node:http';

// AB#498 (contract 1.3.0, PR #379): the scoreboard is a GET, not a frame, and crew frames are not replayed on reconnect.
// The api is a local fixture server here; no live Azure or Foundry call.
declare const CREW: any;
declare const LV: any;
test.skip(!!process.env.E2E_BASE_URL, 'PR checks only: a fixture api feeds the data');

// the dict grading.scoreboard() returns (packages/agents/matchcast_agents/grading.py)
const arm = (label: string, wrong: number, caught: number, o: any = {}) => ({ label, mode: 'rules', run_id: 'r-' + label, lines_aired: 20,
  accuracy: { wrong_numbers_aired: wrong, numbers_aired: 100, wrong_rate: wrong / 100 }, catch_rate: { caught, seeded: 4, rate: caught / 4 },
  latency_ms: { p50: 2000, p95: 3000, total: 9000, moments: 5 }, cost: { model_calls: 0, model_calls_per_line: 0, basis: 'no price applied' }, ...o });
const BOARD = { kind: 'crew_ablation_scoreboard', match_id: 'm-k1', run_date: '2026-10-25', seed: 2026, seed_rate: 0.2, moments: 5, seeded_wrong_claims: 4,
  arms: { full_crew: arm('full', 1, 4), single_agent: arm('single', 10, 0), crew_no_verifier: arm('noverifier', 7, 0, { mode: 'precomputed', run_id: 'rec-9' }) },
  difference: { found: true, note: 'The crew without the Verifier aired 3 wrong lines; the full crew aired 1.' } };

async function withApi(board: () => { status: number; body?: any }, body: (api: string, hits: string[]) => Promise<void>) {
  const hits: string[] = [];
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') { q.resume(); q.on('end', () => { r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); }); return; }
      if (/\/scoreboard/.test(q.url!)) { hits.push(q.url!); const b = board(); r.writeHead(b.status, { 'Content-Type': 'application/json', ...cors }); return r.end(JSON.stringify(b.body || {})); }
      if (/\/stream/.test(q.url!)) { r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"live"}\n\n'); return; }
      r.writeHead(404, cors); r.end();
    }).listen(0, () => resolve(s));
  });
  try { await body('http://127.0.0.1:' + (server.address() as any).port, hits); } finally { server.closeAllConnections?.(); server.close(); }
}

async function openLive(page: any, api: string) {
  await page.addInitScript(() => { (window as any).MATCHCAST_SCORE_MS = 400; });
  await page.route('**/config.js', (rt: any) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
  await page.route(/\/(watch|broadcast)\/index\.html/, (r: any) => r.abort());
  await page.goto('/index.html?crew=1#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && typeof CREW !== 'undefined' && !!document.getElementById('crew-score'), null, { timeout: 30_000 });
  await page.evaluate(() => LV.begin('k1', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }));
}

test('scoreboard: the GET is polled while the match is live and drawn as real data, with no Simulated badge', async ({ page }) => {
  await withApi(() => ({ status: 200, body: BOARD }), async (api, hits) => {
    await openLive(page, api);
    const root = page.locator('#crew-score');
    await expect(root.locator('.cs-arm')).toHaveCount(3, { timeout: 30_000 });
    await expect(root.locator('[data-arm="full_crew"] .cs-acc')).toHaveText('99%');         // 1 wrong of 100 numbers
    await expect(root.locator('[data-arm="single_agent"] .cs-acc')).toHaveText('90%');
    await expect(root.locator('[data-arm="full_crew"]')).toContainText('100%');             // catch rate 4 of 4
    await expect(root.locator('[data-arm="full_crew"]')).toContainText('2.0 s');
    await expect(root.locator('[data-arm="full_crew"]')).toContainText('20 lines graded');
    await expect(root.locator('[data-arm="crew_no_verifier"]')).toContainText('Precomputed · rec-9');
    await expect(root.locator('.cs-badge.sim')).toHaveCount(0);
    await expect(root).toContainText('The crew without the Verifier aired 3 wrong lines');
    expect(hits[0]).toMatch(/\/v1\/matches\/m-k1\/scoreboard\?session_id=/);
    await expect.poll(() => hits.length, { timeout: 10_000 }).toBeGreaterThan(1);           // it keeps polling
    expect(await page.evaluate(() => CREW.state.scoreSource)).toBe('api');
  });
});

test('scoreboard: a 404 says it is not available yet, then the scoreboard appears when the api has one', async ({ page }) => {
  let ready = false;
  await withApi(() => (ready ? { status: 200, body: BOARD } : { status: 404, body: { detail: 'no scoreboard' } }), async (api) => {
    await openLive(page, api);
    await expect(page.locator('#crew-score')).toContainText('not available yet', { timeout: 30_000 });
    await expect(page.locator('#crew-score .cs-arm')).toHaveCount(0);
    ready = true;
    await expect(page.locator('#crew-score .cs-arm')).toHaveCount(3, { timeout: 30_000 });
    await expect(page.locator('#crew-score')).not.toContainText('not available yet');
  });
});

test('scoreboard: errors and junk bodies stay silent and the page keeps working', async ({ page }) => {
  const errs: string[] = [];
  page.on('pageerror', (e: any) => errs.push(String(e)));
  let mode = 0;
  await withApi(() => (mode === 0 ? { status: 500 } : { status: 200, body: { arms: 'nope' } }), async (api, hits) => {
    await openLive(page, api);
    await expect.poll(() => hits.length, { timeout: 15_000 }).toBeGreaterThan(0);
    mode = 1;
    await expect.poll(() => hits.length, { timeout: 15_000 }).toBeGreaterThan(2);
    await expect(page.locator('#crew-score')).toContainText('Waiting for graded lines');
    expect(await page.evaluate(() => CREW.state.score)).toBeNull();
    expect(errs).toEqual([]);
  });
});

test('scoreboard: the Simulated fixture score stays Simulated and a fetched score does not replace it', async ({ page }) => {
  await withApi(() => ({ status: 404 }), async (api) => {
    await openLive(page, api);
    await page.evaluate(() => CREW.play());
    await expect(page.locator('#crew-score .cs-arm')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('#crew-score .cs-badge.sim')).toHaveText('Simulated');
    expect(await page.evaluate(() => CREW.state.scoreSource)).toBe('fixture');
    expect(await page.evaluate(() => CREW.fetchScore())).toBe(false);
  });
});

test('crew tree: joined mid-match with no moment yet, it says the crew starts at the next moment and keeps the Simulated button', async ({ page }) => {
  await withApi(() => ({ status: 404 }), async (api) => {
    await openLive(page, api);
    await expect.poll(() => page.evaluate(() => LV.status), { timeout: 30_000 }).toBe('live');
    const empty = page.locator('#ct-empty');
    await expect(empty).toContainText('The crew starts at the next moment', { timeout: 10_000 });
    await expect(empty).toHaveAttribute('data-state', 'next-moment');
    await expect(empty).toBeVisible();
    await expect(page.locator('#ct-tree')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Play Simulated goal' })).toBeVisible();
    // the first real moment takes its place
    await page.evaluate(() => CREW.ingest({ kind: 'crew_ledger', schema_version: '1.3.0', stream: LV.key, moment_id: 'm-1', at_ms: 600000, called: ['analyst'], skipped: [], why: 'goal', routed_by: 'rules' }));
    await expect(empty).toBeHidden();
    await expect(page.locator('#ct-tree')).toBeVisible();
  });
});

test('crew tree: with no api match the empty state is unchanged', async ({ page }) => {
  await page.route(/\/(watch|broadcast)\/index\.html/, (r: any) => r.abort());
  await page.goto('/index.html?crew=1#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof CREW !== 'undefined' && !!document.getElementById('ct-empty'), null, { timeout: 30_000 });
  await expect(page.locator('#ct-empty')).toContainText('No moment yet. Play a Simulated goal');
  await expect(page.locator('#ct-empty')).toHaveAttribute('data-state', 'idle');
});
