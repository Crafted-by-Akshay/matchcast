import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import Ajv from 'ajv';
import { test, expect } from './fixtures';
import { openShell, ready, stepSim, viewFrame } from './helpers';

// The api's half-time explainer fires on a period_boundary {ended} in period 1 and the full-time recap on the final one (packages/agents, services/recap).
// Watch's engine says half_time and full_time as data events; the shell sends each to the api once, as a contract period_boundary, in order after the events before it.
// The api is a local server that records the POSTed events. No live Azure or Foundry call; no fixed waits: every wait polls for state.
declare const LV: any;
test.skip(!!process.env.E2E_BASE_URL, 'PR checks only: a fixture api takes the events');

const schema = JSON.parse(readFileSync(resolve(__dirname, '../../packages/contracts/matchcast_contracts/schemas/v1.json'), 'utf8'));
const validate = new Ajv({ strict: false, allErrors: true }).compile({ ...schema, oneOf: undefined, $ref: '#/definitions/EventEnvelope' });

test('period_boundary: one ended boundary at half time and one at full time, once, after the events before it', async ({ page }) => {
  test.setTimeout(600_000);
  const got: any[] = [];
  const sockets = new Set<any>();
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') {
        let b = ''; q.on('data', (c) => (b += c));
        q.on('end', () => {
          if (/\/events/.test(q.url!) && !/\.vision/.test(q.url!)) { try { got.push(...JSON.parse(b).events); } catch (e) { /* not events */ } }
          r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}');
        });
        return;
      }
      if (/\/stream/.test(q.url!)) { r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"live"}\n\n'); return; }
      r.writeHead(404, cors); r.end();
    });
    s.on('connection', (sock) => { sockets.add(sock); sock.on('close', () => sockets.delete(sock)); });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const api = 'http://127.0.0.1:' + (server.address() as any).port;
    await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
    await page.route('**/broadcast/**', (r) => r.abort());   // Watch must load here; a second 3D engine is not needed
    await openShell(page, 'watch');
    await ready('watch')(page);
    const w = await viewFrame(page, 'watch');
    const bounds = () => got.filter((e) => e.payload.type === 'period_boundary');
    const flags = () => w.evaluate(() => { const S = (window as any).__mc.S; return { ht: !!S.ht || S.half >= 2, over: !!S.over, half: S.half }; });

    // first half, up to the whistle: the engine holds at half-time (S.ht) and then starts the second half, so either counts
    await expect.poll(async () => { await stepSim(w, 3000); return (await flags()).ht; }, { timeout: 300_000 }).toBe(true);
    await expect.poll(() => bounds().length, { timeout: 30_000 }).toBe(1);
    const ht = bounds()[0];
    expect(ht).toMatchObject({ kind: 'event', revision: 0, payload: { type: 'period_boundary', boundary: 'ended' }, clock: { period: 1 } });
    expect(ht.event_id).toBe('e' + ht.stream_sequence);
    expect(ht.clock.period_elapsed_ms).toBe(ht.event_time_ms);
    expect(ht.event_time_ms).toBeGreaterThanOrEqual(45 * 60000);
    expect(validate(ht), JSON.stringify(validate.errors)).toBe(true);
    const beforeHt = got.filter((e) => e.stream_sequence < ht.stream_sequence);
    expect(beforeHt.length, 'the first half sent events before the whistle').toBeGreaterThan(0);
    expect(beforeHt.every((e) => e.clock.period === 1), 'first-half stoppage time stays period 1').toBe(true);

    // a pause, a resume and a stream reopen (language, persona) do not send it again
    await w.evaluate(() => { const m = (window as any).__mc; m.S.paused = true; });
    await page.evaluate(() => { LV.persona('analyst', 'fr'); LV.persona('fan', 'en'); });
    await w.evaluate(() => { const m = (window as any).__mc; m.S.paused = false; });

    // second half to full time
    // (the engine's own abandonment, a lightning delay over two hours, also ends the match; one before half time is a full_time that sends nothing, so wait on the boundary itself)
    await expect.poll(async () => { await stepSim(w, 3000); return bounds().length; }, { timeout: 400_000 }).toBe(2);
    const ft = bounds()[1];
    expect(ft).toMatchObject({ kind: 'event', revision: 0, payload: { type: 'period_boundary', boundary: 'ended' }, clock: { period: 2 } });
    expect(ft.clock.period_elapsed_ms).toBe(ft.event_time_ms - 45 * 60000);
    expect(ft.event_time_ms).toBeGreaterThan(ht.event_time_ms);
    expect(validate(ft), JSON.stringify(validate.errors)).toBe(true);
    expect(ft.stream_sequence).toBeGreaterThan(ht.stream_sequence);
    expect(got.filter((e) => e.stream_sequence > ht.stream_sequence && e.stream_sequence < ft.stream_sequence).every((e) => e.clock.period === 2), 'second-half events are period 2').toBe(true);
    // (stepSim keeps stepping the engine past the whistle, so events after full time are the harness's, not the shell's; only a repeat boundary would be a bug)

    // nothing else arrives late: still exactly one of each, and the sequences are unique and ordered
    await stepSim(w, 600);
    await expect.poll(() => bounds().length, { timeout: 5_000 }).toBe(2);
    const seqs = got.map((e) => e.stream_sequence);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  } finally {
    sockets.forEach((x) => x.destroy());
    await new Promise<void>((res) => server.close(() => res()));
  }
});

test('period_boundary: a new match starts again, and a full time with no half time sends nothing', async ({ page }) => {
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="http://127.0.0.1:1";' }));   // nothing answers: the packets stay queued for the test to read
  await openShell(page, 'agents');
  const out = await page.evaluate(() => {
    const roster = { teams: ['Harbour United', 'Travel Town'], players: [{ name: 'A One', team: 'Harbour United' }] };
    const run = (key: string, evs: any[]) => { LV.begin(key, roster); LV.events(evs); return LV.queued.filter((p: any) => p.payload.type === 'period_boundary').map((p: any) => [p.payload.boundary, p.clock.period]); };
    const a = run('k1', [{ minute: 47.2, type: 'half_time', score: '0-0' }, { minute: 47.4, type: 'half_time', score: '0-0' }, { minute: 94, type: 'full_time', score: '0-0' }, { minute: 95, type: 'full_time', score: '0-0' }]);
    const b = run('k2', [{ minute: 47.2, type: 'half_time', score: '1-0' }]);
    const c = run('k3', [{ minute: 12, type: 'full_time', score: '0-0', reason: 'Abandoned: waterlogged pitch' }]);
    return { a, b, c };
  });
  expect(out.a, 'each boundary once per match').toEqual([['ended', 1], ['ended', 2]]);
  expect(out.b, 'a new match resets the latch').toEqual([['ended', 1]]);
  expect(out.c, 'an abandonment before half time is not a second-half full time').toEqual([]);
});
