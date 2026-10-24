import { test, expect } from './fixtures';
import { createServer } from 'node:http';

// Copilot Ask during warm-up: the match is on the api but no claim has come yet (status warming_up). The shell asks the api anyway,
// so the viewer gets the agents' checked answer rather than the rules' "I can't confirm that".
declare const LV: any;
declare function answerAsk(id: number, q: string): Promise<void>;

test('ask during warm-up is answered by the api, and the viewer sees the checked answer', async ({ page }) => {
  const asks: any[] = [];
  const reply = { answer: 'Northgate FC have 3 shots so far.', intent: 'live', abstained: false, citations: [{ type: 'fact', id: 'team:home' }], mode: 'live', retrieval: 'local', lang: 'en' };
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') {
        let b = ''; q.on('data', (c) => (b += c));
        q.on('end', () => {
          if (/\/ask/.test(q.url!)) { asks.push(JSON.parse(b)); r.writeHead(200, { 'Content-Type': 'application/json', ...cors }); return r.end(JSON.stringify(reply)); }
          r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}');
        });
        return;
      }
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"warming_up"}\n\n');
    }).listen(0, () => resolve(s));
  });
  try {
    const api = 'http://127.0.0.1:' + (server.address() as any).port;
    await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
    await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
    await page.evaluate(() => LV.begin('k1', { teams: ['home', 'away'], players: [{ name: 'A One', team: 'home' }] }));
    await expect.poll(() => page.evaluate(() => LV.status), { timeout: 10_000 }).toBe('warming');
    const got = await page.evaluate(async () => {
      const sent: any[] = [];
      (window as any).post = (_v: string, m: any) => sent.push(m);
      await answerAsk(1, 'How many shots has Northgate FC had?');
      return sent.find((m) => m.type === 'answer');
    });
    expect(asks.length, 'the question went to the api during warm-up').toBe(1);
    expect(asks[0].question).toBe('How many shots has Northgate FC had?');
    expect(got.answer).toMatchObject({ text: reply.answer, verdict: 'verified', source: 'model', note: 'from the match record' });
  } finally { server.close(); }
});
