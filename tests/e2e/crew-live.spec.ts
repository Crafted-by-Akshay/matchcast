import { test, expect } from './fixtures';
import { createServer } from 'node:http';

// AB#498 (contract 1.3.0, PR #379): crew frames arrive on the SSE stream, the scoreboard is a GET, and crew frames are not replayed on reconnect.
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

type Opts = {
  board?: () => { status: number; body?: any };
  delay?: number | ((url: string) => number);   // ms before the scoreboard answers
  status?: string;                      // the stream's status event
  createStatus?: number;                // the match create answer (409 = the match already existed)
  streamFrames?: (session: string) => string;   // extra SSE text written after the status
  endFirstStream?: boolean;             // the first stream connection ends (a drop); later ones stay open
};
async function withApi(o: Opts, body: (api: string, hits: string[], info: { inflightMax: number; streams: number; inflight: number }) => Promise<void>) {
  const hits: string[] = [], info = { inflightMax: 0, streams: 0, inflight: 0 };
  const sockets = new Set<any>();
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') {
        q.resume();
        q.on('end', () => { const isEv = /\/events/.test(q.url!); r.writeHead(isEv ? 202 : o.createStatus || 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); });
        return;
      }
      if (/\/scoreboard/.test(q.url!)) {
        hits.push(q.url!); info.inflight++; info.inflightMax = Math.max(info.inflightMax, info.inflight);
        const b = (o.board || (() => ({ status: 404 })))();
        const wait = typeof o.delay === 'function' ? o.delay(q.url!) : o.delay || 0;
        setTimeout(() => { info.inflight--; r.writeHead(b.status, { 'Content-Type': 'application/json', ...cors }); r.end(JSON.stringify(b.body || {})); }, wait);
        return;
      }
      if (/\/stream/.test(q.url!)) {
        const u = new URL(q.url!, 'http://x'), booth = u.searchParams.get('persona') === 'booth';   // the booth keeps its own stream; only the main one counts
        const session = u.searchParams.get('session_id') || '';
        r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors });
        r.write('event: status\ndata: ' + JSON.stringify({ status: o.status || 'live' }) + '\n\n');
        if (booth) return;
        info.streams++;
        if (o.streamFrames) r.write(o.streamFrames(session));
        if (o.endFirstStream && info.streams === 1) setTimeout(() => r.end(), 300);
        return;
      }
      r.writeHead(404, cors); r.end();
    });
    s.on('connection', (sock) => { sockets.add(sock); sock.on('close', () => sockets.delete(sock)); });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try { await body('http://127.0.0.1:' + (server.address() as any).port, hits, info); }
  finally { sockets.forEach((x) => x.destroy()); await new Promise<void>((res) => server.close(() => res())); }
}

