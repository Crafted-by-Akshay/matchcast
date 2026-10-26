import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import { openShell, ready, viewFrame } from './helpers';

// CREW-7.3 end-to-end check against a REAL api, run locally: the shell, Watch and the Catch me up block read GET /v1/matches/{id}/catch-me-up from an api
// process running the simulator's events in rules mode (no Azure or Foundry call). It is skipped in PR checks; scripts/check_catchmeup_real.sh starts the api and sets CATCHUP_API.
// The match is the ten-minute fixture (packages/agents/tests/fixtures/match-short.json, synthetic), posted to the match the shell created.
declare const CREW: any;
declare const LV: any;
declare const FR: any;
const API = process.env.CATCHUP_API || '';
test.skip(!API || !!process.env.E2E_BASE_URL, 'local check only: set CATCHUP_API (scripts/check_catchmeup_real.sh does)');

const FIXTURE = JSON.parse(readFileSync('packages/agents/tests/fixtures/match-short.json', 'utf8'));
const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'x';

test('the real route: 200 with the shape the block reads, 404-free path, the minute clamp, and the same text in the block as on the wire', async ({ page }) => {
  test.setTimeout(300_000);
  await page.route('**/config.js', (rt: any) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(API) + ';' }));
  await page.route('**/broadcast/**', (r: any) => r.abort());
  await page.addInitScript(() => { (window as any).MATCHCAST_CATCHUP_MS = 0; });
  await openShell(page, 'watch', '?crew=1');
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect(f.getByRole('radiogroup', { name: 'Feed' })).toBeVisible({ timeout: 60_000 });
  const players = Object.entries(FIXTURE.names as Record<string, string>).map(([id, name]) => ({ id, name, team: id.startsWith('home') ? 'home' : 'away' }));
  await page.evaluate((ps) => LV.begin('real1', { teams: ['home', 'away'], players: ps.map((p: any) => ({ name: p.name, team: p.team })) }), players);
  await expect.poll(() => page.evaluate(() => !!(LV.key && LV.base)), { timeout: 30_000 }).toBe(true);
  const key = await page.evaluate(() => LV.key);

  // the shell's match exists once the api accepted it; give it the fixture's events under the shell's player and ball ids
  const idOf: Record<string, string> = { 'ball-main': 'ball' };
  for (const p of players) idOf[p.id] = slug(p.name);
  const mapped = JSON.parse(JSON.stringify(FIXTURE.events), (_k, v) => (typeof v === 'string' && idOf[v] ? idOf[v] : v));
  for (const e of mapped) e.stream = key;
  await expect.poll(async () => (await page.request.get(`${API}/v1/matches/${key.match_id}/lines`, { params: { session_id: key.session_id } })).status(), { timeout: 30_000 }).toBeLessThan(500);
  for (let i = 0; i < mapped.length; i += 50) {
    const res = await page.request.post(`${API}/v1/matches/${key.match_id}/events`, { params: { session_id: key.session_id }, data: { events: mapped.slice(i, i + 50) } });
    expect(res.status(), await res.text()).toBe(202);
  }

  // the wire: what the route returns for minute 8, read straight from the api
  const wire = await page.request.get(`${API}/v1/matches/${key.match_id}/catch-me-up`, { params: { session_id: key.session_id, minute: '8' } });
  expect(wire.status(), await wire.text()).toBe(200);
  const body = await wire.json();
  expect(body).toMatchObject({ feed: 'catch_me_up', minute: 8 });
  expect(typeof body.text).toBe('string');
  expect(body.word_count).toBeLessThanOrEqual(280);
  expect(Number.isInteger(body.cut_sequence)).toBe(true);
  expect(Array.isArray(body.source_event_ids)).toBe(true);

  console.log('real recap at minute 8:', JSON.stringify({ text: body.text, word_count: body.word_count, cut_sequence: body.cut_sequence, events: body.source_event_ids.length }));
  // the block: pick the feed at minute 8 and read the same text, with the Verified count the route's source events give
  await page.evaluate(() => { Object.defineProperty(FR.watch, 'live', { configurable: true, get: () => ({ minute: 8 }), set: () => {} }); });
  await f.getByRole('radio', { name: /Catch me up/ }).click();
  const card = f.locator('#mc-feedlines');
  await expect(card.locator('.fp-cu-text')).toHaveText(body.text, { timeout: 30_000 });
  await expect(card).toContainText(`${body.word_count} words`);
  const n = new Set(body.source_event_ids).size;
  if (n > 0) await expect(card).toContainText(`Verified: recounted from ${n} event${n === 1 ? '' : 's'}`);
  else expect(await card.locator('.fp-verified').count()).toBe(0);

  // a minute past the end of the match is clamped to 200 by the client, so the api never sees a 422
  await page.evaluate(() => { Object.defineProperty(FR.watch, 'live', { configurable: true, get: () => ({ minute: 999 }), set: () => {} }); });
  const seen: string[] = [];
  page.on('request', (r) => { if (/catch-me-up/.test(r.url())) seen.push(new URL(r.url()).searchParams.get('minute') || ''); });
  await card.getByRole('button', { name: /Update/ }).click();
  await expect.poll(() => seen.length, { timeout: 30_000 }).toBe(1);
  expect(seen).toEqual(['200']);
  await expect(card.locator('.fp-cu-note')).toBeHidden();

  // lang (PR #424), with no Translator configured (the script unsets TRANSLATOR_ENDPOINT, so no Azure call is possible): the route answers 200 with the English recap and no variants,
  // 422 for a language outside the ten; the block, asked in Spanish, shows the English recap and says "Showing English", never "Translated". A real translation needs Azure Translator and is not covered here.
  const es = await page.request.get(`${API}/v1/matches/${key.match_id}/catch-me-up`, { params: { session_id: key.session_id, minute: '8', lang: 'es' } });
  expect(es.status(), await es.text()).toBe(200);
  const esBody = await es.json();
  expect(esBody.variants).toBeUndefined();
  expect(esBody.text).toBe(body.text);
  const bad = await page.request.get(`${API}/v1/matches/${key.match_id}/catch-me-up`, { params: { session_id: key.session_id, minute: '8', lang: 'xx' } });
  expect(bad.status()).toBe(422);
  await page.evaluate(() => { Object.defineProperty(FR.watch, 'live', { configurable: true, get: () => ({ minute: 8 }), set: () => {} }); });
  seen.length = 0;
  const langs: string[] = [];
  page.on('request', (r) => { if (/catch-me-up/.test(r.url())) langs.push(new URL(r.url()).searchParams.get('lang') || ''); });
  await page.evaluate(() => (window as any).setLang('es', null));
  await expect.poll(() => langs.length, { timeout: 30_000 }).toBe(1);
  expect(langs).toEqual(['es']);
  await expect(card).toContainText('Showing English', { timeout: 30_000 });
  await expect(card.locator('.fp-cu-text')).toHaveText(body.text);
  await expect(card).not.toContainText('Translated');
});
