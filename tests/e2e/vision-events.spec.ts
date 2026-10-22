import { test, expect, type Page } from './fixtures';
import { collectErrors, openShell, ready, stepSim, viewFrame } from './helpers';

// DAT-11 task 277 (events): the tracker's passes are posted as contract events on the separate stream `<session>.vision`.
declare const LV: any;

async function liveShell(page: Page, creates: any[], posts: any[], roster: object | null | undefined) {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="http://api.test";window.MATCHCAST_WARM_MS=2000;' }));
  await page.route('http://api.test/**', (r) => {
    const u = new URL(r.request().url()), cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (/\/stream$/.test(u.pathname)) return r.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body: 'event: status\ndata: {"status":"live"}\n\n' });
    if (r.request().method() === 'POST' && u.pathname === '/v1/matches') { creates.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status: 201, contentType: 'application/json', headers: cors, body: '{}' }); }
    if (r.request().method() === 'POST' && /\/events$/.test(u.pathname)) { posts.push({ session: u.searchParams.get('session_id'), body: JSON.parse(r.request().postData() || '{}') }); return r.fulfill({ status: 202, contentType: 'application/json', headers: cors, body: '{}' }); }
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
  });
  await openShell(page, 'watch');
  await ready('watch')(page);
  if (roster !== undefined) await page.evaluate((ro) => LV.begin('k1', ro), roster);   // undefined: keep the run Watch's own start made, with its real roster
  await page.waitForFunction(() => LV.status === 'live', null, { timeout: 20_000 });
}

const roster = { teams: ['Harbor', 'Coloso'], players: [{ name: 'Ana Lopez', team: 'Harbor' }, { name: 'Ben Ito', team: 'Harbor' }, { name: 'Cy Roe', team: 'Coloso' }, { name: 'Di Sol', team: 'Coloso' }] };
const pass = { type: 'pass', minute: 12.5, team: 'Harbor', from: 'Ana Lopez', to: 'Ben Ito', start: { x: 30, y: 20 }, end: { x: 41.5, y: 25 } };

test('vision events: a derived pass is posted on the .vision stream in its own match, never the engine stream', async ({ page }) => {
  const creates: any[] = [], posts: any[] = [];
  await liveShell(page, creates, posts, roster);
  const engine = await page.evaluate(() => LV.key.session_id);
  const w = await viewFrame(page, 'watch');
  await w.evaluate((p) => window.parent.postMessage({ src: 'matchcast', view: 'watch', type: 'vision-events', batch: [p, { ...p, minute: 50, from: 'Ben Ito', to: 'Ana Lopez' }, { type: 'carry', minute: 1 }] }, '*'), pass);
  await expect.poll(() => posts.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const vision = creates.find((c) => c.session_id.endsWith('.vision'));
  expect(vision.session_id).toBe(engine + '.vision');
  expect(vision.roster.stream.session_id).toBe(engine + '.vision');
  expect(vision.roster.players.map((p: any) => p.player_id)).toContain('ana-lopez');
  const sent = posts.filter((p) => p.session.endsWith('.vision'));
  expect(sent.length).toBe(1);
  const evs = sent[0].body.events;
  expect(evs).toHaveLength(2);   // the carry is not a pass and is dropped
  expect(evs[0]).toMatchObject({ kind: 'event', stream_sequence: 1, event_time_ms: 750000, clock: { period: 1, period_elapsed_ms: 750000 },
    stream: { session_id: engine + '.vision' }, payload: { type: 'pass', player_id: 'ana-lopez', recipient_player_id: 'ben-ito', team_id: 'harbor', start_position: { x: 30, y: 20, z: 0 }, end_position: { x: 41.5, y: 25, z: 0 } } });
  expect(evs[1]).toMatchObject({ stream_sequence: 2, clock: { period: 2, period_elapsed_ms: 300000 } });
  expect(posts.filter((p) => !p.session.endsWith('.vision'))).toEqual([]);   // nothing from this test lands on the engine stream
});

test('vision events: with no roster or no api nothing is posted', async ({ page }) => {
  const creates: any[] = [], posts: any[] = [];
  await liveShell(page, creates, posts, null);
  const w = await viewFrame(page, 'watch');
  await w.evaluate((p) => window.parent.postMessage({ src: 'matchcast', view: 'watch', type: 'vision-events', batch: [p] }, '*'), pass);
  await page.waitForTimeout(1000);
  expect(posts).toEqual([]);
});

test('vision events: passes between tracked players take the tracker's positions and reach the .vision stream in the pitch', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page), creates: any[] = [], posts: any[] = [];
  await liveShell(page, creates, posts, undefined);
  const w = await viewFrame(page, 'watch');
  await w.evaluate(() => { const b = document.getElementById('visb') as HTMLElement; if (b.getAttribute('aria-pressed') !== 'true') b.click(); });
  await stepSim(w, 200);
  await expect.poll(() => w.evaluate(() => (window as any).mcVisEvents().tracked), { timeout: 120_000 }).toBeGreaterThan(3);
  // the software-GL tracker takes minutes to see a real pass, so feed derive two passes between players it is tracking (the tracker's own pass list is covered by the scorer in vision-measure)
  const n = await w.evaluate(() => {
    const st = (window as any).mcVisEvents(), [a, b] = st.pids, other = st.pids.find((p: number) => p !== a && p !== b) ?? b;
    return (window as any).mcVisDerive([{ t: st.now + 1, t0: st.now, from: a, to: b, ok: true }, { t: st.now + 2, t0: st.now + 1, from: a, to: other, ok: false }]);
  });
  expect(n).toBe(1);   // the second is not a completed pass
  expect((await w.evaluate(() => (window as any).mcVisEvents())).skipped_other_team).toBe(1);
  await expect.poll(() => posts.filter((p) => p.session.endsWith('.vision')).length, { timeout: 20_000 }).toBeGreaterThan(0);
  const e = posts.filter((p) => p.session.endsWith('.vision'))[0].body.events[0];
  expect(e.payload.type).toBe('pass');
  for (const q of [e.payload.start_position, e.payload.end_position]) { expect(q.x).toBeGreaterThanOrEqual(0); expect(q.x).toBeLessThanOrEqual(105); expect(q.y).toBeGreaterThanOrEqual(0); expect(q.y).toBeLessThanOrEqual(68); }
  expect(e.payload.player_id).not.toBe(e.payload.recipient_player_id);
  expect(errs).toEqual([]);
});
