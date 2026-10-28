import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// The shell header is the only language selector. Watch follows it, labels English fallback honestly, and applies right-to-left direction to Arabic captions.
const TEN = ['en', 'es', 'pt', 'hi', 'ar', 'fr', 'de', 'id', 'ja', 'zh-Hans'];
const NAMES: Record<string, string> = { en: 'English', es: 'Español', pt: 'Português', hi: 'हिन्दी', ar: 'العربية', fr: 'Français', de: 'Deutsch', id: 'Bahasa Indonesia', ja: '日本語', 'zh-Hans': '简体中文' };

async function openWatch(page: Page, query: string): Promise<Frame> {
  await openShell(page, 'watch', query);
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && document.getElementById('load')!.hidden)), { timeout: 240_000 }).toBe(true);
  await f.waitForSelector('#mcf', { state: 'attached', timeout: 60_000 });
  return f;
}
const openPreferences = async (f: Frame) => expect(f.locator('#fan-pop')).toBeHidden();
// built = what the page's own list (langs.js, once it lands) says is checked; until then English, Spanish and Hindi
const pick = (page: any, code: string) => page.locator('#lang-pick').selectOption(code);
const state = (f: Frame) => f.evaluate(() => (window as any).__mc.fan.state.lang as string);

test('one language picker: the header lists all ten choices and Watch has no second picker', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  const f = await openWatch(page, '?crew=1');
  await openPreferences(f);
  const opts = await page.locator('#lang-pick option').evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => ({ code: o.value, label: o.textContent?.trim(), lang: o.lang })));
  expect(opts.map((o) => o.code)).toEqual(TEN);
  for (const o of opts) { expect(o.label).toBe(NAMES[o.code]); expect(o.lang).toBe(o.code); }
  await openPreferences(f);
  await expect(f.locator('#fan-pop .fm-lang')).toBeHidden();
  await expect(page.locator('#lang-sel')).toContainText('Commentary language');
  await expect(f.locator('#mc-two')).toBeHidden();
  await pick(page, 'hi');
  await expect.poll(() => state(f)).toBe('hi');
  await expect(page.locator('#lang-pick')).toHaveValue('hi');
  await pick(page, 'es');
  await expect.poll(() => state(f)).toBe('es');
  await expect(page.locator('#lang-pick')).toHaveValue('es');
  await f.getByRole('radio', { name: 'Analyst' }).click();
  await expect(f.locator('#mc-feedlines .fp-note')).toHaveText('Showing English: no translated line yet');
  expect(errs).toEqual([]);
});

test('Watch language picker: a pick sets the language, tells the shell, flips the direction and the English-fallback note', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  const f = await openWatch(page, '?crew=1');
  await openPreferences(f);
  await expect(f.locator('#mc-lang-note'), 'English needs no note').toBeHidden();
  await pick(page, 'ar');
  await expect.poll(() => state(f)).toBe('ar');
  await expect(page.locator('#lang-pick')).toHaveValue('ar');
  await expect(page.locator('#lang-sel')).toHaveAttribute('title', /العربية/);
  await expect(f.locator('#fan-pop .fm-lang')).toBeHidden();
  // a line reads right to left when it is Arabic; a line that fell back to English stays left to right; the card chrome is not mirrored
  const AR = 'هدف للأرجنتين في الدقيقة 10.', EN = 'Goal for Argentina in minute 10.';
  const dirOf = (sel: string) => f.evaluate((q) => { const e = document.querySelector(q) as HTMLElement | null; return e ? [getComputedStyle(e).direction, e.lang] : null; }, sel);
  await f.evaluate(([ar, en]) => {
    const add = (rootId: string, tag: string, cls: string, t: string) => { const e = document.createElement(tag); e.className = cls; e.textContent = t; document.getElementById(rootId)!.append(e); };
    add('mcf-list', 'li', 'tl-ar', ar); add('mcf-list', 'li', 'tl-en', en);
    add('mc-two', 'p', 'tt-ar', ar); add('mc-two', 'p', 'tt-en', en);
    add('mcx-box', 'p', 'tx-ar', ar); add('mcx-box', 'p', 'tx-en', en);
    const b = document.createElement('b'); b.id = 'tt-top'; b.textContent = ar; document.getElementById('mcf-top')!.replaceChildren(b);   // as feed.js draws it: the newest line, with nothing English before it
    document.getElementById('cap1')!.textContent = ar;
  }, [AR, EN]);
  for (const k of ['.tl', '.tt', '.tx']) {
    await expect.poll(() => dirOf(k + '-ar'), { message: `${k} Arabic line reads right to left` }).toEqual(['rtl', 'ar']);
    await expect.poll(() => dirOf(k + '-en'), { message: `${k} English fallback line stays left to right` }).toEqual(['ltr', '']);
  }
  await expect.poll(() => dirOf('#mcf-top'), { message: 'the newest line at the top of the card' }).toEqual(['rtl', 'ar']);
  await expect.poll(() => dirOf('#cap1'), { message: 'the caption line' }).toEqual(['rtl', 'ar']);
  expect(await f.evaluate(() => getComputedStyle(document.getElementById('mcf')!).direction), 'the card chrome is not mirrored').toBe('ltr');
  await f.evaluate((en) => { document.getElementById('cap1')!.textContent = en; document.getElementById('tt-top')?.remove(); }, EN);
  await expect.poll(() => dirOf('#cap1'), { message: 'a fallback line does not leave the caption right to left' }).toEqual(['ltr', '']);
  await expect(page.locator('#lang-sel')).toHaveAttribute('title', /Match commentary and speech: العربية/);

  await pick(page, 'ja');
  await expect.poll(() => state(f)).toBe('ja');
  expect(await page.evaluate(() => localStorage.getItem('mc-lang'))).toBe('ja');

  await pick(page, 'en');
  await expect.poll(() => state(f)).toBe('en');
  expect(errs).toEqual([]);
});

test('Watch follows the commentary language saved by the shell', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  const f = await openWatch(page, '?crew=1');
  await openPreferences(f);
  await pick(page, 'de');
  await expect.poll(() => state(f), { timeout: 30_000, message: 'the shell language is sent to Watch' }).toBe('de');
  await expect(page.locator('#lang-pick')).toHaveValue('de');
  await openPreferences(f);
  await expect(f.locator('#fan-pop .fm-lang')).toBeHidden();
  expect(errs).toEqual([]);
});

test('Watch on a phone: the one language picker stays inside the screen', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await openWatch(page, '?crew=1');
  await openPreferences(f);
  await expect(page.locator('#lang-pick')).toBeVisible();
  const box = await page.locator('#lang-sel').boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('with no crew flag, Watch still uses the one shell language picker', async ({ page }) => {
  test.setTimeout(420_000);
  const f = await openWatch(page, '');
  await openPreferences(f);
  await expect(f.locator('#fan-pop .fm-lang')).toBeHidden();
  await expect(page.locator('#lang-pick option')).toHaveCount(TEN.length);
});

test('with ?crew=0 the header remains the only language picker', async ({ page }) => {
  test.setTimeout(420_000);
  const f = await openWatch(page, '?crew=0');
  await openPreferences(f);
  await expect(f.locator('#fan-pop .fm-lang')).toBeHidden();
  await expect(page.locator('#lang-pick option')).toHaveCount(TEN.length);
});
