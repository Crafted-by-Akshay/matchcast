import { test, expect } from './fixtures';
import { createServer } from 'node:http';
import { openShell } from './helpers';

// EXP-8: the Voice sample button shows whenever an api is configured (the sample needs only Speech, not live agents), starts from the keyboard, and says so when the clip fails.
async function fakeApi(opts: { live: boolean; clip: number }, clips: string[]) {
  return new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') { q.resume(); q.on('end', () => { r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); }); return; }
      if (/\.mp3/.test(q.url!)) { clips.push(q.url!); r.writeHead(opts.clip, { 'Content-Type': 'audio/mpeg', ...cors }); return r.end(opts.clip === 200 ? Buffer.alloc(64) : ''); }
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); if (opts.live) r.write('event: status\ndata: {"status":"live"}\n\n');
    }).listen(0, () => resolve(s));
  });
}
for (const [name, opts] of [['live api', { live: true, clip: 500 }], ['api configured but not live', { live: false, clip: 500 }]] as const) {
  test('Voice sample: ' + name + ' shows the button, a keyboard press asks for the clip, a failed clip says so', async ({ page }) => {
    await openShell(page, 'agents');
    await expect(page.locator('#voice-demo'), 'no api configured, no sample button').toBeHidden();
    const clips: string[] = [];
    const server = await fakeApi(opts, clips);
    try {
      const api = 'http://127.0.0.1:' + (server.address() as any).port;
      await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
      await page.reload({ waitUntil: 'domcontentloaded' });   // config.js is read once, at load
      await page.waitForFunction(() => document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
      const btn = page.locator('#voice-demo');
      await expect(btn).toBeVisible({ timeout: 20_000 });
      await btn.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => clips).toContain('/v1/voice/audition.mp3');
      await expect(page.locator('#voice-src')).toHaveText('Voice sample unavailable');
      await expect(btn).toHaveText('Voice sample');   // back to idle after the failure
      await expect(btn).toHaveAttribute('aria-pressed', 'false');
    } finally { server.close(); }
  });
}

// Phone: the language buttons, Voice and Status stay reachable (they were hidden below 820 px), at 44 px, without sideways scroll.
test('phone header: language, Voice and Status are visible and 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await openShell(page, 'agents');
  for (const sel of ['#lang-sel button[data-lang="es"]', '#voice-btn', '#status-btn']) {
    const el = page.locator(sel);
    await expect(el, sel).toBeVisible();
    expect((await el.boundingBox())!.height, sel + ' tap target').toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll').toBe(true);
  await page.locator('#lang-sel button[data-lang="es"]').click();
  await expect(page.locator('#lang-sel button[data-lang="es"]')).toHaveAttribute('aria-pressed', 'true');
});
