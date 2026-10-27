import { test, expect, type Frame, type Page } from './fixtures';
import { collectErrors, openShell, viewFrame } from './helpers';

// FIX-01: a new match from Watch starts a new run, and Watch's Match Pulse cards of the match before are gone.
// The shell posts a `run` message at each new match; the cards are posted the way the shell does, and only the DOM is checked.
declare const post: (view: string, msg: unknown) => void; // top-level function of the shell

const card = (id: string, text: string) => ({ id, minute: 12.4, kind: 'score', text, plain: text, chips: [], source: 'rules', verdict: 'verified', tr: null, evidence: [] });

async function openWatch(page: Page): Promise<Frame> {
  await openShell(page, 'watch');
  const f = await viewFrame(page, 'watch');
  await expect.poll(() => f.evaluate(() => !!((window as any).__mc?.players.length && (window as any).__mcxCards && document.getElementById('load')!.hidden)).catch(() => false), { timeout: 240_000, message: 'Watch never loaded' }).toBe(true);
  return f;
}

test('a new run clears the Pulse cards of the match before', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = collectErrors(page);
  const f = await openWatch(page);
  // Watch's listener can take a moment after the ready mark, so the card is posted again until it shows
  await expect(async () => {
    await page.evaluate((c) => post('watch', { src: 'matchcast-shell', type: 'pulse', card: c }), card('c1', 'OLD BRAZIL LINE'));
    await expect(f.locator('#mcx-live')).toContainText('OLD BRAZIL LINE', { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await page.evaluate(() => post('watch', { src: 'matchcast-shell', type: 'run', gen: 2 }));
  await expect(f.locator('#mcx-live .mcx-c')).toHaveCount(0);
  await expect(f.locator('#mcx-log .mcx-c')).toHaveCount(0);
  await page.evaluate((c) => post('watch', { src: 'matchcast-shell', type: 'pulse', card: c }), card('c1', 'NEW LINE'));
  await expect(f.locator('#mcx-live')).toContainText('NEW LINE');
  await expect(f.locator('#mcx-live')).not.toContainText('OLD BRAZIL LINE');
  expect(errs.filter((e) => /watch|pulse|mcx/i.test(e)), errs.join('\n')).toEqual([]);
});
