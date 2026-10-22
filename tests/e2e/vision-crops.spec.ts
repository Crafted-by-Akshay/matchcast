import { test, expect, type Page } from '@playwright/test';
import { collectErrors, openShell, ready, stepSim, viewFrame } from './helpers';

// DAT-11 task 275, browser side: torso crops for the api's OCR second opinion go through the shell to /vision/identify.
declare const LV: any;

async function liveShell(page: Page, seen: any[], answer: (body: any) => { status: number; json: object; headers?: object }) {
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="http://api.test";window.MATCHCAST_WARM_MS=2000;' }));
  await page.route('http://api.test/**', (r) => {
    const u = new URL(r.request().url()), cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (/\/stream$/.test(u.pathname)) return r.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body: 'event: status\ndata: {"status":"live"}\n\n' });
    if (/\/vision\/identify$/.test(u.pathname)) {
      const body = JSON.parse(r.request().postData() || '{}'); seen.push(body);
      const a = answer(body); return r.fulfill({ status: a.status, contentType: 'application/json', headers: { ...cors, ...(a.headers || {}) }, body: JSON.stringify(a.json) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{}' });
  });
  await openShell(page, 'watch');
  await ready('watch')(page);   // Watch's own start restarts the stream, so begin after it
  await page.evaluate(() => LV.begin('k1', null));
  await page.waitForFunction(() => LV.status === 'live', null, { timeout: 20_000 });
}

const relay = (w: any, id: number) => w.evaluate((n: number) => new Promise((res) => {
  const on = (e: MessageEvent) => { if (e.data && e.data.type === 'vision-ocr' && e.data.id === n) { window.removeEventListener('message', on); res(e.data); } };
  window.addEventListener('message', on);
  window.parent.postMessage({ src: 'matchcast', view: 'watch', type: 'vision-crop', id: n, track_id: 't9', team_hint: 'home', crop: 'iVBORw0KGgo=' }, '*');
}), id);

test('vision crop: the shell relays a crop to the api and returns the reading', async ({ page }) => {
  const seen: any[] = [];
  await liveShell(page, seen, () => ({ status: 200, json: { shirt: '9', confidence: 0.91, source: 'azure_read', elapsed_ms: 12 } }));
  const w = await viewFrame(page, 'watch');
  const r: any = await relay(w, 1);
  expect(r.result).toMatchObject({ shirt: '9', confidence: 0.91 });
  expect(seen[0]).toMatchObject({ crop: 'iVBORw0KGgo=', track_id: 't9', team_hint: 'home' });
  expect(typeof seen[0].session_id).toBe('string');
});

test('vision crop: a 429 comes back as rate_limited with its Retry-After, and no api means unavailable', async ({ page }) => {
  const seen: any[] = [];
  await liveShell(page, seen, () => ({ status: 429, json: { code: 'rate_limited' }, headers: { 'Retry-After': '7', 'Access-Control-Expose-Headers': 'Retry-After' } }));
  const w = await viewFrame(page, 'watch');
  const r: any = await relay(w, 2);
  expect(r).toMatchObject({ error: 'rate_limited', retry_after: 7 });
  await page.evaluate(() => LV.stop());
  expect(((await relay(w, 3)) as any).error).toBe('unavailable');
});

test('vision crop: Watch with Vision on sends valid 128x128 PNG crops, one at a time, and keeps the answers', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page), seen: any[] = [];
  await liveShell(page, seen, () => ({ status: 200, json: { shirt: '7', confidence: 0.88, source: 'azure_read', elapsed_ms: 9 } }));
  const w = await viewFrame(page, 'watch');
  await w.evaluate(() => { const b = document.getElementById('visb') as HTMLElement; if (b.getAttribute('aria-pressed') !== 'true') b.click(); });
  await w.evaluate(() => { Object.assign((window as any).mcOcrCfg, { minPx: 0, minHits: 2 }); });
  await stepSim(w, 1500);
  await expect.poll(async () => w.evaluate(() => JSON.stringify((window as any).mcOcrStats())), { timeout: 120_000 }).toMatch(/"answered":[1-9]/);
  const first = seen[0];
  expect(Buffer.from(first.crop, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  const png = Buffer.from(first.crop, 'base64');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([128, 128]);
  expect(png.length).toBeLessThanOrEqual(40 * 1024);
  expect(['home', 'away']).toContain(first.team_hint);
  const s: any = await w.evaluate(() => (window as any).mcOcrStats());
  expect(s.sent).toBeLessThanOrEqual(s.answered + 1);   // one in flight at a time
  expect(s.read).toBeGreaterThan(0);
  expect(await w.evaluate(() => (window as any).mcOcr.results.size)).toBeGreaterThan(0);
  expect(errs).toEqual([]);
});

// DAT-11 task 277: OCR text is accepted only as 1 or 2 digits, confidence 0.7 or more, on a number the track's team has.
// The tracker's own track objects are never written to; scoring uses the snapshot taken when the crop was sent.
test('vision combine: only a well-formed, confident, existing shirt number is accepted, and scoring is honest', async ({ page }) => {
  await openShell(page, 'watch');
  await ready('watch')(page);
  const w = await viewFrame(page, 'watch');
  const r: any = await w.evaluate(() => {
    const m: any = (window as any).mcOcr, P: any[] = (window as any).__mc.players, stats = () => (window as any).mcOcrStats();
    const home = P.filter((p) => p.ti === 0 && !p.off), away = P.filter((p) => p.ti === 1 && !p.off), nums = new Set(home.map((p) => String(p.num)));
    const missing = String([...Array(100).keys()].find((n) => !nums.has(String(n))));
    const onlyAway = away.find((p) => !nums.has(String(p.num)));
    const idx = (p: any) => P.indexOf(p), t = home[3];
    const at = (p: any, d = 0.3) => ({ id: 7, cls: 1, pid: -1, stable: 0, x: p.pos2.x + d, y: p.pos2.y });
    const out: any = { before: stats() };
    const k = at(t); Object.freeze(k);                                   // combine and snapshot must not write to a track
    out.snap = m.snapshot(k);
    out.format = [m.combine(out.snap, { shirt: 'A1', confidence: 0.99 }), m.combine(out.snap, { shirt: '123', confidence: 0.99 }), m.combine(out.snap, { shirt: null, confidence: 0 }), m.combine(out.snap, { shirt: '07', confidence: 0.99 })];
    out.low = m.combine(out.snap, { shirt: String(t.num), confidence: 0.69 });
    out.unknown = m.combine(out.snap, { shirt: missing, confidence: 0.95 });
    out.otherTeam = onlyAway ? m.combine(out.snap, { shirt: String(onlyAway.num), confidence: 0.95 }) : null;
    out.ok = m.combine(out.snap, { shirt: String(t.num), confidence: 0.7 });                       // glyph said -1, truth is t, OCR says t
    out.agree = m.combine(m.snapshot({ ...at(home[0]), pid: idx(home[0]) }), { shirt: String(home[0].num), confidence: 0.9 });   // glyph already right
    out.far = m.combine(m.snapshot(at(t, 5)), { shirt: String(t.num), confidence: 0.9 });          // no player within 1.5 m: accepted, not scorable
    out.hasOnlyAway = !!onlyAway; out.idx = idx(t); out.i0 = idx(home[0]); out.after = stats(); out.accepted = [...m.accepted.keys()];
    return out;
  });
  expect(r.snap).toMatchObject({ ti: 0, pid: -1, truth: r.idx });
  expect(r.format).toEqual([null, null, null, null]);
  expect(r.low).toBeNull(); expect(r.unknown).toBeNull(); expect(r.otherTeam).toBeNull();
  expect(r.ok).toBe(r.idx); expect(r.agree).toBe(r.i0); expect(r.far).toBe(r.idx);
  const d = (k: string) => r.after[k] - r.before[k];
  expect({ f: d('rejected_format'), c: d('rejected_confidence'), u: d('rejected_unknown_number'), a: d('accepted'), ag: d('agreed'), ch: d('changed'), sc: d('scored'), g: d('glyph_right'), o: d('ocr_right') })
    .toEqual({ f: 4, c: 1, u: r.hasOnlyAway ? 2 : 1, a: 3, ag: 1, ch: 2, sc: 2, g: 1, o: 2 });
});
