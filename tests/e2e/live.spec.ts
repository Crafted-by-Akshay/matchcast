import { test, expect } from './fixtures';
import { openShell } from './helpers';

// QUA-9 task 313: read-only checks of the deployed web and api. They run only with E2E_BASE_URL (make e2e-live) and create nothing:
// no match, no event, no model call. The release check (docs/release-check.md) covers the rest by hand.
test.describe('@live deployed web and api', () => {
  test.skip(!process.env.E2E_BASE_URL, 'needs the deployed URL: make e2e-live E2E_BASE_URL=https://...');

  const apiOf = async (request: import('@playwright/test').APIRequestContext) => {
    const cfg = await (await request.get('/config.js')).text();
    const m = /MATCHCAST_API\s*=\s*"([^"]+)"/.exec(cfg);
    expect(m, 'config.js names the api').not.toBeNull();
    return m![1];
  };

  test('the shell loads cold and lists the season', async ({ page }) => {
    await openShell(page, 'watch');
    await expect(page.locator('#fx option')).not.toHaveCount(0);
    expect(await page.locator('#fx option').count()).toBeGreaterThan(20);
  });

  test('the api is healthy and ready', async ({ request }) => {
    const api = await apiOf(request);
    expect((await (await request.get(api + '/health')).json()).status).toBe('healthy');
    const ready = await (await request.get(api + '/ready')).json();
    expect(ready.status).toBe('ready');
    expect(ready.configuration.errors).toEqual([]);
  });

  test('/v1/status labels every dependency honestly', async ({ request }) => {
    const api = await apiOf(request);
    const res = await request.get(api + '/v1/status');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const deps: { key: string; status: string }[] = body.dependencies;
    expect(deps.length).toBeGreaterThan(8);
    for (const d of deps) expect(['live', 'simulated', 'planned', 'unavailable'], d.key).toContain(d.status);
    const by = Object.fromEntries(deps.map((d) => [d.key, d.status]));
    // Not connected, so never shown as live (CLAUDE.md: anything not really working is Simulated or Planned)
    for (const k of ['fabric', 'databricks']) if (k in by) expect(['simulated', 'planned'], k).toContain(by[k]);
    expect(body.counts.live + body.counts.simulated + body.counts.planned + body.counts.unavailable).toBe(deps.length);
    expect(body.counts.unavailable, 'no dependency is unavailable on the demo').toBe(0);
  });

  test('the producer gate holds without sign-in', async ({ request }) => {
    const api = await apiOf(request);
    const res = await request.post(api + '/v1/lines/none/approve', { data: {} });
    expect(res.status()).toBe(401);
  });
});
