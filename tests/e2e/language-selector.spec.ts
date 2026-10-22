import { test, expect } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// EXP-17: one EN/ES/HI selector in the shell drives Watch, Broadcast (graphics and desk script) and the voice; a line with no checked translation stays English.
declare const AG: any, VC: any, MCC: any, post: any;

test.beforeEach(({ page }) => page.addInitScript(() => { (window as any).MC_TEST = true; }));

test('language selector: voice speaks the checked translation, falls back to English, and the views follow', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.click('#tab-broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await page.click('#lang-sel button[data-lang="es"]');
  await expect(page.locator('#lang-sel button[data-lang="es"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => bc.evaluate(() => (window as any).__bcLang && (document.querySelector('#bc-lang button[aria-pressed="true"]') as HTMLElement).dataset.l)).toBe('es');
  // the desk's own buttons report back to the shell
  await bc.locator('#bc-lang button[data-l="hi"]').click();
  await expect(page.locator('#lang-sel button[data-lang="hi"]')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#lang-sel button[data-lang="es"]');

  // voice: the Spanish line is spoken with lang es; a line whose translation failed is spoken in English
  await page.evaluate(() => {
    const w = window as any; w.__said = []; const say = VC.say; VC.say = (t: string, o: any) => { w.__said.push([t, o.lang]); return say(t, o); };
    AG.reset('k1', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.onWatch('k1', [{ minute: 10.1, type: 'goal', team: 'thr', player: 'A One', score: '1-0', data: {} }], []);
  });
  await expect.poll(() => page.evaluate(() => (window as any).__said.length)).toBeGreaterThan(0);
  const said = await page.evaluate(() => (window as any).__said);
  expect(said.some(([t, l]: string[]) => l === 'es' && t.includes('Gol de'))).toBe(true);

  // on-air graphics: the checked translation, or English with a note when the line has none
  await page.evaluate(() => {
    post('broadcast', { src: 'matchcast-shell', type: 'air', line: { id: 'l1', minute: 10, text: 'Goal for Harbor City.', verdict: 'verified', tr: { es: { ok: true, text: 'Gol de Harbor City.' } } } });
    post('broadcast', { src: 'matchcast-shell', type: 'air', line: { id: 'l2', minute: 11, text: 'Corner.', verdict: 'verified', tr: { es: { ok: false, text: null } } } });
  });
  await expect.poll(() => bc.evaluate(() => document.getElementById('mc-tele')!.textContent)).toContain('Corner. (English: no checked ES translation)');
  expect(await bc.evaluate(() => document.getElementById('mc-tele')!.textContent)).toContain('Gol de Harbor City.');
  // an audit message that does not come from the Broadcast frame is ignored
  const before = await page.evaluate(() => MCC.records().length);
  await page.evaluate(() => window.postMessage({ src: 'matchcast', type: 'audit', action: 'translation_rejected', id: 'forged', lang: 'es', reason: 'x', minute: 1 }, '*'));   // not from the Broadcast frame
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => MCC.records().some((r: any) => r.ref === 'forged'))).toBe(false);
  expect(await page.evaluate(() => MCC.records().length)).toBeGreaterThanOrEqual(before);

  // a desk translation the check rejects is written to the audit chain by the shell
  await bc.evaluate(() => window.parent.postMessage({ src: 'matchcast', type: 'audit', action: 'translation_rejected', id: 'desk-12-goal', lang: 'es', reason: 'numbers differ', minute: 12 }, '*'));
  await expect.poll(() => page.evaluate(() => MCC.records().some((r: any) => r.action === 'translation_rejected' && r.ref === 'desk-12-goal'))).toBe(true);
  expect(errs).toEqual([]);
});
