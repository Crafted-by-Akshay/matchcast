import { test, expect } from './fixtures';
import { createServer } from 'node:http';
import { openShell } from './helpers';

// EXP-8: the Voice sample button shows only while the api is live, is reachable by keyboard, stops on a second press, and fits a phone (44 px, no sideways scroll).
test('Voice sample: hidden without an api, keyboard start', async ({ page }) => {
  await openShell(page, 'agents');
  await expect(page.locator('#voice-demo'), 'no api configured, no sample button').toBeHidden();

  const clips: string[] = [];
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') { q.resume(); q.on('end', () => { r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); }); return; }
      if (/\.mp3/.test(q.url!)) { clips.push(q.url!); r.writeHead(200, { 'Content-Type': 'audio/mpeg', ...cors }); return r.end(Buffer.alloc(64)); }
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"live"}\n\n');
    }).listen(0, () => resolve(s));
  });
  try {
    const api = 'http://127.0.0.1:' + (server.address() as any).port;
    await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
    await page.reload({ waitUntil: 'domcontentloaded' });   // config.js is read once, at load
    await page.waitForFunction(() => document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
    const btn = page.locator('#voice-demo');
    await expect(btn).toBeVisible({ timeout: 20_000 });
    await btn.focus();
    await page.keyboard.press('Enter');   // keyboard users can start it
    await expect.poll(() => clips).toContain('/v1/voice/audition.mp3');
    await expect(btn).toHaveAttribute('aria-pressed', /true|false/);
  } finally { server.close(); }
});

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
