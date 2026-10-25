import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// CREW-7.9 (AB#506), the picker half: behind ?crew=1 Watch's language row offers the ten feed languages, remembers the choice,
// puts Arabic lines right-to-left, and says plainly that a line with no checked translation stays English.
// Without the flag the row is the one it always was (English, Tamil, Spanish, Hindi, French, Arabic).
const TEN = ['en', 'es', 'pt', 'hi', 'ar', 'fr', 'de', 'id', 'ja', 'zh-Hans'];
const NAMES: Record<string, string> = { en: 'English', es: 'Español', pt: 'Português', hi: 'हिन्दी', ar: 'العربية', fr: 'Français', de: 'Deutsch', id: 'Bahasa Indonesia', ja: '日本語', 'zh-Hans': '简体中文' };

async function openWatch(page: Page, query: string): Promise<Frame> {
  await openShell(page, 'watch', query);
  await ready('watch')(page);
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!(window as any).__mc?.S.started), { timeout: 240_000 }).toBe(true);
  await f.waitForSelector('#mcf', { state: 'attached', timeout: 60_000 });
  return f;
}
const openPicker = async (f: Frame) => {
  if (await f.evaluate(() => (document.getElementById('fan-pop') as HTMLElement).hidden)) await f.click('#fan-chip');
  await f.waitForSelector('#fan-pop .fm-l');
};
// the last language button and the note are on top at their own centre (not under the commentary card or the frame's edge), once scrolled into the panel
const reachable = (f: Frame, sel: string) => f.evaluate((q) => {
  const el = document.querySelector(q) as HTMLElement; el.scrollIntoView({ block: 'nearest' });
  const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { onTop: !!hit && (hit === el || el.contains(hit)), inside: r.bottom <= innerHeight && r.top >= 0 };
}, sel);
// built = what the page's own list (langs.js, once it lands) says is checked; until then English, Spanish and Hindi
const builtSet = (f: Frame) => f.evaluate(() => ((window as any).MC_LANGS as string[] | undefined) || ['en', 'es', 'hi']);
const pick = (f: Frame, code: string) => f.evaluate((c) => (document.querySelector(`#fan-pop .fm-l[data-l="${c}"]`) as HTMLElement).click(), code);
const state = (f: Frame) => f.evaluate(() => (window as any).__mc.fan.state.lang as string);

test('Watch language picker: ten languages, each by its own name; any not built yet say Planned', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  const f = await openWatch(page, '?crew=1');
  await openPicker(f);
  const row = await f.evaluate(() => [...document.querySelectorAll<HTMLElement>('#fan-pop .fm-l')].map((b) => ({ l: b.dataset.l, lang: b.lang, name: (b.firstChild as Text).textContent!.trim(), planned: !!b.querySelector('.fm-planned') })));
  expect(row.map((r) => r.l)).toEqual(TEN);
  for (const r of row) { expect(r.name).toBe(NAMES[r.l!]); expect(r.lang).toBe(r.l); }
  // the languages with a checked path carry no tag; the rest are labelled until their translations are
  const built = await builtSet(f);
  expect(row.filter((r) => !r.planned).map((r) => r.l)).toEqual(TEN.filter((c) => built.includes(c)));
  expect(errs).toEqual([]);
});

test('Watch language picker: a pick sets the language, tells the shell, flips the direction and the English-fallback note', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  const f = await openWatch(page, '?crew=1');
  await openPicker(f);
  await expect(f.locator('#mc-lang-note'), 'English needs no note').toBeHidden();
  // the shell hears the pick as the viewer's persona message (its setLang takes the language from there)
  await page.evaluate(() => { (window as any).__persona = []; window.addEventListener('message', (e) => { if (e.data && e.data.type === 'persona') (window as any).__persona.push(e.data.lang); }); });

  await pick(f, 'ar');
  expect(await state(f)).toBe('ar');
  expect(await reachable(f, '#fan-pop .fm-l[data-l="zh-Hans"]'), 'the last language is not under another card').toEqual({ onTop: true, inside: true });
  expect(await reachable(f, '#mc-lang-note'), 'the note is not under another card').toEqual({ onTop: true, inside: true });
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
  await expect(f.locator('#mc-lang-note')).toBeVisible();
  const built = await builtSet(f);
  await expect(f.locator('#mc-lang-note')).toHaveText(built.includes('ar') ? 'Lines show in العربية once a checked translation arrives. Until then, or if translating fails, they stay in English.' : 'العربية is Planned: lines stay in English for now.');
  expect(await f.evaluate(() => [document.getElementById('mc-lang-note')!.lang, getComputedStyle(document.getElementById('mc-lang-note')!).direction]), 'the English note stays left to right inside the Arabic panel').toEqual(['en', 'ltr']);
  await expect(f.locator('#fan-pop .fm-l[data-l="ar"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (window as any).__persona.at(-1)), { message: 'the shell is told the language' }).toBe('ar');

  await pick(f, 'ja');
  expect(await state(f)).toBe('ja');
  // the choice is kept with Watch's other settings
  expect(await f.evaluate(() => JSON.parse(localStorage.getItem('mcx-mode') || '{}').lang)).toBe('ja');

  await pick(f, 'en');
  expect(await state(f)).toBe('en');
  await expect(f.locator('#mc-lang-note')).toBeHidden();
  expect(errs).toEqual([]);
});

test('Watch language picker: a saved language of the ten is restored when Watch loads', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await page.addInitScript(() => { try { if (!localStorage.getItem('mcx-mode')) localStorage.setItem('mcx-mode', JSON.stringify({ mode: 'casual', club: 0, metric: 'xg', lang: 'de', player: null })); } catch (e) { /* storage blocked */ } });
  const f = await openWatch(page, '?crew=1');
  await expect.poll(() => state(f), { timeout: 30_000, message: 'a saved German is restored, not reset to English' }).toBe('de');
  await openPicker(f);
  await expect(f.locator('#fan-pop .fm-l[data-l="de"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errs).toEqual([]);
});

test('Watch language picker on a phone: the panel stays inside the frame and the last language is reachable', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await openWatch(page, '?crew=1');
  await openPicker(f);
  expect(await f.evaluate(() => document.getElementById('fan-pop')!.getBoundingClientRect().bottom <= innerHeight), 'the panel ends inside the frame').toBe(true);
  expect(await reachable(f, '#fan-pop .fm-l[data-l="zh-Hans"]')).toEqual({ onTop: true, inside: true });
  expect(await reachable(f, '#fan-pop .fm-v'), 'the voice switch next to the row is still there').toEqual({ onTop: true, inside: true });
});

test('Watch language picker: without ?crew=1 the row is the old one', async ({ page }) => {
  test.setTimeout(420_000);
  const f = await openWatch(page, '');
  await openPicker(f);
  expect(await f.evaluate(() => [...document.querySelectorAll<HTMLElement>('#fan-pop .fm-l')].map((b) => b.dataset.l))).toEqual(['en', 'ta', 'es', 'hi', 'fr', 'ar']);
  await expect(f.locator('#mc-lang-note')).toHaveCount(0);
});
