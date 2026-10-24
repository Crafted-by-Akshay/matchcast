import { test, expect } from './fixtures';
import { createServer } from 'node:http';

// EXP-4: the viewer's watch mode (persona) is part of the first stream request at kick-off, so the api writes that persona's lines from the first moment.
declare const LV: any;

test('persona chosen before kick-off opens the stream with it; a later choice reopens it', async ({ page }) => {
  const streams: string[] = [];
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') { q.resume(); q.on('end', () => { r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}'); }); return; }
      streams.push(q.url!);
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"live"}\n\n');
    }).listen(0, () => resolve(s));
  });
  try {
    const api = 'http://127.0.0.1:' + (server.address() as any).port;
    await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
    await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
    await page.evaluate(() => {
      LV.persona('club:ars', 'es');   // chosen in Watch before the kick-off
      LV.begin('k1', { teams: ['ars', 'che'], players: [{ name: 'A One', team: 'ars' }, { name: 'C One', team: 'che' }] });
      // the api creates the match with the first batch of events (#234), and the stream opens once it exists; Watch's first events send that batch
      LV.events([{ minute: 12.3, type: 'shot', team: 'ars', player: 'A One', x: 90, y: 30, xg: 0.3, kind: 'open play', data: {} }]);
    });
    await expect.poll(() => streams.length).toBeGreaterThan(0);
    const first = new URL('http://x' + streams[0]).searchParams;
    expect(first.get('persona')).toBe('club:ars');
    expect(first.get('lang')).toBe('es');
    await page.evaluate(() => LV.persona('analyst', 'es'));
    await expect.poll(() => streams.length).toBe(2);
    expect(new URL('http://x' + streams[1]).searchParams.get('persona')).toBe('analyst');
  } finally { server.close(); }
});
