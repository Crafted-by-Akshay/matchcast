import { test, expect } from './fixtures';
import { createServer } from 'node:http';
import { openShell, ready, viewFrame } from './helpers';
declare const LV: any;
declare const VC: any;

// EXP-16: a line typed to a player in Watch also goes to the api's player agent; a verified reply with facts joins the chat, an unverified one does not.
test('talk to a player: the api reply with facts is added to the chat, a rejected one is not', async ({ page }) => {
  test.setTimeout(420_000);
  const talks: any[] = [], clips: string[] = [];
  let verdict = 'verified';
  const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
    const s = createServer((q, r) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
      if (q.method === 'POST') {
        let b = ''; q.on('data', (c) => (b += c));
        q.on('end', () => {
          if (/\/talk/.test(q.url!)) {
            talks.push(JSON.parse(b));
            r.writeHead(200, { 'Content-Type': 'application/json', ...cors });
            return r.end(JSON.stringify(verdict === 'verified' ? { target: talks[talks.length - 1].target, reply: 'I have made 7 passes so far.', verdict, facts: { passes: 7 }, audio_url: '/v1/audio/abc123.mp3' } : { target: 'x', reply: "I can't confirm that from the match data yet.", verdict: 'rejected', facts: {} }));
          }
          r.writeHead(/\/events/.test(q.url!) ? 202 : 201, { 'Content-Type': 'application/json', ...cors }); r.end('{}');
        });
        return;
      }
      if (/\.mp3/.test(q.url!)) { clips.push(q.url!); r.writeHead(200, { 'Content-Type': 'audio/mpeg', ...cors }); return r.end(Buffer.alloc(64)); }
      r.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors }); r.write('event: status\ndata: {"status":"live"}\n\n');
    }).listen(0, () => resolve(s));
  });
  try {
    const api = 'http://127.0.0.1:' + (server.address() as any).port;
    await page.route('**/config.js', (rt) => rt.fulfill({ contentType: 'text/javascript', body: 'window.MATCHCAST_API=' + JSON.stringify(api) + ';' }));
    await openShell(page, 'watch');
    await ready('watch')(page);
    const f = await viewFrame(page, 'watch');
    await expect.poll(() => page.evaluate(() => !!LV.key), { timeout: 120_000 }).toBe(true);   // Watch's kick-off created the match on the api
    const ask = (text: string) => f.evaluate((t) => {
      const w = window as any, m = w.__mc, p = m.players.find((q: any) => q.ti === 0 && !q.gk);
      w.__tp = p; w.mcTalkApi(p, t); return p.name;
    }, text);
    await expect(page.locator('#voice-demo'), 'the sample button shows when the api is live').toBeVisible({ timeout: 15_000 });
    await page.locator('#voice-demo').click();
    await expect.poll(() => clips).toContain('/v1/voice/audition.mp3');
    await page.evaluate(() => VC.set(true));   // Voice on: a verified reply is spoken
    const name = await ask('how many passes have you made');
    await expect.poll(() => talks.length).toBe(1);
    expect(talks[0].utterance).toBe('how many passes have you made');
    expect(talks[0].target).toMatch(/^[a-z0-9-]+$/);
    expect(Object.keys(talks[0]).sort()).toEqual(['session_id', 'target', 'utterance']);
    const log = () => f.evaluate(() => (window as any).__mcTalkLog((window as any).__tp).join('|'));
    await expect.poll(log, { timeout: 15_000 }).toContain('Checked against the match record: I have made 7 passes so far.');
    await expect.poll(() => clips.some((c) => c === '/v1/audio/abc123.mp3'), { timeout: 15_000 }).toBe(true);   // the verified reply's clip was fetched
    verdict = 'rejected';
    await ask('who will win the league');
    await expect.poll(() => talks.length).toBe(2);
    expect(clips.filter((c) => c.includes('abc123')).length, 'a rejected reply is not spoken').toBe(1);
    await expect.poll(() => f.evaluate(() => (window as any).__mcTalkReplies), { timeout: 15_000 }).toBe(2);   // both replies reached Watch, so the absence below is real
    expect(await log()).not.toContain("can't confirm");
    void name;
  } finally { server.close(); }
});
