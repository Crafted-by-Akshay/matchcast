import { test, expect } from './fixtures';
import { openShell, viewFrame } from './helpers';

// The Broadcast desk's panels are a classic script that runs before the 3D module's three.js import, so the producer queue and the Copilot show even when the 3D engine never loads. The shell's loading card lifts on the panels' own signal.
declare const AG: any;

test('the desk panels and the approval queue show while three.js never loads, and the loading card lifts', async ({ page }) => {
  test.setTimeout(300_000);
  await page.route('**/node_modules/three/**', (route) => route.abort());   // the 3D engine stays down for this whole test
  await openShell(page, 'broadcast', '?seed=2026');
  await expect(page.locator('#v-broadcast'), 'the card lifts on the panels signal, not the pitch start').toHaveClass(/panels/, { timeout: 60_000 });
  const f = await viewFrame(page, 'broadcast');
  await expect(f.locator('#mc-desk')).toBeVisible();
  await expect(f.locator('#mc-producer'), 'the producer section shows without the pitch').toBeVisible();
  await expect(f.locator('#mc-pitch')).toHaveText('3D pitch: loading');
  await expect(f.locator('#mc-cop [data-cop="highlights"]')).toBeVisible();

  // a line the shell sends to the producer queue reaches the section while the pitch is still down
  await page.evaluate((n) => { AG.reset('k-panels', n); AG.ingest({ line_id: 'L9', status: 'review', escalated: true, reason_code: 'number_mismatch', text: "Thames Rovers lead 3-0 at 20'." }, 'live'); }, { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
  await expect(f.locator('#mc-pq li[data-id="pub-L9"]'), 'the queue shows the escalated line').toContainText('Escalated');
});
