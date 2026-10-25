import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';

// EXP-8: captions match the line and still show when muted; audio is skipped for stale lines. Speech is stubbed.
declare const AG: any, VC: any;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__spoken = [];
    (window as any).SpeechSynthesisUtterance = function (this: any, t: string) { this.text = t; };
    Object.defineProperty(window, 'speechSynthesis', { value: { speak: (u: any) => { (window as any).__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 10); }, cancel() {} }, configurable: true });
  });
});

test('voice: captions match the spoken text; muted still captions; stale lines are not spoken', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  // muted by default: the caption shows, nothing is spoken
  await page.evaluate(() => VC.say('Goal for Thames Rovers (A One) at 10\'.'));
  await expect(page.locator('#vc-bar')).toHaveText('Goal for Thames Rovers (A One) at 10\'.');
  expect(await page.evaluate(() => (window as any).__spoken.length)).toBe(0);
  // voice on: the same text is spoken
  await page.click('#voice-btn');
  await expect(page.locator('#voice-btn')).toHaveText('Voice: on');
  await page.evaluate(() => VC.say('Thames Rovers 1–0 Coloso Ciudad.'));
  await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual(['Thames Rovers 1–0 Coloso Ciudad.']);
  await expect(page.locator('#vc-bar')).toHaveText('Thames Rovers 1–0 Coloso Ciudad.');
  await expect(page.locator('#voice-src')).toContainText('Browser voice (simulated)');
  // the same claim is spoken once
  await page.evaluate(() => { VC.say('Once.', { id: 'c9' }); VC.say('Once.', { id: 'c9' }); });
  await expect.poll(() => page.evaluate(() => (window as any).__spoken.filter((t: string) => t === 'Once.').length)).toBe(1);
  // a line older than 5 s shows but is not spoken
  await page.evaluate(() => VC.say('Old line.', { at: Date.now() - 6000 }));
  await expect(page.locator('#vc-bar')).toHaveText('Old line.');
  expect(await page.evaluate(() => (window as any).__spoken.includes('Old line.'))).toBe(false);
  expect(errs).toEqual([]);
});

test('voice: a verified goal line from the agents is captioned', async ({ page }) => {
  await openShell(page, 'agents');
  await page.evaluate(() => {
    AG.setMode('demo');   // the caption is about the voice: a line waiting for approval is not spoken (producer.spec covers the gate)
    AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.onWatch('k1', [{ minute: 10.1, type: 'goal', team: 'thr', player: 'A One', score: '1-0', data: {} }], []);
  });
  await expect(page.locator('#vc-bar')).toContainText('A One');
});
