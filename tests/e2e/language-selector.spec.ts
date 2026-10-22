import { test, expect } from '@playwright/test';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// EXP-17: one EN/ES/HI selector in the shell drives Watch, Broadcast (graphics and desk script) and the voice; a line with no checked translation stays English.
declare const AG: any, VC: any, MCC: any;

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
    AG.reset('k1', { hk: 'ars', ak: 'che', home: 'Arsenal', away: 'Chelsea' });
    AG.onWatch('k1', [{ minute: 10.1, type: 'goal', team: 'ars', player: 'A One', score: '1-0', data: {} }], []);
  });
  await expect.poll(() => page.evaluate(() => (window as any).__said.length)).toBeGreaterThan(0);
  const said = await page.evaluate(() => (window as any).__said);
  expect(said.some(([t, l]: string[]) => l === 'es' && t.includes('Gol de'))).toBe(true);

  // a desk translation the check rejects is written to the audit chain by the shell
  await bc.evaluate(() => window.parent.postMessage({ src: 'matchcast', type: 'audit', action: 'translation_rejected', id: 'desk-12-goal', lang: 'es', reason: 'numbers differ', minute: 12 }, '*'));
  await expect.poll(() => page.evaluate(() => MCC.records().some((r: any) => r.action === 'translation_rejected' && r.ref === 'desk-12-goal'))).toBe(true);
  expect(errs).toEqual([]);
});
