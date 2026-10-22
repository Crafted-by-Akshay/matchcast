import { test, expect } from '@playwright/test';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// EXP-5: a typed question is answered by the agents from the event log, or abstains. Shell-driven, as in connection.spec.ts.
declare const AG: any; declare function answerAsk(id: number, q: string): Promise<void>;

const seed = (page) => page.evaluate(() => {
  AG.reset('k1', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' });
  const sh = (m: number, team: string, player: string) => ({ minute: m, type: 'shot', team, player, x: 90, y: 30, xg: 0.1, kind: 'open play', data: { xg: 0.1, kind: 'open play' } });
  AG.onWatch('k1', [sh(5, 'ars', 'A One'), sh(9, 'ars', 'A One'), sh(12, 'che', 'C One'), sh(20, 'ars', 'A One'), sh(31, 'che', 'C One')], []);
});

test('ask: the player with the most shots, a verified tick, from the event log; an unknown question abstains', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await seed(page);
  const a = await page.evaluate(() => AG.ask('who has the most shots?'));
  expect(a.verdict).toBe('verified');
  expect(a.text).toContain('A One');
  expect(a.text).toContain('3');
  expect(a.citations.length).toBe(3);
  const b = await page.evaluate(() => AG.ask('what colour are the corner flags?'));
  expect(b.verdict).toBe('abstained');
  expect(b.text).toBe("I can't confirm that from the match data yet.");
  expect(errs).toEqual([]);
});

test('ask: five questions a minute, then a polite refusal', async ({ page }) => {
  await openShell(page, 'agents');
  await seed(page);
  const answers = await page.evaluate(async () => {
    const got: any[] = [];
    (window as any).post = (_v: string, m: any) => got.push(m.answer);
    for (let i = 1; i <= 6; i++) await answerAsk(i, 'who has the most shots?');
    return got;
  });
  expect(answers.slice(0, 5).every((x: any) => x.verdict === 'verified')).toBe(true);
  expect(answers[5].note).toBe('rate limit');
});

test('ask: Watch sends the typed question to the shell and shows the checked answer', async ({ page }) => {
  await openShell(page, 'watch');
  await ready('watch')(page);
  const w = await viewFrame(page, 'watch');
  await page.evaluate(() => {
    AG.reset((AG.run && AG.run.key) || 'k1', (AG.run && AG.run.names) || { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' });
  });
  await seed(page);
  const key = await page.evaluate(() => AG.run.key);
  expect(key).toBe('k1');
  const a = await w.evaluate(() => (window as any).mcAsk('who has the most shots?'));
  expect(a.verdict).toBe('verified');
  expect(a.text).toContain('A One');
});


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
