import { test, expect } from '@playwright/test';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// QUA-2: what a viewer of the Broadcast desk can actually SEE. approval.spec.ts checks the queue logic; this checks the pixels' owners:
// the on-air graphics are visible on screen (not only un-hidden), appear only after approval in producer mode, and sit inside the live view.
declare const AG: any;

test('on-air graphics are visible, wait for approval in producer mode, and alerts are red', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.click('#tab-broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await page.click('#tab-agents');   // the Broadcast frame is display:none while another tab shows, so look at it from the Broadcast tab below
  await page.selectOption('#aq-mode', 'producer');
  await page.evaluate(() => {
    AG.reset('k2', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' });
    AG.onWatch('k2', [{ minute: 10.1, type: 'goal', team: 'ars', player: 'A One', score: '1-0', data: {} }], []);
  });
  await expect.poll(() => page.locator('#aq-list li[data-id]').count()).toBe(1);
  await page.click('#tab-broadcast');
  await expect(bc.locator('#mc-l3')).toBeHidden();
  await page.evaluate(() => AG.approve(AG.run.claims.find((c: any) => c.approval === 'pending').id, 'Sam Producer'));
  const l3 = bc.locator('#mc-l3');
  await expect(l3).toBeVisible({ timeout: 3000 });
  await expect(l3).toContainText("10'");
  await expect(bc.locator('#mc-tele')).toBeVisible();
  // both sit inside the live view, which is what the desk shows
  expect(await bc.evaluate(() => { const v = document.getElementById('bc-view')!; return v.contains(document.getElementById('mc-l3')) && v.contains(document.getElementById('mc-tele')); })).toBe(true);
  // a red card is an alert: red edge, 'verified' in the label
  await page.evaluate(() => AG.setMode('demo'));
  await page.evaluate(() => AG.onWatch('k2', [], [{ id: 'm9', minute: 55, type: 'red_card', title: 'Red card for C One', why: 'Chelsea down to ten men at 55\'.' }]));
  await expect(l3).toContainText('ALERT · Red card · verified', { timeout: 3000 });
  expect(await l3.evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe('rgb(255, 77, 77)');
  expect(errs).toEqual([]);
});
