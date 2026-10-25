import { test, expect } from './fixtures';
import { collectErrors, openShell } from './helpers';

declare const VC: any;

// ADR-0023: the shell's language picker lists the ten feed languages, and the choice is remembered on reload.
const LANGS = ['en', 'es', 'pt', 'hi', 'ar', 'fr', 'de', 'id', 'ja', 'zh-Hans'];

test.beforeEach(({ page }) => page.addInitScript(() => { (window as any).MC_TEST = true; }));

test('language picker: ten feed languages, the choice is kept on reload', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await expect(page.locator('#lang-pick option')).toHaveCount(LANGS.length);
  expect(await page.locator('#lang-pick option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).toEqual(LANGS);
  await page.locator('#lang-pick').selectOption('ja');
  await expect(page.locator('#lang-pick')).toHaveValue('ja');
  expect(await page.evaluate(() => [VC.speaks('pt'), VC.speaks('ja')])).toEqual([true, false]);   // CREW-7.10: Portuguese is spoken, Japanese is captions only
  await page.reload();
  await openShell(page, 'agents');
  await expect(page.locator('#lang-pick')).toHaveValue('ja');
  expect(errs).toEqual([]);
});
