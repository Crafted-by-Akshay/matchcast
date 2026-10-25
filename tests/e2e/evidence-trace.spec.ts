import { test, expect, type Page } from './fixtures';
import { collectErrors } from './helpers';

declare const AG: any; declare const TP: any; declare const MCC: any;

// CREW-6.2 (AB#444): "How was this made?" can list, for an aired line, the agents, the tool calls, the data rows (match events and history rows) and the audit hashes behind it.
// It is built behind ?evidence=1 until the api carries claim-level evidence (AB#498); a line from the rules agents has everything in the page.
async function openEvidence(page: Page, query: string) {
  await page.goto('/index.html' + query + '#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof AG !== 'undefined' && typeof TP !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => {
    AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.onWatch('k1', [{ minute: 12.3, type: 'shot', team: 'thr', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'open play', data: {} }, { minute: 12.4, type: 'goal', team: 'thr', player: 'A One', score: '1-0' }], []);
  });
  await expect.poll(() => page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.kind === 'score'); return !!c && c.audit.length >= 3; }), { timeout: 15_000 }).toBe(true);
  return page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.kind === 'score'); TP.open(c.id); return c.id as string; });
}

test('evidence trace: a line lists its agents, tool calls, event rows, history rows and audit hashes', async ({ page }) => {
  const errs = collectErrors(page);
  await openEvidence(page, '?evidence=1');
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev).toBeVisible();
  for (const a of ['producer', 'analyst', 'narrator', 'verifier']) await expect(ev.locator('.tp-agents')).toContainText(a);
  await expect(ev.locator('.tp-tools')).toContainText('event_log.goals');
  await expect(ev.locator('.tp-tools')).toContainText('score_counter');
  const row = ev.locator('.tp-rows li').first();
  await expect(row).toContainText("12'");
  await expect(row).toContainText('goal');
  await expect(row).toContainText('A One');
  await expect(ev.locator('.tp-history')).toContainText('Planned');   // history rows (CREW-2.2) are not built: the panel says so instead of inventing any
  const hashes = ev.locator('.tp-audit li');
  expect(await hashes.count()).toBeGreaterThanOrEqual(3);
  await expect(hashes.first()).toContainText('matches the chain record');
  const shown = await hashes.evaluateAll((els) => els.map((e) => ({ ok: e.classList.contains('ok'), seq: Number(/#(\d+)/.exec(e.textContent || '')![1]), hash: e.querySelector('code')!.textContent })));
  const chain = await page.evaluate(() => MCC.records().map((r: any) => r.hash.slice(0, 12)));
  for (const h of shown) { expect(h.ok, 'row #' + h.seq).toBe(true); expect(h.hash, 'hash of #' + h.seq).toBe(chain[h.seq - 1]); }
  await expect(ev.locator('.tp-chain')).toContainText(/Chain intact: \d+ records/, { timeout: 10_000 });
  expect(errs).toEqual([]);
});

test('evidence trace: a hash that is not in the audit chain is marked, not hidden', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  await page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.kind === 'score'); c.audit[0].hash = 'deadbeef0000'; TP.open(c.id); });
  await expect(page.locator('#tp .tp-audit li').first()).toContainText('no matching chain record');
});

test('evidence trace: without the flag the panel is unchanged', async ({ page }) => {
  await openEvidence(page, '');
  await expect(page.locator('#tp')).toBeVisible();
  await expect(page.locator('#tp .tp-evidence')).toHaveCount(0);
  expect(await page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.kind === 'score'); const probe = document.createElement('div'); probe.innerHTML = TP.html(c); return document.querySelector('#tp .tp-b')!.innerHTML === probe.innerHTML; })).toBe(true);
});

test('evidence trace: a line from the api says what is not sent yet instead of showing a guess', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  await page.evaluate(() => {
    AG.ingest({ claim_id: 'api-1', metric: 'goals', value: 1, units: 'count', approval_status: 'approved' }, 'live');
    TP.open('api-1');
  });
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev).toBeVisible();
  await expect(ev).toContainText('Planned (AB#498)');
  await expect(ev.locator('.tp-agents')).toContainText('Planned (AB#498)');
  await expect(ev.locator('.tp-tools')).toContainText('Planned (AB#498)');
  await expect(ev.locator('.tp-rows li')).toHaveCount(0);
});

test('evidence trace: a tampered chain says where it breaks, and a running total says it cites no single event', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  await page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.kind === 'xg_total'); MCC.records()[0].detail = { tampered: true }; TP.open(c.id); });
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-chain')).toContainText(/Chain broken at record #1/, { timeout: 10_000 });
  await expect(ev).toContainText('cites no single event');
});

test('evidence trace: an unknown event id, a history row and a hostile name are shown honestly and escaped', async ({ page }) => {
  await openEvidence(page, '?evidence=1');
  await page.evaluate(() => {
    const c = AG.run.claims.find((x: any) => x.kind === 'score');
    c.evidence = ['e2', 'e99']; c.history = [{ label: 'Head-to-head <b>x</b>', value: '3 wins', dataset: 'synthetic' }];
    AG.run.events.find((e: any) => e.id === 'e2').player = '<img src=x onerror=window.__xss=1>';
    TP.open(c.id);
  });
  const ev = page.locator('#tp .tp-evidence');
  await expect(ev.locator('.tp-rows li').nth(1)).toContainText('not in the event log');
  await expect(ev.locator('.tp-history')).toContainText('Head-to-head <b>x</b> 3 wins');
  await expect(ev.locator('.tp-history')).not.toContainText('Planned');
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
  await expect(ev.locator('.tp-rows li').first()).toContainText('<img src=x');
});
