import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// One metric (watch mode): only the metrics the api follows (personas.WATCH_METRICS) can be chosen. Any other metric is Watch's own local stat,
// its persona would be dropped by the api, so it is Planned and the mode falls back to xG.

async function openWatch(page: Page): Promise<Frame> {
  await openShell(page, 'watch');
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && document.getElementById('load')!.hidden)).catch(() => false), { timeout: 240_000, message: 'Watch never finished loading' }).toBe(true);
  return f;
}

test('One metric: only api-followed metrics can be chosen, and the mode keeps one of them', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await openWatch(page);
  if (await f.evaluate(() => (document.getElementById('fan-pop') as HTMLElement).hidden)) await f.click('#fan-chip');
  await f.click('.fm-b[data-m="metric"]');

  // the Planned metrics are disabled and say so; xG, the one the api follows, is open
  const keys = await f.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.fm-k')].map((b) => ({ k: b.dataset.k!, disabled: b.disabled, planned: !!b.querySelector('.fm-planned') })));
  expect(keys.find((x) => x.k === 'xg'), 'xG is in the picker').toBeTruthy();
  for (const x of keys) {
    if (x.k === 'xg') expect(x.disabled, 'xG can be chosen').toBe(false);
    else expect({ k: x.k, disabled: x.disabled, planned: x.planned }, 'a metric the api does not follow is Planned and cannot be chosen').toEqual({ k: x.k, disabled: true, planned: true });
  }

  // the stored choice is one the api follows, so the persona reaches the stream (the default metric is not)
  expect(await f.evaluate(() => JSON.parse(localStorage.getItem('mcx-mode')!))).toMatchObject({ mode: 'metric', metric: 'xg' });
  expect(errs).toEqual([]);
});
