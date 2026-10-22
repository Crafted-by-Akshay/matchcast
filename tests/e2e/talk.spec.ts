import { test, expect } from '@playwright/test';
import { openShell, ready, viewFrame } from './helpers';

// EXP-16: push-to-talk for Ask the producer in Broadcast, and the Game mode label in Watch. Speech recognition is faked.
test('talk: holding the mic in Broadcast fills Ask the producer and submits it; orders are labelled Game mode', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).SpeechRecognition = class {
      lang = ''; onresult: any; onend: any; onerror: any;
      start() { /* listening */ }
      stop() { this.onresult({ results: [[{ transcript: 'what was the key moment' }]] }); this.onend(); }
    };
  });
  await openShell(page, 'broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await bc.evaluate(() => { (window as any).__submitted = []; document.getElementById('dk-askf')!.addEventListener('submit', (e) => { e.stopImmediatePropagation(); e.preventDefault(); (window as any).__submitted.push((document.getElementById('dk-q') as HTMLInputElement).value); }, true); });
  const mic = bc.locator('.mcx-ptt');
  await expect(mic).toHaveCount(1);
  await mic.dispatchEvent('pointerdown');
  await mic.dispatchEvent('pointerup');
  await expect.poll(() => bc.evaluate(() => (window as any).__submitted)).toEqual(['what was the key moment']);
  // only a short-lived token may ever reach the browser, never a Speech key
  expect(await bc.evaluate(() => document.documentElement.outerHTML)).not.toMatch(/subscription-?key|Ocp-Apim/i);
  await page.click('#tab-watch');
  await ready('watch')(page);
  const w = await viewFrame(page, 'watch');
  await expect(w.locator('.mcx-gm')).toContainText('Game mode');
});
