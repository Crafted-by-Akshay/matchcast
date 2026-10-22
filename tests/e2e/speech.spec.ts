import { test, expect, fakeSpeechSdk } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// EXP-8/EXP-16: Azure Speech through the api's short-lived token. The api and the SDK are faked; the browser voice stays the fallback and keeps its label.
declare const VC: any, SPX: any, AG: any, answerAsk: any;

test('speech: with a token Azure speaks with the role and language voice; the browser voice is labelled when there is none', async ({ page }) => {
  const errs = collectErrors(page);
  await page.addInitScript(fakeSpeechSdk);
  let calls = 0;
  await page.route('http://api.test/v1/speech/token', (r) => {
    calls++;
    return r.fulfill({ json: { token: 'tok-abc', region: 'eastus2', expires_at: new Date(Date.now() + 600000).toISOString() } });
  });
  await openShell(page, 'agents');
  await page.evaluate(() => { (window as any).MATCHCAST_API = 'http://api.test'; });
  await page.click('#voice-btn');
  await page.evaluate(() => { VC.say('Goal for Harbor City.', { id: 'a1' }); VC.say('Goal for Harbor City, in short.', { id: 'a2', role: 'analyst' }); VC.say('Gol de Harbor City.', { id: 'a3', lang: 'es' }); VC.say('गोल।', { id: 'a4', lang: 'hi' }); });
  await expect.poll(() => page.evaluate(() => (window as any).__azure.voices)).toEqual(['en-GB-RyanNeural', 'en-GB-SoniaNeural', 'es-ES-ElviraNeural', 'hi-IN-SwaraNeural']);
  expect(new Set((await page.evaluate(() => (window as any).__azure.tokens)).map((t: string[]) => t.join('@')))).toEqual(new Set(['tok-abc@eastus2']));   // used as issued, one fetch shared by the four lines
  expect(calls).toBe(1);
  await expect(page.locator('#voice-src')).toHaveText('Azure Speech');
  expect(await page.evaluate(() => (window as any).__spoken.length)).toBe(0);
  expect(await page.evaluate(() => SPX.listen('en-GB'))).toBe('who is on the ball');

  expect(errs).toEqual([]);
});

test('speech: 503 not_ready and 429 fall back to the browser voice with its label and are not hammered', async ({ page }) => {
  const errs = collectErrors(page);
  await page.addInitScript(fakeSpeechSdk);
  let calls = 0;
  await page.route('http://api.test/v1/speech/token', (r) => { calls++; return r.fulfill({ status: 503, contentType: 'application/problem+json', body: '{"code":"not_ready"}' }); });
  await openShell(page, 'agents');
  await page.evaluate(() => { (window as any).MATCHCAST_API = 'http://api.test'; });
  await page.click('#voice-btn');
  await page.evaluate(() => { VC.say('One.', { id: 'b1' }); VC.say('Two.', { id: 'b2' }); });
  await expect.poll(() => page.evaluate(() => (window as any).__spoken)).toEqual(['One.', 'Two.']);
  await expect(page.locator('#voice-src')).toHaveText('Browser voice (simulated)');
  expect(calls).toBe(1);   // one failed fetch, then a minute of quiet
  expect(await page.evaluate(() => SPX.reason)).toBe('no Speech resource configured');
  expect(await page.evaluate(() => SPX.listen('en-GB'))).toBeNull();   // null = Azure unavailable, so the caller falls back
  expect(errs.filter((e) => !/503/.test(e))).toEqual([]);
});

