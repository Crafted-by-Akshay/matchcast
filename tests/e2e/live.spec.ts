import { test, expect, type Page } from './fixtures';
import { openShell } from './helpers';

// Live run (E2E_BASE_URL, `make e2e-live`): the shell talks to the deployed api, Translator and Speech from a real browser.
// Skipped in PR checks, which never call Azure. Matches use fresh ids, so runs do not collide.
declare const AG: any, LV: any;
// E2E_BASE_URL runs against the deployed web; E2E_API runs the local build against the deployed api (to test a change before it is deployed)
const api = process.env.E2E_API;
test.skip(!process.env.E2E_BASE_URL && !api, 'live runs only (E2E_BASE_URL or E2E_API)');
test.beforeEach(({ page }) => api ? page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' })) : undefined);
test.setTimeout(240_000);

const begin = (page: Page, lang: string) => page.evaluate(async (l) => {
  const key = 'live-' + Math.random().toString(36).slice(2, 8);
  const names = { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' };
  AG.reset(key, names);
  LV.persona('fan', l);
  LV.begin(key, { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }, { name: 'C One', team: 'cco' }] });
  const batch = [{ minute: 12.3, type: 'shot', team: 'thr', player: 'A One', x: 92, y: 33, xg: 0.3, kind: 'open play', fate: 'goal', data: {} },
    { minute: 12.4, type: 'goal', team: 'thr', player: 'A One', score: '1-0', data: {} }];
  AG.onWatch(key, batch, []); LV.events(batch);
}, lang);

test('@live events reach the api and an API-Verified claim comes back', async ({ page }) => {
  await openShell(page, 'agents');
  await begin(page, 'en');
  await expect.poll(() => page.evaluate(() => AG.run.claims.some((c: any) => c.api && c.verdict === 'verified')), { timeout: 120_000, intervals: [1000] }).toBe(true);
  expect(await page.evaluate(() => (window as any).cardOf(AG.run.claims.find((c: any) => c.api)).api)).toBe(true);
});

test('@live Spanish variants come from Azure AI Translator and pass the re-check', async ({ page }) => {
  await openShell(page, 'agents');
  await begin(page, 'es');
  await expect.poll(() => page.evaluate(() => AG.run.claims.some((c: any) => c.tr && c.tr.es && c.tr.es.api && c.tr.es.ok)), { timeout: 120_000, intervals: [1000], message: 'no api Spanish variant arrived' }).toBe(true);
});

test('@live Ask is answered by the api with a verdict', async ({ page }) => {
  await openShell(page, 'agents');
  await begin(page, 'en');
  await expect.poll(() => page.evaluate(() => AG.run.claims.some((c: any) => c.api)), { timeout: 120_000, intervals: [1000] }).toBe(true);
  const a = await page.evaluate(() => LV.ask('Who scored?'));
  expect(typeof a.text).toBe('string');
  expect(['verified', 'abstained']).toContain(a.verdict);
});

test('@live the Speech token endpoint answers a browser (CORS) with a token or a clear 503', async ({ page }) => {
  await openShell(page, 'agents');
  const r = await page.evaluate(async () => { const x = await fetch(LV.base + '/v1/speech/token'); return { status: x.status, body: x.ok ? await x.json() : null }; });
  expect([200, 503]).toContain(r.status);
  if (r.status === 200) { expect(typeof r.body.token).toBe('string'); expect(r.body.region).toBeTruthy(); }
});