async function openLive(page: any, api: string, query = '?crew=1', begin = true, scoreMs = 400) {
  await page.addInitScript((ms: number) => { (window as any).MATCHCAST_SCORE_MS = ms; (window as any).__tk = 0; setInterval(() => { (window as any).__tk++; }, 250); }, scoreMs);
  await page.route('**/config.js', (rt: any) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
  await page.route(/\/(watch|broadcast)\/index\.html/, (r: any) => r.abort());
  await page.goto('/index.html' + query + '#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.getElementById('crew-score') !== null, null, { timeout: 30_000 });
  if (begin) await page.evaluate(() => LV.begin('k1', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }));
}
// a negative check needs a window to look over: n page ticks (250 ms each), counted in the page and polled, not slept
const after = async (page: any, n: number) => {
  const t0 = await page.evaluate(() => (window as any).__tk);
  await expect.poll(() => page.evaluate(() => (window as any).__tk), { timeout: 30_000 }).toBeGreaterThanOrEqual(t0 + n);
};
const sid = (u: string) => new URL(u, 'http://x').searchParams.get('session_id');

test('stream: onair, crew_ledger and crew_spawn events reach CREW.state', async ({ page }) => {
  const frames = (session: string) => {
    const stream = { tenant_id: 'demo', session_id: session, match_id: 'm-k1' };
    const ev = (n: string, d: any) => 'event: ' + n + '\ndata: ' + JSON.stringify(d) + '\n\n';
    return ev('crew_spawn', { schema_version: '1.3.0', stream, moment_id: 'm-e1', spawn_id: 'm-e1:replay', agent_id: 'replay', role: 'replay', parent_id: 'showrunner', status: 'running', started_ms: 600000, ended_ms: null, tokens: 0, why: 'replay' })
      + ev('crew_ledger', { schema_version: '1.3.0', stream, moment_id: 'm-e1', at_ms: 600000, called: ['analyst', 'replay'], skipped: [], why: 'goal', routed_by: 'rules', spawn_reason: '' })
      + ev('onair', { publication_id: 'P1', feed: 'casual', lang: 'en', text: 'Northgate FC score.', source_event_ids: ['E12'], claim_ids: [], match_time_ms: 600000, aired_at: '2026-10-25T14:00:00Z', repair_count: 0 })
      + ev('feed_drop', { publication_id: 'P2', feed: 'ticker', source_event_ids: ['E13'], reason_code: 'repeat', repair_count: 1, audit_id: 'a-1', match_time_ms: 610000 });
  };
  await withApi({ streamFrames: frames }, async (api) => {
    await openLive(page, api);
    await expect.poll(() => page.evaluate(() => CREW.state.moments.length), { timeout: 30_000 }).toBe(1);
    const s = await page.evaluate(() => JSON.parse(JSON.stringify(CREW.state)));
    expect(s.simulated).toBe(false);
    expect(s.moments[0]).toMatchObject({ id: 'm-e1', minute: 10, why: 'goal', status: 'done', called: ['analyst', 'replay'] });
    expect(s.moments[0].agents.map((a: any) => a.id).sort()).toEqual(['m-e1:replay', 'm-e1:show']);
    expect(s.feeds.casual[0]).toMatchObject({ publication_id: 'P1', text: 'Northgate FC score.', verdict: 'verified' });
    expect(s.lines.find((l: any) => l.id === 'P2')).toMatchObject({ verdict: 'dropped', reason: 'repeat', audit_id: 'a-1' });
    expect(s.feeds.ticker).toEqual([]);
  });
});

test('stream: without ?crew=1 the stream events leave CREW inert', async ({ page }) => {
  const frames = () => 'event: onair\ndata: ' + JSON.stringify({ publication_id: 'P1', feed: 'casual', lang: 'en', text: 'x', source_event_ids: ['E1'], claim_ids: [], match_time_ms: 1, aired_at: 'z', repair_count: 0 }) + '\n\n';
  await withApi({ streamFrames: frames, board: () => ({ status: 200, body: BOARD }) }, async (api, hits, info) => {
    await openLive(page, api, '');
    await expect.poll(() => info.streams, { timeout: 30_000 }).toBeGreaterThan(0);
    await after(page, 10);
    expect(await page.evaluate(() => JSON.stringify([CREW.state.lines, CREW.state.feeds.casual, CREW.state.score]))).toBe('[[],[],null]');
    expect(hits).toEqual([]);   // no scoreboard request without the flag
  });
});

test('scoreboard: the GET is polled while live, carries this session id, and is drawn as real Rules data with no Simulated badge', async ({ page }) => {
  await withApi({ board: () => ({ status: 200, body: BOARD }) }, async (api, hits) => {
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
    await expect(root.locator('.cs-badge.pre', { hasText: 'Rules-only' })).toBeVisible();
    await expect(root).toContainText('Accuracy is the share of aired numbers that were right');
    await expect(root).toContainText('The crew without the Verifier aired 3 wrong lines');
    expect(hits[0]).toMatch(/^\/v1\/matches\/m-k1\/scoreboard\?/);
    expect(sid(hits[0])).toBe(await page.evaluate(() => LV.key.session_id));
    // the table says Rules for a rules arm, Precomputed for a recorded one, and never Live
    await root.locator('summary').click();
    const rows = await root.locator('tbody tr').allInnerTexts();
    expect(rows[0]).toContain('Rules');
    expect(rows[2]).toContain('Precomputed');
    expect(rows.join(' ')).not.toContain('Live');
    expect(await page.evaluate(() => CREW.state.score.arms.full_crew.mode)).toBe('rules');
    await expect.poll(() => hits.length, { timeout: 10_000 }).toBeGreaterThan(1);           // it keeps polling
    expect(await page.evaluate(() => CREW.state.scoreSource)).toBe('api');
  });
});

test('scoreboard: a 404 says not available yet, then the scoreboard appears; a later 404 keeps the last good score and emits nothing', async ({ page }) => {
  let mode: 'none' | 'ok' | 'gone' = 'none';
  await withApi({ board: () => (mode === 'ok' ? { status: 200, body: BOARD } : { status: 404, body: { detail: 'no scoreboard' } }) }, async (api, hits) => {
    await openLive(page, api);
    await expect(page.locator('#crew-score')).toContainText('not available yet', { timeout: 30_000 });
    await expect(page.locator('#crew-score .cs-arm')).toHaveCount(0);
    mode = 'ok';
    await expect(page.locator('#crew-score .cs-arm')).toHaveCount(3, { timeout: 30_000 });
    await expect(page.locator('#crew-score')).not.toContainText('not available yet');
    mode = 'gone';
    await page.evaluate(() => { (window as any).__emits = 0; CREW.subscribe(() => { (window as any).__emits++; }); (window as any).__emits = 0; });
    const before = hits.length;
    await expect.poll(() => hits.length, { timeout: 15_000 }).toBeGreaterThan(before + 2);
    await expect(page.locator('#crew-score .cs-arm')).toHaveCount(3);
    expect(await page.evaluate(() => (window as any).__emits)).toBe(0);
    expect(await page.evaluate(() => CREW.state.scoreSource)).toBe('api');
  });
});

test('scoreboard: the not-available note stays across polls at a near-default gap and only clears for another match', async ({ page }) => {
  await withApi({ board: () => ({ status: 404 }) }, async (api, hits) => {
    await openLive(page, api, '?crew=1', true, 20_000);   // the first poll is immediate, the next is 20 s away
    await expect(page.locator('#crew-score')).toContainText('not available yet', { timeout: 30_000 });
    await after(page, 12);   // three one-second poller ticks and more
    await expect(page.locator('#crew-score')).toContainText('not available yet');
    expect(hits).toHaveLength(1);
    await page.evaluate(() => LV.begin('k2', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }));
    await expect.poll(() => hits.some((u) => u.includes('/m-k2/')), { timeout: 15_000 }).toBe(true);   // a new match polls at once, not 20 s later
  });
});

