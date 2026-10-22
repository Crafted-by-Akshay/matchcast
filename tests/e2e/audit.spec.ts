import { test, expect } from './fixtures';
import { createHash } from 'node:crypto';
import { collectErrors } from './helpers';

// EXP-12: Trust & audit reads the server's audit records and checks the hash chain in the page.
declare const LV: any;

const canon = (v: any): string => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v);
const chain = (n: number) => {
  const stream = { tenant_id: 'demo', session_id: 's1', match_id: 'm1' }; const out: any[] = []; let prev = '0'.repeat(64);
  for (let i = 1; i <= n; i++) {
    const r: any = { kind: 'audit_record', schema_version: '1.0.0', stream, audit_id: 'audit-' + i, sequence: i, time: '2026-10-22T10:00:0' + i + 'Z', actor_kind: 'agent', actor_id: 'verifier', action: 'line_verified', subject_id: 'c' + i, details: { n: i }, prev_hash: prev };
    r.hash = createHash('sha256').update(canon(r)).digest('hex'); prev = r.hash; out.push(r);
  }
  return out;
};

async function open(page, records: any[], status = 200) {
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="http://api.test";window.MATCHCAST_WARM_MS=2000;' }));
  await page.route('http://api.test/**', (rt) => {
    const u = rt.request().url();
    if (/\/audit/.test(u)) return rt.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ records }) });
    return rt.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' });
  });
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => LV.begin('k1', null));
}

test('audit: an intact server chain shows Chain intact and the record count', async ({ page }) => {
  const errs = collectErrors(page);
  await open(page, chain(4));
  await page.click('#ag-verify');
  await expect(page.locator('#ag-verify-out')).toContainText('Chain intact · 4 records · server');
  expect(errs.filter((e) => !/api\.test|EventSource|503/.test(e))).toEqual([]);
});

test('audit: a tampered record shows the first broken sequence', async ({ page }) => {
  const recs = chain(5); recs[2].details = { n: 99 };
  await open(page, recs);
  await page.click('#ag-verify');
  await expect(page.locator('#ag-verify-out')).toContainText('Chain broken at sequence 3 (hash_mismatch)');
});

test('audit: when the server cannot answer, the in-page chain is checked and labelled', async ({ page }) => {
  await open(page, [], 503);
  await page.click('#ag-verify');
  await expect(page.locator('#ag-verify-out')).toContainText('Server records not available');
  await expect(page.locator('#ag-verify-out')).toContainText('in-page (simulated)');
});

test('audit: a chain longer than one page is fetched in pages and counted in full', async ({ page }) => {
  const recs = chain(1003);
  await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API="http://api.test";window.MATCHCAST_WARM_MS=2000;' }));
  await page.route('http://api.test/**', (rt) => {
    const u = new URL(rt.request().url());
    if (!/\/audit/.test(u.pathname)) return rt.fulfill({ status: 503, headers: { 'Access-Control-Allow-Origin': '*' }, body: '{}' });
    const from = +(u.searchParams.get('from_seq') || 1);
    return rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ records: recs.slice(from - 1, from - 1 + 1000) }) });
  });
  await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
  await page.evaluate(() => LV.begin('k1', null));
  await page.click('#ag-verify');
  await expect(page.locator('#ag-verify-out')).toContainText('Chain intact · 1003 records · server');
});
