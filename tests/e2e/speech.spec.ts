import { test, expect } from '@playwright/test';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// EXP-8/EXP-16: Azure Speech through the api's short-lived token. The api and the SDK are faked; the browser voice stays the fallback and keeps its label.
declare const VC: any, SPX: any, AG: any, answerAsk: any;

const fakeSdk = () => {
  const w = window as any; w.__azure = { voices: [], texts: [], tokens: [], heard: 0 };
  w.SpeechSDK = {
    SpeechConfig: { fromAuthorizationToken: (t: string, r: string) => { w.__azure.tokens.push([t, r]); return { t, r }; } },
    ResultReason: { SynthesizingAudioCompleted: 1, RecognizedSpeech: 2 },
    AudioConfig: { fromDefaultMicrophoneInput: () => ({}), fromSpeakerOutput: (d: any) => ({ dest: d }) },
    SpeakerAudioDestination: function (this: any) { this.pause = () => {}; this.close = () => {}; },
    SpeechSynthesizer: function (this: any, c: any, a: any) { this.close = () => {}; this.speakTextAsync = (t: string, ok: any) => { w.__azure.voices.push(c.speechSynthesisVoiceName); w.__azure.texts.push(t); ok({ reason: 1 }); setTimeout(() => a.dest.onAudioEnd(), 30); }; },
    SpeechRecognizer: function (this: any) { this.close = () => {}; this.recognizeOnceAsync = (ok: any) => { w.__azure.heard++; ok({ reason: 2, text: 'who is on the ball' }); }; },
  };
  w.__spoken = [];
  (window as any).SpeechSynthesisUtterance = function (this: any, t: string) { this.text = t; };
  Object.defineProperty(window, 'speechSynthesis', { value: { speak: (u: any) => { w.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 10); }, cancel() {} }, configurable: true });
};

test('speech: with a token Azure speaks with the role and language voice; the browser voice is labelled when there is none', async ({ page }) => {
  const errs = collectErrors(page);
  await page.addInitScript(fakeSdk);
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
  await page.addInitScript(fakeSdk);
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
  await page.addInitScript(fakeSdk);
  await openShell(page, 'agents');
  await page.click('#tab-broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await page.evaluate(() => { SPX.listen = async () => 'who is on the ball'; });
  await bc.evaluate(() => { (window as any).__submitted = []; document.getElementById('dk-askf')!.addEventListener('submit', (e) => { e.stopImmediatePropagation(); e.preventDefault(); (window as any).__submitted.push((document.getElementById('dk-q') as HTMLInputElement).value); }, true); });
  await bc.locator('.mcx-ptt').dispatchEvent('pointerdown');
  await expect.poll(() => bc.evaluate(() => (window as any).__submitted)).toEqual(['who is on the ball']);

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
  await page.addInitScript(() => { (window as any).SpeechRecognition = class { start() { /* browser mic */ } stop() { /* */ } }; });
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
  await expect.poll(() => w.evaluate(() => document.getElementById('tk-mic')!.classList.contains('live'))).toBe(true);
  expect(errs).toEqual([]);
});