test('scoreboard: errors and junk bodies stay silent and the page keeps working', async ({ page }) => {
  const errs: string[] = [];
  page.on('pageerror', (e: any) => errs.push(String(e)));
  let mode = 0;
  await withApi({ board: () => (mode === 0 ? { status: 500 } : { status: 200, body: { arms: 'nope' } }) }, async (api, hits) => {
    await openLive(page, api);
    await expect.poll(() => hits.length, { timeout: 15_000 }).toBeGreaterThan(0);
    mode = 1;
    await expect.poll(() => hits.length, { timeout: 15_000 }).toBeGreaterThan(2);
    await expect(page.locator('#crew-score')).toContainText('Waiting for graded lines');
    expect(await page.evaluate(() => CREW.state.score)).toBeNull();
    expect(errs).toEqual([]);
  });
});

test('scoreboard: while the Simulated fixture is loaded no scoreboard is requested and its score stays Simulated', async ({ page }) => {
  await withApi({ board: () => ({ status: 200, body: BOARD }) }, async (api, hits, info) => {
    await openLive(page, api);
    await expect(page.locator('#crew-score .cs-arm')).toHaveCount(3, { timeout: 30_000 });
    await page.evaluate(() => CREW.play());
    await expect.poll(() => info.inflight, { timeout: 10_000 }).toBe(0);   // a request that was already in flight finishes
    const base = hits.length;
    await expect(page.locator('#ct-tree')).toHaveAttribute('data-done', 'true', { timeout: 15_000 });
    await after(page, 6);
    expect(hits.length).toBe(base);   // 400 ms poll interval, ~7 s of fixture: not one request
    await expect(page.locator('#crew-score .cs-badge.sim')).toHaveText('Simulated');
    expect(await page.evaluate(() => CREW.state.scoreSource)).toBe('fixture');
    expect(await page.evaluate(() => CREW.fetchScore())).toBe(false);
    // Reset hands the scoreboard back to the api
    await page.evaluate(() => CREW.reset());
    await expect.poll(() => hits.length, { timeout: 10_000 }).toBeGreaterThan(base);
    await expect(page.locator('#crew-score .cs-badge.sim')).toHaveCount(0);
  });
});