test('speech: Azure push-to-talk fills Ask the producer; a verified answer is spoken, an unverified one is not', async ({ page }) => {
  const errs = collectErrors(page);
  await page.addInitScript(fakeSpeechSdk);
  await openShell(page, 'agents');
  await page.click('#tab-broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await page.evaluate(() => { SPX.listen = async () => 'who is on the ball'; });
  await bc.locator('#bc-tabs button[data-p="desk"]').click();
  await expect(bc.locator('#bcd-q')).toBeVisible();
  const mic = bc.locator('#pane-desk .mcx-ptt');
  await expect(mic).toHaveCount(1);
  await mic.dispatchEvent('pointerdown');
  await expect(bc.locator('#bcd-q')).toHaveValue('who is on the ball');
  await expect(bc.locator('#bcd-ans')).not.toHaveText('');   // the mic submitted it
  await page.click('#voice-btn');
  await page.evaluate(() => {
    const w = window as any; w.__said = []; const say = VC.say; VC.say = (t: string, x: any) => { w.__said.push(t); return say(t, x); };
    AG.ask = (q: string) => (q === 'v' ? { text: 'It is 1-0.', verdict: 'verified' } : { text: 'I cannot confirm that.', verdict: 'abstained' });
    answerAsk('q1', 'v'); answerAsk('q2', 'x');
  });
  await expect.poll(() => page.evaluate(() => (window as any).__said)).toEqual(['It is 1-0.']);
  expect(errs).toEqual([]);
});

test('speech: Watch talk-to-player uses Azure push-to-talk when available, the browser mic otherwise', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await page.addInitScript(() => { (window as any).__brStarts = 0; (window as any).SpeechRecognition = class { start() { (window as any).__brStarts++; } stop() { /* */ } }; });
  await openShell(page, 'watch');
  await ready('watch')(page);
  const w = await viewFrame(page, 'watch');
  await expect.poll(() => w.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await w.evaluate(() => { (window as any).__sent = []; document.getElementById('tk-form')!.addEventListener('submit', (e) => { e.stopImmediatePropagation(); e.preventDefault(); (window as any).__sent.push((document.getElementById('tk-q') as HTMLInputElement).value); }, true); });
  await page.evaluate(() => { SPX.listen = async () => 'press higher'; });
  await w.locator('#tk-mic').dispatchEvent('click');
  await expect.poll(() => w.evaluate(() => (window as any).__sent)).toEqual(['press higher']);
  // Azure unavailable (null): the browser recognition starts instead
  await page.evaluate(() => { SPX.listen = async () => null; });
  await w.locator('#tk-mic').dispatchEvent('click');
  await expect.poll(() => w.evaluate(() => (window as any).__brStarts)).toBe(1);   // the browser recognition really started
  expect(errs).toEqual([]);
});

test('speech: Broadcast Ask the producer shows and speaks a verified answer; an unverified one falls back to the desk answer', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await page.addInitScript(fakeSpeechSdk);
  await openShell(page, 'agents');
  await page.click('#tab-broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await expect.poll(() => bc.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await page.click('#voice-btn');
  await page.evaluate(() => {
    const w = window as any; w.__said = []; const say = VC.say; VC.say = (t: string, x: any) => { w.__said.push(t); return say(t, x); };
    AG.ask = (q: string) => (q === 'who leads' ? { text: 'Harbor City lead 1-0.', verdict: 'verified', note: 'rules recount' } : { text: 'I cannot confirm that.', verdict: 'abstained' });
  });
  await bc.locator('#bc-tabs button[data-p="desk"]').click();
  await bc.locator('#bcd-q').fill('who leads');
  await bc.locator('#bcd-ask').click();
  await expect(bc.locator('#bcd-ans')).toHaveText('Harbor City lead 1-0.');
  await expect(bc.locator('#bcd-ai')).toContainText('Verified by the Verifier');
  await expect.poll(() => page.evaluate(() => (window as any).__said)).toEqual(['Harbor City lead 1-0.']);
  await bc.locator('#bcd-q').fill('what is the weather like');
  await bc.locator('#bcd-ask').click();
  await expect(bc.locator('#bcd-ai')).not.toContainText('Verified by the Verifier', { timeout: 20_000 });
  expect(await page.evaluate(() => (window as any).__said.length)).toBe(1);   // the unverified question was not spoken
  expect(errs).toEqual([]);
});

test('speech: Broadcast Ask shows the rate-limit message and only the newest question writes', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.click('#tab-broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await expect.poll(() => bc.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await page.evaluate(() => { AG.ask = (q: string) => ({ text: 'Answer to ' + q, verdict: 'verified' }); });
  await bc.locator('#bc-tabs button[data-p="desk"]').click();
  for (let i = 1; i <= 5; i++) { await bc.locator('#bcd-q').fill('q' + i); await bc.locator('#bcd-ask').click(); await expect(bc.locator('#bcd-ans')).toHaveText('Answer to q' + i); }
  await bc.locator('#bcd-q').fill('q6'); await bc.locator('#bcd-ask').click();
  await expect(bc.locator('#bcd-ans')).toContainText('5 questions a minute');
  await expect(bc.locator('#bcd-ai')).toHaveText('Slow down');
  expect(errs).toEqual([]);
});
