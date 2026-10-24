import { test, expect } from './fixtures';
import { createServer } from 'node:http';

// Copilot Ask when the api says 429: the viewer sees "Ask again in a minute", not the rules' "I can't confirm that".
declare const LV: any;
declare function answerAsk(id: number, q: string): Promise<void>;

test('a 429 from the api shows a friendly "ask again in a minute"', async ({ page }) => {
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') {
        let b = ''; q.on('data', (c) => (b += c));
        q.on('end', () => {
          if (/\/ask/.test(q.url!)) { r.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors }); return r.end('{"error":{"code":"rate_limited"}}'); }
          r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}');
        });
        return;
      }
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"live"}\n\n');
    }).listen(0, () => resolve(s));
  });
  try {
    const api = 'http://127.0.0.1:' + (server.address() as any).port;
    await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
    await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
    await page.evaluate(() => LV.begin('k2', { teams: ['home', 'away'], players: [{ name: 'A One', team: 'home' }] }));
    const got = await page.evaluate(async () => {
      const sent: any[] = [];
      (window as any).post = (_v: string, m: any) => sent.push(m);
      await answerAsk(1, 'How many shots has Northgate FC had?');
      return sent.find((m) => m.type === 'answer');
    });
    expect(got.answer).toMatchObject({ verdict: 'abstained', note: 'rate limit' });
    expect(got.answer.text).toContain('Ask again in a minute');
  } finally { server.close(); }
});
