import { test, expect } from './fixtures';
import { collectErrors, openShell, ready } from './helpers';

// AGT-8 tasks 105/106: the full-time recap shows in Watch and Broadcast and can be read aloud through the api's voice route.
// Shell-driven, as in ask-talk.spec.ts: the api and the voice are stubbed in the page.
declare const LV: any; declare const VC: any; declare const RECAP: any;
declare function loadRecap(): void; declare function paintRecap(): void;

const stubApi = (page) => page.evaluate(() => {
  Object.defineProperty(LV, 'enabled', { get: () => true });
  Object.defineProperty(LV, 'key', { get: () => ({ session_id: 's', match_id: 'm' }) });
  Object.defineProperty(LV, 'status', { get: () => 'live' });
  const asked: string[] = [];
  (window as any).__asked = asked;
  LV.recap = async (p: string) => { asked.push(p); return { text: p + ' recap: Thames Rovers beat Coloso Ciudad.', sentences: 3, mode: 'rules', audioUrl: 'http://api.test/v1/matches/m/recap/' + p + '/audio.mp3?session_id=s' }; };
  const said: any[] = [];
  (window as any).__said = said;
  VC.say = (text: string, o: any) => said.push({ text, audio: o && o.audio });
  loadRecap();
});

test('recap: Watch shows the casual recap and Broadcast the broadcast one, with an honest label', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);   // Watch's own start resets the card, so stub after it
  await stubApi(page);
  const card = page.locator('#recap');
  await expect(card).toBeVisible();
  await expect(card).toContainText('casual recap');
  await expect(page.locator('#recap-m')).toContainText('3 verified sentences, Rules fallback');
  await page.keyboard.press('5');   // 5 is Broadcast on main's view keys (3 is Watch)
  await expect(card).toContainText('broadcast recap');
  expect(await page.evaluate(() => (window as any).__asked.sort())).toEqual(['broadcast', 'casual']);
  expect(errs).toEqual([]);
});

test('recap: Listen speaks the recap from the api voice route when Voice is on, and Close hides the card', async ({ page }) => {
  await openShell(page, 'watch');
  await ready('watch')(page);   // Watch's own start resets the card, so stub after it
  await stubApi(page);
  await expect(page.locator('#recap')).toBeVisible();
  await page.evaluate(() => Object.defineProperty(VC, 'on', { get: () => false, configurable: true }));
  await page.locator('#recap-listen').click();
  // Voice off: no recap audio is spoken (the live feed may still say its own lines while Voice was on by default)
  expect((await page.evaluate(() => (window as any).__said)).filter((x: any) => x.audio)).toEqual([]);
  await page.evaluate(() => Object.defineProperty(VC, 'on', { get: () => true, configurable: true }));
  await page.locator('#recap-listen').click();
  // Voice on lets the live feed speak too (its own lines go through the same say), so only the recap's audio is checked here
  const said = (await page.evaluate(() => (window as any).__said)).filter((s: any) => s.audio);
  expect(said).toHaveLength(1);
  expect(said[0].audio).toContain('/recap/casual/audio.mp3');
  await page.locator('#recap-close').click();
  await expect(page.locator('#recap')).toBeHidden();
});

test('recap: no request and no card without the live api', async ({ page }) => {
  await openShell(page, 'watch');
  await ready('watch')(page);
  await page.evaluate(() => { (window as any).__asked = []; LV.recap = async (p: string) => { (window as any).__asked.push(p); return null; }; loadRecap(); });
  await expect(page.locator('#recap')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__asked)).toEqual([]);
});
