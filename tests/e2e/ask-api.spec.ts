import { test, expect } from './fixtures';
import { createServer } from 'node:http';

// EXP-5: LV.ask sends exactly what the api's AskBody accepts (session_id in the body, persona casual|analyst|broadcast, no extra keys) and reads {answer, abstained, citations, variants}.
declare const LV: any;

test('Ask matches the api contract: request body and response mapping', async ({ page }) => {
  const asks: any[] = [];
  let reply: any = { answer: 'It is 1-0.', intent: 'score', abstained: false, citations: [{ type: 'claim', id: 'c1' }], mode: 'rules', lang: 'en' };
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
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"live"}\n\n');
    }).listen(0, () => resolve(s));
  });
  try {
    const api = 'http://127.0.0.1:' + (server.address() as any).port;
    await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
    await page.goto('/index.html#agents', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof LV !== 'undefined' && document.querySelectorAll('#fx option').length > 20, null, { timeout: 30_000 });
    await page.evaluate(() => { LV.persona('club:thr', 'es'); LV.begin('k1', { teams: ['thr', 'cco'], players: [{ name: 'A One', team: 'thr' }] }); });
    const a = await page.evaluate(() => LV.ask('Who leads?'));
    expect(Object.keys(asks[0]).sort()).toEqual(['lang', 'persona', 'question', 'session_id']);
    expect(asks[0].persona, 'a club persona is the casual audience').toBe('casual');
    expect(asks[0].lang).toBe('es');
    expect(asks[0].session_id).toMatch(/^demo-/);
    expect(a).toMatchObject({ text: 'It is 1-0.', verdict: 'verified', source: 'rules', citations: [{ type: 'claim', id: 'c1' }] });
    const before = asks.length;
    expect(await page.evaluate(() => LV.ask('   ').then(() => 'sent', (e: Error) => e.message))).toBe('empty question');
    expect(asks.length, 'a blank question is not sent').toBe(before);
    reply = { answer: 'I cannot confirm that.', intent: 'x', abstained: true, citations: [], mode: 'rules', lang: 'en' };
    expect((await page.evaluate(() => LV.ask('Who will win?'))).verdict).toBe('abstained');
    reply = { answer: 'It is 1-0.', intent: 'score', abstained: false, citations: [], mode: 'live', lang: 'en', variants: { es: 'Va 1-0.' } };
    expect(await page.evaluate(() => LV.ask('Who leads?'))).toMatchObject({ text: 'Va 1-0.', source: 'model' });
  } finally { server.close(); }
});