test('scoreboard: no polling unless the api match is live', async ({ page }) => {
  await withApi({ status: 'warming_up', board: () => ({ status: 200, body: BOARD }) }, async (api, hits, info) => {
    await openLive(page, api);
    await expect.poll(() => info.streams, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(await page.evaluate(() => LV.status)).toBe('warming');
    await after(page, 10);
    expect(hits).toEqual([]);
  });
});

test('scoreboard: a new match drops the old score, and Reset clears it', async ({ page }) => {
  let board: any = { status: 200, body: BOARD };
  await withApi({ board: () => board }, async (api, hits) => {
    await openLive(page, api);
    await expect(page.locator('#crew-score .cs-arm')).toHaveCount(3, { timeout: 30_000 });
    board = { status: 404 };
    await page.evaluate(() => LV.begin('k2', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }));
    await expect(page.locator('#crew-score .cs-arm')).toHaveCount(0, { timeout: 10_000 });
    expect(await page.evaluate(() => CREW.state.score)).toBeNull();
    await expect.poll(() => hits.some((u) => u.includes('/m-k2/scoreboard')), { timeout: 15_000 }).toBe(true);
    board = { status: 200, body: BOARD };
    await expect(page.locator('#crew-score .cs-arm')).toHaveCount(3, { timeout: 30_000 });
    await page.evaluate(() => CREW.reset());
    expect(await page.evaluate(() => CREW.state.score)).toBeNull();
  });
});

test('scoreboard: a slow response never overlaps the next poll, and a reply for a match that has changed is discarded', async ({ page }) => {
  // only the first match (m-k1) answers slowly; the second answers 404 at once
  let board: any = { status: 200, body: BOARD };
  await withApi({ delay: (u) => (u.includes('/m-k1/') ? 1500 : 0), board: () => board }, async (api, hits, info) => {
    await openLive(page, api);
    await expect.poll(() => hits.length, { timeout: 30_000 }).toBeGreaterThan(2);   // 400 ms polls against a 1.5 s reply
    expect(info.inflightMax).toBe(1);
    // switch the match while a reply is in flight: the old reply must not become the new match's score
    board = { status: 404 };
    await page.evaluate(() => CREW.reset());
    await page.evaluate(() => LV.begin('k3', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }));
    await expect.poll(() => hits.some((u) => u.includes('/m-k3/')), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => info.inflight, { timeout: 15_000 }).toBe(0);   // the old reply has come back and was dropped; m-k3 itself has no scoreboard
    expect(await page.evaluate(() => CREW.state.score)).toBeNull();
  });
});

