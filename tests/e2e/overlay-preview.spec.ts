import { test, expect } from './fixtures';
import { openShell, openProductionTools, viewFrame } from './helpers';

// AB#500 (the desk preview of the timed overlay feed): the desk shows the last records of the on-air export, labelled simulated, and the record a line adds is the one the export holds.
test('the desk previews the on-air overlay records as a simulated feed, refreshed when a line airs', async ({ page }) => {
  test.setTimeout(300_000);
  await openShell(page, 'broadcast', '?seed=2026');
  const f = await viewFrame(page, 'broadcast');
  await openProductionTools(f);
  await expect(f.locator('#mc-overlay')).toBeVisible({ timeout: 240_000 });
  await expect(f.locator('#mc-overlay')).toContainText('simulated');
  await expect(f.locator('#mc-overlay-n')).toHaveText('Nothing aired yet.');

  await page.evaluate(() => {
    const frame = document.querySelector('#v-broadcast iframe') as HTMLIFrameElement;
    frame.contentWindow!.postMessage({ src: 'matchcast-shell', type: 'air', line: {
      id: 'L7', minute: 31, text: 'Shot on target for Northgate FC.', verdict: 'verified', alert: null, tr: null, steps: [], numbers: [],
    } }, '*');
  });
  await expect(f.locator('#mc-overlay-n')).toHaveText('1 line in the export');
  await expect(f.locator('#mc-overlay-pre')).toContainText('"id": "L7"');
  await expect(f.locator('#mc-overlay-pre')).toContainText('Shot on target for Northgate FC.');
});
