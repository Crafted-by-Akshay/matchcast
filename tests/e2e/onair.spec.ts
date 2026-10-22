import { test, expect } from './fixtures';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { collectErrors, openShell, ready, viewFrame } from './helpers';

// Broadcast keeps a log of lines that reached air and exports it as overlay JSON with a SHA-256 shown on screen.
declare const AG: any;

test('on-air log lists only approved lines and exports JSON whose hash matches the file', async ({ page }) => {
  test.setTimeout(420_000);
  const errs = collectErrors(page);
  await openShell(page, 'agents');
  await page.click('#tab-broadcast');
  await ready('broadcast')(page);
  const bc = await viewFrame(page, 'broadcast');
  await page.click('#tab-agents');
  await page.selectOption('#aq-mode', 'producer');
  await page.evaluate(() => {
    AG.reset('k3', { hk: 'thr', ak: 'cco', home: 'Thames Rovers', away: 'Coloso Ciudad' });
    AG.onWatch('k3', [{ minute: 10.1, type: 'goal', team: 'thr', player: 'A One', score: '1-0', data: {} }], []);
    AG.onWatch('k3', [{ minute: 20.2, type: 'goal', team: 'cco', player: 'C One', score: '1-1', data: {} }], []);
  });
  await expect.poll(() => page.locator('#aq-list li[data-id]').count()).toBe(2);
  // approve the first, kill the second
  await page.evaluate(() => { const [a, b] = AG.run.claims.filter((c: any) => c.approval === 'pending'); AG.approve(a.id, 'Sam Producer'); AG.kill(b.id, 'Sam Producer', 'test'); });
  await page.click('#tab-broadcast');
  await expect(bc.locator('#mc-onair-n')).toHaveText('1 line on air');
  // a forged message from inside the frame, and a repeat of the real one, change nothing
  await bc.evaluate(() => { window.postMessage({ src: 'matchcast-shell', type: 'air', line: { id: 'forged', minute: 1, text: 'forged', verdict: 'verified' } }, '*'); });
  await page.evaluate(() => { const c = AG.run.claims.find((x: any) => x.approval === 'approved'); (document.querySelector('#v-broadcast iframe') as HTMLIFrameElement).contentWindow!.postMessage({ src: 'matchcast-shell', type: 'air', line: { id: c.id, minute: c.minute, text: c.airText || c.text, verdict: c.verdict } }, '*'); });
  await page.waitForTimeout(500);
  await expect(bc.locator('#mc-onair-n')).toHaveText('1 line on air');
  const [dl] = await Promise.all([page.waitForEvent('download'), bc.locator('#mc-onair-export').click()]);
  const text = readFileSync(await dl.path(), 'utf8');
  const j = JSON.parse(text);
  expect(j.schema).toBe('matchcast.onair/1');
  expect(j.lines).toHaveLength(1);
  expect(j.lines[0].text).toContain('Thames Rovers');
  const sha = createHash('sha256').update(text).digest('hex');
  await expect(bc.locator('#mc-onair-hash')).toContainText(sha.slice(0, 16));
  expect(text).not.toContain('forged');
  expect(errs).toEqual([]);
});
