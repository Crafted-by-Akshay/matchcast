import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// One metric (watch mode): only the metrics the api follows (personas.WATCH_METRICS) can be chosen. Any other metric is Watch's own local stat,
// its persona would be dropped by the api, so it is Planned and the mode falls back to xG.
const API = ['xg', 'poss', 'pass'];   // the keys MC_API_METRICS in embed/watch.js lists

async function openWatch(page: Page): Promise<Frame> {
  await openShell(page, 'watch');
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && document.getElementById('load')!.hidden)).catch(() => false), { timeout: 240_000, message: 'Watch never finished loading' }).toBe(true);
  return f;
}

// the Planned metrics are disabled and say so; xG, the one the api follows, is open
async function expectPicker(f: Frame, scope: string) {
  const keys = await f.evaluate((s) => [...document.querySelectorAll<HTMLButtonElement>(`${s} .fm-k`)].map((b) => ({ k: b.dataset.k!, disabled: b.disabled, planned: !!b.querySelector('.fm-planned') })), scope);
  expect(keys.find((x) => x.k === 'xg'), `${scope}: xG is in the picker`).toBeTruthy();
  for (const x of keys) {
    if (API.includes(x.k)) expect(x.disabled, `${scope}: ${x.k} can be chosen`).toBe(false);
    else expect({ k: x.k, disabled: x.disabled, planned: x.planned }, `${scope}: a metric the api does not follow is Planned and cannot be chosen`).toEqual({ k: x.k, disabled: true, planned: true });
  }
}

test('One metric: the pre-kick card and the chip both offer only api-followed metrics', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await openWatch(page);

  // before kick-off the intro card has its own picker: Continue opens it, and it must offer the same metrics
  await f.evaluate(() => (document.getElementById('su-go') as HTMLElement).click());   // the button sits under the load veil; its handler opens the intro card
  await expect(f.locator('#fan-intro .fm-b[data-m="metric"]')).toBeAttached({ timeout: 30_000 });
  await f.evaluate(() => (document.querySelector('#fan-intro .fm-b[data-m="metric"]') as HTMLElement).click());
  await expectPicker(f, '#fan-intro');

  // the mode chip sits in the match HUD, which shows at kick-off
  await f.evaluate(() => (document.getElementById('kick') as HTMLElement).click());
  await expect(f.locator('#fan-chip')).toBeVisible({ timeout: 60_000 });
  if (await f.evaluate(() => (document.getElementById('fan-pop') as HTMLElement).hidden)) await f.click('#fan-chip');
  await f.click('#fan-pop .fm-b[data-m="metric"]');
  await expectPicker(f, '#fan-pop');

  // the stored choice is one the api follows, so the persona reaches the stream (the default metric is not)
  expect(await f.evaluate(() => JSON.parse(localStorage.getItem('mcx-mode')!))).toMatchObject({ mode: 'metric', metric: 'xg' });
  expect(errs).toEqual([]);
});

test('One metric: a saved choice of an unfollowed metric is restored as xG', async ({ page }) => {
  test.setTimeout(300_000);
  // seeded once, before the first load: the viewer last chose One metric with Top speed, which the api does not follow
  await page.addInitScript(() => {
    if (sessionStorage.getItem('om-seeded')) return;
    sessionStorage.setItem('om-seeded', '1');
    localStorage.setItem('mcx-mode', JSON.stringify({ mode: 'metric', club: 0, metric: 'speed', lang: 'en', player: null }));
  });
  const f = await openWatch(page);
  // the restore sets Watch's own state, which the strip shows (the persona reads the same state); the stored copy is rewritten on the next change
  await expect(f.locator('#fan-chip')).toContainText(/One metric/);
  await expect(f.locator('#fan-metric .mk')).toBeVisible();
  await expect.poll(() => f.evaluate(() => document.querySelector('#fan-metric .mk')?.textContent ?? ''), { timeout: 20_000, message: 'the restored One metric choice falls back to xG' }).toMatch(/^xG/);
});

declare const LV: any;

test('One metric: possession and pass accuracy are followed, and the shell hands the api their api names', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await openWatch(page);
  await f.evaluate(() => (document.getElementById('kick') as HTMLElement).click());
  await expect(f.locator('#fan-chip')).toBeVisible({ timeout: 60_000 });
  if (await f.evaluate(() => (document.getElementById('fan-pop') as HTMLElement).hidden)) await f.click('#fan-chip');
  await f.click('#fan-pop .fm-b[data-m="metric"]');
  await expectPicker(f, '#fan-pop');

  // the shell passes each persona on to the api stream (persona-stream.spec.ts); record what Watch hands it
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as any).__personas = seen;
    const persona = LV.persona;
    LV.persona = (p: string, lang: string) => { seen.push(p); return persona(p, lang); };
  });
  for (const [key, label] of [['poss', 'Possession'], ['pass', 'Pass accuracy']]) {
    await f.click(`#fan-pop .fm-k[data-k="${key}"]`);
    await expect(f.locator('#fan-metric .mk')).toContainText(label);
  }
  const seen = await page.evaluate(() => (window as any).__personas as string[]);
  expect(seen).toEqual(expect.arrayContaining(['metric:possession_share', 'metric:pass_accuracy']));
  expect(seen.some((p) => p === 'metric:poss' || p === 'metric:pass')).toBe(false);
  expect(errs).toEqual([]);
});
