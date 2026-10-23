import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// QUA-2: what a viewer of the Broadcast desk can actually SEE. approval.spec.ts checks the queue logic; this checks the pixels' owners:
// the on-air graphics are visible on screen (not only un-hidden), appear only after approval in producer mode, and sit inside the live view.
declare const AG: any;
declare const VC: any;

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
    AG.reset('k2', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.onWatch('k2', [{ minute: 10.1, type: 'goal', team: 'thr', player: 'A One', score: '1-0', data: {} }], []);
  });
  await expect.poll(() => page.locator('#aq-list li[data-id]').count()).toBe(1);
  await page.click('#tab-broadcast');
  await expect(bc.locator('#mc-l3')).toBeHidden();
  // a forged 'air' message from inside the frame (not from the shell) must not put anything on air
  await bc.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { src: 'matchcast-shell', type: 'air', line: { id: 'forged', minute: 1, text: 'Forged line', verdict: 'verified' } } })));
  await page.waitForTimeout(500);
  await expect(bc.locator('#mc-l3')).toBeHidden();
  await expect(bc.locator('#mc-tele li')).toHaveCount(0);
  await page.evaluate(() => AG.approve(AG.run.claims.find((c: any) => c.approval === 'pending').id, 'Sam Producer'));
  const l3 = bc.locator('#mc-l3');
  await expect(l3).toBeVisible({ timeout: 3000 });
  await expect(l3).toContainText("10'");
  await expect(bc.locator('#mc-tele')).toBeVisible();
  // both sit inside the live view, which is what the desk shows
  expect(await bc.evaluate(() => { const v = document.getElementById('bc-view')!; return v.contains(document.getElementById('mc-l3')) && v.contains(document.getElementById('mc-tele')); })).toBe(true);
  // a red card is an alert: red edge, 'verified' in the label
  await page.evaluate(() => AG.setMode('demo'));
  await page.evaluate(() => AG.onWatch('k2', [], [{ id: 'm9', minute: 55, type: 'red_card', title: 'Red card for C One', why: 'Coloso Ciudad down to ten men at 55\'.' }]));
  await expect(l3).toContainText('ALERT · Red card · verified', { timeout: 3000 });
  expect(await l3.evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe('rgb(255, 77, 77)');
  expect(errs).toEqual([]);
});

// EXP-8: an approved line's audio_url (the api's Azure Speech clip) is played when Voice is on and never fetched when it is off; the caption shows either way.
test('voice: the api clip of an on-air line plays only with Voice on', async ({ page }) => {
  const clips: string[] = [];
  await page.route('**/clip-*.mp3', (rt) => { clips.push(new URL(rt.request().url()).pathname); rt.fulfill({ contentType: 'audio/mpeg', body: Buffer.alloc(64) }); });
  await openShell(page, 'agents');
  await page.evaluate(() => AG.reset('k3', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' }));
  const publish = (id: string) => page.evaluate((i) => AG.ingest({ publication_id: i, line_id: i, claim_ids: [], text: 'Rovers lead 1-0.', audio_url: '/clip-' + i + '.mp3' }, 'live'), id);
  await page.evaluate(() => VC.set(false));
  await publish('pub-a');
  await expect(page.locator('#vc-bar')).toContainText('Rovers lead 1-0.');   // captions always show
  await page.waitForTimeout(500);
  expect(clips, 'muted: the clip is not fetched').toEqual([]);
  await page.evaluate(() => VC.set(true));
  await publish('pub-b');
  await expect.poll(() => clips).toEqual(['/clip-pub-b.mp3']);
});
