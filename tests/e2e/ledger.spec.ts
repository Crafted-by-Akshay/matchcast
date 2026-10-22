import { test, expect } from './fixtures';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { collectErrors, openShell } from './helpers';

// EXP-10: the claims ledger in the Agents tab. Driven the way Watch drives the shell (see connection.spec.ts).
declare const AG: any;

test('ledger: newest first, filters, provenance, CSV export with a matching SHA-256', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.evaluate(() => {
    const key = 'k1'; AG.reset(key, { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.onWatch(key, [{ minute: 10.1, type: 'goal', team: 'thr', player: 'A One', score: '1-0', data: {} }], []);
    AG.onWatch(key, [{ minute: 33.3, type: 'shot', team: 'cco', player: 'C One', x: 90, y: 30, xg: 0.4, kind: 'open play', data: { xg: 0.4, kind: 'open play' } }], []);
  });
  const rows = page.locator('#ag-claims tr[data-id]');
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(2);
  // newest first: the shot at 33' is above the goal at 10'
  const times = await rows.locator('td:first-child').allTextContents();
  expect(times.indexOf("33'")).toBeLessThan(times.indexOf("10'"));
  // columns carry metric, value, units
  await expect(page.locator('#ag-claims')).toContainText('shot_xg');
  await expect(page.locator('#ag-claims')).toContainText('1–0');
  // filters
  await page.selectOption('#lg-metric', 'score');
  expect(await rows.count()).toBe(1);
  await page.selectOption('#lg-metric', '');
  // provenance opens from a row
  await rows.first().click();
  await expect(page.locator('#ag-prov')).toContainText('Evidence');
  // export: the shown hash equals the file's SHA-256
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#lg-export')]);
  const file = readFileSync(await dl.path());
  const sha = createHash('sha256').update(file).digest('hex');
  await expect(page.locator('#lg-hash')).toContainText(sha);
  expect(file.toString().split('\n')[0]).toBe('time,metric,value,units,agent,source,verdict,reason,approval');
  expect(errs).toEqual([]);
});