test('scoreboard: the match and session ids are URL-encoded', async ({ page }) => {
  await withApi({ board: () => ({ status: 404 }) }, async (api, hits) => {
    await openLive(page, api);
    await page.evaluate(() => Object.defineProperty(LV, 'key', { get: () => ({ tenant_id: 'demo', session_id: 's&1 x', match_id: 'a b/é' }), configurable: true }));
    await expect.poll(() => hits.some((u) => u.startsWith('/v1/matches/a%20b%2F%C3%A9/scoreboard?session_id=s%261+x')), { timeout: 15_000 }).toBe(true);
  });
});

test('crew tree: attached to a match that already existed, it says the crew starts at the next moment and keeps the Simulated button', async ({ page }) => {
  await withApi({ createStatus: 409 }, async (api) => {
    await openLive(page, api);
    const empty = page.locator('#ct-empty');
    await expect(empty).toContainText('The crew starts at the next moment', { timeout: 30_000 });
    await expect(empty).not.toContainText('joined part-way');
    await expect(empty).toHaveAttribute('data-state', 'next-moment');
    await expect(page.locator('#ct-tree')).toBeHidden();
    await expect(page.locator('#ct-sim')).toBeHidden();   // no fixture data, so no Simulated badge
    await expect(page.getByRole('button', { name: 'Play Simulated goal' })).toBeVisible();
    // pressing Play never flashes the mid-match text
    await page.evaluate(() => { (window as any).__seen = []; new MutationObserver(() => (window as any).__seen.push(document.getElementById('ct-empty')!.getAttribute('data-state'))).observe(document.getElementById('ct-empty')!, { attributes: true, childList: true, characterData: true, subtree: true }); });
    await page.getByRole('button', { name: 'Play Simulated goal' }).click();
    await expect(page.locator('#ct-tree')).toBeVisible();   // the fixture's first node has landed
    expect(await page.evaluate(() => (window as any).__seen)).not.toContain('next-moment');
    await expect(page.locator('#ct-sim')).toBeVisible();   // the fixture is loaded now
    // a real moment takes the place after a Reset
    await page.evaluate(() => { CREW.reset(); CREW.ingest({ kind: 'crew_ledger', schema_version: '1.3.0', stream: LV.key, moment_id: 'm-1', at_ms: 600000, called: ['analyst'], skipped: [], why: 'goal', routed_by: 'rules', spawn_reason: '' }); });
    await expect(empty).toBeHidden();
    await expect(page.locator('#ct-tree')).toBeVisible();
  });
});

test('crew tree: after the stream drops and reconnects it says the crew starts at the next moment', async ({ page }) => {
  await withApi({ endFirstStream: true }, async (api, _hits, info) => {
    await openLive(page, api);
    await expect.poll(() => info.streams, { timeout: 30_000 }).toBeGreaterThan(1);
    await expect(page.locator('#ct-empty')).toHaveAttribute('data-state', 'next-moment', { timeout: 10_000 });
  });
});

test('crew tree: the viewer who started the match is not told they joined late', async ({ page }) => {
  await withApi({}, async (api) => {
    await openLive(page, api);
    await expect.poll(() => page.evaluate(() => LV.status), { timeout: 30_000 }).toBe('live');
    await after(page, 9);
    await expect(page.locator('#ct-empty')).toHaveAttribute('data-state', 'idle');
    await expect(page.locator('#ct-empty')).toContainText('No moment yet');
  });
});

test('crew tree: with no api match the empty state is unchanged', async ({ page }) => {
  await page.route(/\/(watch|broadcast)\/index\.html/, (r: any) => r.abort());
  await page.goto('/index.html?crew=1#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof CREW !== 'undefined' && !!document.getElementById('ct-empty'), null, { timeout: 30_000 });
  await expect(page.locator('#ct-empty')).toContainText('No moment yet. Play a Simulated goal');
  await expect(page.locator('#ct-empty')).toHaveAttribute('data-state', 'idle');
});
