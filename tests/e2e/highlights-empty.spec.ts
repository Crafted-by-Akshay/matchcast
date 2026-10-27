import { test, expect } from './fixtures';
import { collectErrors, openShell, ready } from './helpers';

// FIX-03 (AB#373): with no highlight moments, Play and Skip are disabled and the panel says why, with a route back to Watch.
// Shell-driven: the panel is painted with no events, as a match that has not reached full time would paint it.
declare const HL: any;
declare function paintHighlights(): void;

test('highlights: with no moments, Play and Skip are disabled and Back to Watch returns to the match', async ({ page }) => {
  const errs = collectErrors(page);
  await openShell(page, 'watch');
  await ready('watch')(page);
  await page.evaluate(() => {
    HL.reset({ home: 'Thames Rovers', away: 'Coloso Ciudad' }, ['4-3-3', '4-4-2']);
    (document.getElementById('hl') as HTMLElement).hidden = false;
    paintHighlights();
  });
  await expect(page.locator('#hl-empty')).toBeVisible();
  await expect(page.locator('#hl-play')).toBeDisabled();
  await expect(page.locator('#hl-skip')).toBeDisabled();
  await expect(page.locator('#hl-3d')).toBeHidden();
  await page.locator('#hl-back').click();
  await expect(page.locator('#hl')).toBeHidden();
  await expect(page.locator('#v-watch')).toBeVisible();
  expect(errs).toEqual([]);
});
