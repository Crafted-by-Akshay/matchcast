
// EXP-16: push-to-talk. Speech recognition is faked; the real one needs a microphone and a browser that has it.
test('talk: holding the mic fills the box and submits it; no Speech key in the page', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).SpeechRecognition = class {
      lang = ''; onresult: any; onend: any; onerror: any;
      start() { /* listening */ }
      stop() { this.onresult({ results: [[{ transcript: 'how many shots have you had' }]] }); this.onend(); }
    };
  });
  await openShell(page, 'watch');
  await ready('watch')(page);
  const w = await viewFrame(page, 'watch');
  await w.evaluate(() => { (window as any).__submitted = []; document.getElementById('tk-form')!.addEventListener('submit', (e) => { e.preventDefault(); (window as any).__submitted.push((document.getElementById('tk-q') as HTMLInputElement).value); }); });
  const mic = w.locator('.mcx-ptt');
  await expect(mic).toHaveCount(1);
  await mic.dispatchEvent('pointerdown');
  await mic.dispatchEvent('pointerup');
  await expect.poll(() => w.evaluate(() => (window as any).__submitted)).toEqual(['how many shots have you had']);
  await expect(w.locator('.mcx-gm')).toContainText('Game mode');
  const html = await w.evaluate(() => document.documentElement.outerHTML);
  expect(html).not.toMatch(/subscription-?key|Ocp-Apim/i);
});
